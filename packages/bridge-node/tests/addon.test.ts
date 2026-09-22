import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type {
  Attachment,
  AttachmentStatus,
  Conversation,
  Frame,
  Message,
  Request,
} from '@session/bridge-types'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createNodeBridgeTransport } from '#src/index'

/**
 * The addon against the real libsession, with no network attached.
 *
 * Skipped when the addon has not been built, because the per-PR job compiles no C++ - the
 * native workflow is where this runs. `turbo build:native` is what makes it run here.
 */
const addon = join(import.meta.dirname, '../build/Release/session_bridge_node.node')
const describeAddon = existsSync(addon) ? describe : describe.skip

function builtForTesting(): boolean {
  try {
    const cache = readFileSync(join(import.meta.dirname, '../build/CMakeCache.txt'), 'utf8')
    return /^SESSION_BRIDGE_TESTING:BOOL=ON$/m.test(cache)
  } catch {
    return false
  }
}

describeAddon('the N-API addon', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'session-bridge-'))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('opens a database and answers on the frame stream', async () => {
    const transport = createNodeBridgeTransport({
      dbPath: join(dir, 'session.db'),
      cacheDir: join(dir, 'cache'),
      rawKey: new Uint8Array(32).fill(7),
      deferAccount: true,
    })

    const frames: Frame[] = []
    const answered = new Promise<void>((resolve) => {
      transport.setSink((frame) => {
        frames.push(frame)
        if (frame.type === 'response' && frame.response.id === 1) resolve()
      })
    })

    transport.send({ id: 1, command: { type: 'getAccountInfo' } })
    await answered

    const response = frames.find((frame) => frame.type === 'response')
    if (response?.type !== 'response') throw new Error('no response frame')
    expect(response.response.error).toBeUndefined()
    expect(response.response.result?.type).toBe('accountInfo')

    if (response.response.result?.type !== 'accountInfo') throw new Error('wrong result')
    // deferAccount is what makes this false. Without it libsession creates an account as the
    // database opens, and onboarding never gets asked.
    expect(response.response.result.info.haveAccount).toBe(false)

    transport.close()
  })

  it('forwards libsession logging, and takes only its own logger off when it closes', async () => {
    // libsession's logger is process-wide and fires from threads close() cannot join, so one left
    // registered writes into a freed bridge. Removing it has to be surgical: clear_loggers would
    // silence every other bridge in the process as well.
    const open = (name: string) => {
      const transport = createNodeBridgeTransport({
        dbPath: join(dir, `${name}.db`),
        cacheDir: join(dir, 'cache'),
        rawKey: new Uint8Array(32).fill(7),
        deferAccount: false,
        logLevel: 'trace',
      })
      let seen = 0
      transport.setSink((frame) => {
        if (frame.type === 'event' && frame.event.type === 'log') seen += 1
      })
      // libsession logs on a timer rather than on demand, so the wait is for the next tick.
      const nextLine = async () => {
        const from = seen
        for (let i = 0; i < 100 && seen === from; i++)
          await new Promise((resolve) => setTimeout(resolve, 100))
        return seen > from
      }
      return { transport, nextLine, lines: () => seen }
    }

    const first = open('logger-first')
    const second = open('logger-second')
    expect(await first.nextLine()).toBe(true)
    expect(await second.nextLine()).toBe(true)

    const closedAt = first.lines()
    first.transport.close()

    // With no network attached libsession is silent between a start and a close, so opening a
    // third bridge is what produces the lines the other two are then measured against.
    const third = open('logger-third')

    // The one still open keeps its own logger; the closed one is left with none. The logger set
    // is process-wide, so the two are measured on the same lines.
    expect(await second.nextLine()).toBe(true)
    expect(first.lines()).toBe(closedAt)

    third.transport.close()
    second.transport.close()
  }, 30000)

  it('creates an account when it is not asked to defer', async () => {
    const transport = createNodeBridgeTransport({
      dbPath: join(dir, 'eager.db'),
      cacheDir: join(dir, 'cache'),
      rawKey: new Uint8Array(32).fill(3),
      deferAccount: false,
    })

    const info = new Promise<{ haveAccount: boolean; sessionId: string | undefined }>((resolve) => {
      transport.setSink((frame) => {
        if (frame.type !== 'response') return
        const result = frame.response.result
        if (result?.type === 'accountInfo')
          resolve({ haveAccount: result.info.haveAccount, sessionId: result.info.sessionId })
      })
    })

    transport.send({ id: 3, command: { type: 'getAccountInfo' } })

    const account = await info
    expect(account.haveAccount).toBe(true)
    expect(account.sessionId).toMatch(/^05[0-9a-f]{64}$/)

    transport.close()
  })

  it('reports a command libsession has no counterpart for, rather than failing silently', async () => {
    const transport = createNodeBridgeTransport({
      dbPath: join(dir, 'second.db'),
      cacheDir: join(dir, 'cache'),
      rawKey: new Uint8Array(32).fill(9),
      deferAccount: false,
    })

    const answered = new Promise<string | undefined>((resolve) => {
      transport.setSink((frame) => {
        if (frame.type === 'response' && frame.response.id === 2) resolve(frame.response.error)
      })
    })

    transport.send({
      id: 2,
      command: { type: 'approveConversation', conversationId: '05' + '00'.repeat(32) },
    })

    await expect(answered).resolves.toContain('approveConversation')
    transport.close()
  })

  it('answers a request the converter cannot read, on the stream', async () => {
    const transport = createNodeBridgeTransport({
      dbPath: join(dir, 'malformed.db'),
      cacheDir: join(dir, 'cache'),
      rawKey: new Uint8Array(32).fill(4),
      deferAccount: true,
    })

    const answered = new Promise<string | undefined>((resolve) => {
      transport.setSink((frame) => {
        if (frame.type === 'response' && frame.response.id === 8) resolve(frame.response.error)
      })
    })

    // A body that is not a string, sent past the type system the way a bug in the facade would.
    transport.send({
      id: 8,
      command: { type: 'setDisplayName', name: 5 as unknown as string },
    })

    await expect(answered).resolves.toMatch(/SetDisplayNameCommand\.name: expected a string/)
    transport.close()
  })

  it('refuses a number that no whole number can hold, rather than casting it', async () => {
    const transport = createNodeBridgeTransport({
      dbPath: join(dir, 'huge.db'),
      cacheDir: join(dir, 'cache'),
      rawKey: new Uint8Array(32).fill(6),
      deferAccount: true,
    })

    const answered = new Promise<string | undefined>((resolve) => {
      transport.setSink((frame) => {
        if (frame.type === 'response' && frame.response.id === 9) resolve(frame.response.error)
      })
    })

    // Casting this to int64_t is undefined behaviour, so the shim has to refuse it first.
    transport.send({
      id: 9,
      command: { type: 'deleteMessage', messageId: 1e300, scope: 'here' },
    })

    await expect(answered).resolves.toMatch(/deleteMessage\.messageId must be a whole number/)
    transport.close()
  })
})

/**
 * Every type in the protocol, out through the generated N-API converter and back in through it.
 *
 * `echoTestFrame` carries a frame to the shim and emits it verbatim, so what comes back has been
 * through from_napi and to_napi, field for field. `toStrictEqual` rather than `toEqual` because an
 * optional the converter wrote as `undefined` instead of leaving out would otherwise pass. The
 * structured clone is the desktop hop: what survives it is what the renderer receives.
 */
const describeEcho = existsSync(addon) && builtForTesting() ? describe : describe.skip

describeEcho('the generated converters', () => {
  const conversationId = '05' + 'ab'.repeat(32)
  const author = '05' + 'cd'.repeat(32)

  const fullConversation: Conversation = {
    id: conversationId,
    kind: 'dm',
    displayName: 'Alice ñ 日本',
    nickname: 'Al',
    lastActivity: 1_700_000_000_123,
    priority: 1,
    unreadCount: 3,
    markedUnread: true,
    snippet: 'see you',
    muteUntil: 1_700_000_100_000,
    autoDownload: 'image-attachments',
    request: true,
    awaitingApproval: false,
    noteToSelf: false,
    blocked: true,
  }
  const bareConversation: Conversation = {
    id: '03' + 'ef'.repeat(32),
    kind: 'group',
    displayName: '',
    lastActivity: 0,
    priority: 0,
    unreadCount: 0,
    markedUnread: false,
    request: false,
    awaitingApproval: false,
    noteToSelf: false,
    blocked: false,
  }
  const fullAttachment: Attachment = {
    index: 0,
    contentType: 'image/jpeg',
    filename: 'harbour ñ.jpg',
    caption: 'the harbour',
    size: 2_411_724,
    voiceMessage: true,
    width: 1600,
    height: 1200,
    uploaded: true,
    unavailable: true,
    savedAt: 1_700_000_200_000,
  }
  const bareAttachment: Attachment = {
    index: 1,
    voiceMessage: false,
    uploaded: false,
    unavailable: false,
  }
  const fullStatus: AttachmentStatus = {
    messageId: 42,
    index: 0,
    cached: true,
    transferring: true,
    done: 1_200_000,
    total: 2_411_748,
  }
  const bareStatus: AttachmentStatus = {
    messageId: 42,
    index: 1,
    cached: false,
    transferring: false,
    done: 0,
    total: 0,
  }
  const fullMessage: Message = {
    id: 42,
    conversationId,
    author,
    timestamp: 1_700_000_000_456,
    body: 'héllo',
    outgoing: true,
    sendState: 'uploading',
    syncState: 'pending',
    attachments: [fullAttachment, bareAttachment],
    galleryViewable: true,
    replyTo: { author, timestamp: 1_699_999_999_999, messageId: 7, body: 'orig' },
    deleted: 'here',
  }
  const bareMessage: Message = {
    id: 1,
    conversationId,
    author,
    timestamp: 1,
    body: '',
    outgoing: false,
    sendState: 'sent',
    attachments: [],
    galleryViewable: false,
  }

  const frames: Frame[] = [
    {
      type: 'response',
      response: {
        id: 900_001,
        result: {
          type: 'accountInfo',
          info: { haveAccount: true, sessionId: author, displayName: 'A', networkAttached: false },
        },
      },
    },
    {
      type: 'response',
      response: {
        id: 900_002,
        result: { type: 'accountInfo', info: { haveAccount: false, networkAttached: false } },
      },
    },
    { type: 'response', response: { id: 900_003, error: 'nope' } },
    {
      type: 'response',
      response: { id: 900_004, result: { type: 'mnemonic', words: ['a', 'b'] } },
    },
    {
      type: 'response',
      response: {
        id: 900_005,
        result: { type: 'conversationList', conversations: [fullConversation, bareConversation] },
      },
    },
    {
      type: 'response',
      response: { id: 900_006, result: { type: 'conversation', conversation: fullConversation } },
    },
    {
      type: 'response',
      response: {
        id: 900_007,
        result: {
          type: 'messageList',
          messages: [fullMessage, bareMessage],
          transfers: [fullStatus, bareStatus],
        },
      },
    },
    { type: 'response', response: { id: 900_008, result: { type: 'messageId', messageId: 99 } } },
    { type: 'response', response: { id: 900_009, result: { type: 'hex', hex: 'ff00' } } },
    { type: 'response', response: { id: 900_010, result: { type: 'pref', value: 'v' } } },
    { type: 'response', response: { id: 900_011, result: { type: 'pref' } } },
    { type: 'response', response: { id: 900_012, result: { type: 'bool', value: true } } },
    { type: 'response', response: { id: 900_013, result: { type: 'empty' } } },
    { type: 'response', response: { id: 900_014, result: { type: 'path', path: '/tmp/a (2).jpg' } } },
    { type: 'response', response: { id: 900_015, result: { type: 'byteCount', bytes: 5_000_000 } } },
    { type: 'response', response: { id: 900_016, result: { type: 'byteCount' } } },
    { type: 'event', event: { type: 'conversation-added', conversation: fullConversation } },
    { type: 'event', event: { type: 'conversation-updated', conversation: bareConversation } },
    { type: 'event', event: { type: 'conversation-removed', conversationId } },
    {
      type: 'event',
      event: { type: 'conversation-list-replaced', conversations: [fullConversation] },
    },
    { type: 'event', event: { type: 'request-list-replaced', conversations: [] } },
    { type: 'event', event: { type: 'message-added', conversationId, message: fullMessage } },
    { type: 'event', event: { type: 'message-updated', conversationId, message: bareMessage } },
    { type: 'event', event: { type: 'history-replaced', conversationId } },
    {
      type: 'event',
      event: {
        type: 'attachment-progress',
        transfer: 'download',
        conversationId,
        messageId: 42,
        index: 0,
        done: 0,
        total: 0,
      },
    },
    {
      type: 'event',
      event: {
        type: 'attachment-progress',
        transfer: 'save',
        conversationId,
        messageId: 42,
        index: 1,
        done: 2_411_748,
        total: 2_411_748,
        result: 0,
      },
    },
    { type: 'event', event: { type: 'log', message: 'm', category: 'c', level: 'info' } },
  ]

  it('round-trips every frame shape exactly, structured clone included', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'session-echo-'))
    const transport = createNodeBridgeTransport({
      dbPath: join(dir, 'echo.db'),
      cacheDir: join(dir, 'cache'),
      rawKey: new Uint8Array(32).fill(5),
      deferAccount: true,
    })

    const received: Frame[] = []
    const settled = new Map<number, () => void>()
    transport.setSink((frame) => {
      received.push(frame)
      if (frame.type === 'response') settled.get(frame.response.id)?.()
    })

    // The echoed frame arrives, then the acknowledgement for the request that carried it.
    async function echo(id: number, frame: Frame): Promise<Frame> {
      const done = new Promise<void>((resolve) => settled.set(id, resolve))
      const request: Request = { id, command: { type: 'echoTestFrame', frame } }
      // Only what arrives from here on belongs to this request, and the acknowledgement is not
      // guaranteed to sit directly behind the echo - a log line could land between them.
      const from = received.length
      transport.send(request)
      await done
      const echoingALog = frame.type === 'event' && frame.event.type === 'log'
      const echoed = received.slice(from).find((f) => {
        if (f.type === 'response' && f.response.id === id) return false
        // The logger emits its own log events, and one landing here would otherwise be compared
        // against the frame this request carried. Only skipped when that frame is not itself a
        // log, or the case that exists to prove logs round-trip would skip its own answer.
        if (!echoingALog && f.type === 'event' && f.event.type === 'log') return false
        return true
      })
      if (!echoed) throw new Error('the echoed frame did not arrive')
      return echoed
    }

    try {
      for (const [i, frame] of frames.entries()) {
        const echoed = await echo(i + 1, frame)
        expect(echoed).toStrictEqual(frame)
        expect(structuredClone(echoed)).toStrictEqual(frame)
      }
    } finally {
      transport.close()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
