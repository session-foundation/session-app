import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import type { Attachment, Conversation, Frame, Message, Request } from '@session/bridge-types'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createNodeBridgeTransport } from '#src/index'

/**
 * The addon against the real libsession, with no network attached.
 *
 * Skipped when the addon has not been built, because the per-PR job does not build the addon.
 * `turbo build:native` is what makes it run here.
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

  /**
   * A database that will not open -- here, one written under another key -- used to throw out of
   * the bridge's constructor, which left an app with nothing to ask and so nothing to show.
   */
  it('refuses requests with the reason a database will not open, until a discard replaces it', async () => {
    const opened = { dbPath: join(dir, 'unopenable.db'), cacheDir: join(dir, 'unopenable-cache') }
    const ask = async (
      transport: ReturnType<typeof createNodeBridgeTransport>,
      request: Request,
    ): Promise<Frame> => {
      const answered = new Promise<Frame>((resolve) => {
        transport.setSink((frame) => {
          if (frame.type === 'response' && frame.response.id === request.id) resolve(frame)
        })
      })
      transport.send(request)
      return answered
    }

    const first = createNodeBridgeTransport({
      ...opened,
      rawKey: new Uint8Array(32).fill(1),
      deferAccount: false,
    })
    await ask(first, { id: 1, command: { type: 'getAccountInfo' } })
    first.close()

    const wrongKey = createNodeBridgeTransport({
      ...opened,
      rawKey: new Uint8Array(32).fill(2),
      deferAccount: false,
    })
    const refused = await ask(wrongKey, { id: 2, command: { type: 'getAccountInfo' } })
    if (refused.type !== 'response') throw new Error('no response frame')
    expect(refused.response.error).toMatch(/^the bridge has no database open: ./)

    const discarded = await ask(wrongKey, { id: 3, command: { type: 'discardAccount' } })
    if (discarded.type !== 'response') throw new Error('no response frame')
    expect(discarded.response.error).toBeUndefined()

    const fresh = await ask(wrongKey, { id: 4, command: { type: 'getAccountInfo' } })
    if (fresh.type !== 'response' || fresh.response.result?.type !== 'accountInfo')
      throw new Error(
        `no account info: ${fresh.type === 'response' ? String(fresh.response.error) : ''}`,
      )
    expect(fresh.response.result.info.haveAccount).toBe(true)
    wrongKey.close()
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

  it('sends the files a message names, and answers one it cannot read rather than crashing', async () => {
    const transport = createNodeBridgeTransport({
      dbPath: join(dir, 'attachments.db'),
      cacheDir: join(dir, 'attachments-cache'),
      rawKey: new Uint8Array(32).fill(3),
      deferAccount: false,
    })
    const frames: Frame[] = []
    const waiting = new Map<number, (frame: Frame) => void>()
    transport.setSink((frame) => {
      frames.push(frame)
      if (frame.type === 'response') waiting.get(frame.response.id)?.(frame)
    })
    const ask = (id: number, command: Request['command']) =>
      new Promise<Frame>((resolve) => {
        waiting.set(id, resolve)
        transport.send({ id, command })
      })
    const photo = join(dir, 'été.jpg')
    await writeFile(photo, Buffer.alloc(2_000, 0xab))
    const conversationId = '05' + '12'.repeat(32)

    try {
      const refused = await ask(30, {
        type: 'sendMessage',
        conversationId,
        body: 'nothing there',
        attachments: [{ path: join(dir, 'no such file.jpg') }],
      })
      expect(refused.type === 'response' && refused.response.error).toMatch(
        /is not a readable file/,
      )

      const sent = await ask(31, {
        type: 'sendMessage',
        conversationId,
        body: '',
        attachments: [
          { path: photo, contentType: 'application/octet-stream', filename: 'for you.bin' },
        ],
      })
      if (sent.type !== 'response' || sent.response.result?.type !== 'messageId')
        throw new Error(`the send was not answered with an id: ${JSON.stringify(sent)}`)
      const messageId = sent.response.result.messageId
      const added = frames.flatMap((f) =>
        f.type === 'event' && f.event.type === 'messages-added' ? f.event.messages : [],
      )
      const stored = added.find((m) => m.id === messageId)
      expect(stored?.sendState).toBe('uploading')
      expect(
        stored?.attachments.map((a) => [a.index, a.filename, a.contentType, a.uploaded]),
      ).toEqual([[0, 'for you.bin', 'application/octet-stream', false]])
      expect(added.some((m) => m.body === 'nothing there')).toBe(false)

      // A copy handed over is libsession's once the send is answered, and stays the caller's
      // when the send is refused.
      const copy = join(dir, 'staged-copy.jpg')
      await writeFile(copy, Buffer.alloc(1_000, 0xcd))
      const refusedTaking = await ask(32, {
        type: 'sendMessage',
        conversationId,
        body: 'half there',
        attachments: [{ path: copy, takeFile: true }, { path: join(dir, 'gone.jpg') }],
      })
      expect(refusedTaking.type === 'response' && refusedTaking.response.error).toBeTruthy()
      expect(existsSync(copy)).toBe(true)
      const taken = await ask(33, {
        type: 'sendMessage',
        conversationId,
        body: 'taken',
        attachments: [{ path: copy, takeFile: true }],
      })
      expect(taken.type === 'response' && taken.response.result?.type).toBe('messageId')
      for (let round = 0; round < 100 && existsSync(copy); round += 1)
        await new Promise((resolve) => setTimeout(resolve, 20))
      expect(existsSync(copy)).toBe(false)

      // Taking through a link would delete a file the caller never named.
      const target = join(dir, 'linked-target.jpg')
      const link = join(dir, 'staged-link.jpg')
      await writeFile(target, Buffer.alloc(1_000, 0xcd))
      await symlink(target, link)
      const refusedLink = await ask(34, {
        type: 'sendMessage',
        conversationId,
        body: 'linked',
        attachments: [{ path: link, takeFile: true }],
      })
      expect(refusedLink.type === 'response' && refusedLink.response.error).toMatch(/symbolic link/)
      expect(existsSync(target)).toBe(true)
    } finally {
      transport.close()
    }
  })

  it('rejects a media fetch for a message that does not exist', async () => {
    const transport = createNodeBridgeTransport({
      dbPath: join(dir, 'no-media.db'),
      cacheDir: join(dir, 'cache'),
      deferAccount: true,
    })

    await expect(transport.fetchMedia({ messageId: 424_242, index: 0 })).rejects.toThrow(
      'attachment 0 of message 424242 does not exist',
    )
    await expect(transport.fetchThumbhash({ messageId: 424_242, index: 0 })).rejects.toThrow(
      'attachment 0 of message 424242 does not exist',
    )
    transport.close()
  })

  it('rejects a media fetch still pending when it closes', async () => {
    const transport = createNodeBridgeTransport({
      dbPath: join(dir, 'closing-media.db'),
      cacheDir: join(dir, 'cache'),
      deferAccount: true,
    })

    const media = transport.fetchMedia({ messageId: 1, index: 0 })
    const thumbhash = transport.fetchThumbhash({ messageId: 1, index: 0 })
    transport.close()

    await expect(media).rejects.toThrow('the bridge is closed')
    await expect(thumbhash).rejects.toThrow('the bridge is closed')
  })

  it('opens at the thumbnail edge it is given, unless an edge is stored, across reopens', async () => {
    const open = (thumbnailEdgePx: number) => {
      // The addon reads this by a hand-typed key: misspelt, it compiles and opens at the default.
      const transport = createNodeBridgeTransport({
        dbPath: join(dir, 'thumbnail-edge.db'),
        cacheDir: join(dir, 'cache'),
        rawKey: new Uint8Array(32).fill(5),
        deferAccount: true,
        thumbnailEdgePx,
      })
      let id = 0
      const ask = (command: Request['command']) => {
        const request = { id: ++id, command }
        const answered = new Promise<Frame>((resolve) => {
          transport.setSink((frame) => {
            if (frame.type === 'response' && frame.response.id === request.id) resolve(frame)
          })
        })
        transport.send(request)
        return answered
      }
      return {
        edge: async () => {
          const frame = await ask({ type: 'getThumbnailEdge' })
          if (frame.type !== 'response' || frame.response.result?.type !== 'edge')
            throw new Error(
              `no edge: ${frame.type === 'response' ? String(frame.response.error) : ''}`,
            )
          return frame.response.result.edgePx
        },
        setEdge: (edgePx: number) => ask({ type: 'setThumbnailEdge', edgePx }),
        unsetEdge: () => ask({ type: 'setThumbnailEdge' }),
        close: () => transport.close(),
      }
    }

    const first = open(300)
    expect(await first.edge()).toBe(300)
    await first.setEdge(500)
    expect(await first.edge()).toBe(500)
    first.close()

    // The app passes its display's edge at every launch; that must not discard the user's choice.
    const second = open(300)
    expect(await second.edge()).toBe(500)
    await second.unsetEdge()
    expect(await second.edge()).toBe(300)
    second.close()

    const third = open(300)
    expect(await third.edge()).toBe(300)
    third.close()

    const fourth = open(400)
    expect(await fourth.edge()).toBe(400)
    fourth.close()
  })

  it('lets the process exit with a media fetch pending at close', async () => {
    // A thread-safe function still referenced keeps the event loop alive, which in a worker
    // means a test run that never ends; a child process makes that a timeout here instead.
    const script = `
      const { SessionBridge } = require(process.env.ADDON)
      const bridge = new SessionBridge(
        { dbPath: process.env.DB_PATH, cacheDir: process.env.CACHE_DIR, deferAccount: true },
        () => {},
      )
      bridge.fetchMedia(1, 0).then(() => console.log('resolved'), (e) => console.log(e.message))
      bridge.close()
    `
    const { stdout } = await promisify(execFile)(process.execPath, ['-e', script], {
      env: {
        ...process.env,
        ADDON: addon,
        DB_PATH: join(dir, 'exiting.db'),
        CACHE_DIR: join(dir, 'cache'),
      },
      timeout: 20_000,
    })
    expect(stdout.trim()).toBe('the bridge is closed')
  }, 30_000)
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
    sizeBytes: 2_411_724,
    voiceMessage: true,
    width: 1600,
    height: 1200,
    hasThumbhash: true,
    // Not a whole number, so a converter that rounds or truncates cannot pass.
    thumbhashAspect: 7 / 5,
    hasThumbnail: true,
    // Portrait, so a width and height swapped in the frame cannot pass.
    thumbnailWidthPx: 540,
    thumbnailHeightPx: 720,
    hasRendition: true,
    // Never with a rendition from libsession; set here only so the frame carries both values.
    renditionRefused: true,
    originalFile: true,
    uploaded: true,
    availability: 'notFound',
    fetchDoneBytes: 0,
    fetchTotalBytes: 0,
    savedAtMs: 1_700_000_200_000,
  }
  const bareAttachment: Attachment = {
    index: 1,
    voiceMessage: false,
    hasThumbhash: false,
    hasThumbnail: false,
    thumbnailWidthPx: 0,
    thumbnailHeightPx: 0,
    hasRendition: false,
    renditionRefused: false,
    originalFile: false,
    uploaded: false,
    availability: 'absent',
    fetchDoneBytes: 0,
    fetchTotalBytes: 0,
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
    gallery: true,
    replyTo: {
      author,
      timestamp: 1_699_999_999_999,
      messageId: 7,
      message: {
        id: 7,
        outgoing: false,
        body: 'orig',
        attachments: [fullAttachment, bareAttachment],
      },
    },
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
    gallery: false,
  }
  /** A reply whose original was deleted, and one whose original never arrived. */
  const replyToDeleted: Message = {
    ...bareMessage,
    id: 2,
    replyTo: {
      author,
      timestamp: 5,
      messageId: 3,
      message: { id: 3, outgoing: true, body: '', attachments: [], deleted: 'everywhere' },
    },
  }
  const replyToMissing: Message = { ...bareMessage, id: 4, replyTo: { author, timestamp: 6 } }

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
      response: { id: 900_020, error: 'The file server no longer has it', code: 'file.not_found' },
    },
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
          type: 'messagePage',
          messages: [fullMessage, bareMessage, replyToDeleted, replyToMissing],
          hasNewer: true,
          hasOlder: false,
        },
      },
    },
    { type: 'response', response: { id: 900_008, result: { type: 'messageId', messageId: 99 } } },
    { type: 'response', response: { id: 900_009, result: { type: 'hex', hex: 'ff00' } } },
    { type: 'response', response: { id: 900_010, result: { type: 'pref', value: 'v' } } },
    { type: 'response', response: { id: 900_011, result: { type: 'pref' } } },
    { type: 'response', response: { id: 900_012, result: { type: 'bool', value: true } } },
    {
      type: 'response',
      response: {
        id: 900_101,
        result: {
          type: 'clientClosed',
          closed: true,
          // Not whole numbers, so a converter that rounds or truncates cannot pass.
          waitedMs: 9_999.5,
          closeMs: 2_161.25,
          outboundBusy: true,
          interrupted: true,
          interruptedForReopen: true,
        },
      },
    },
    { type: 'response', response: { id: 900_013, result: { type: 'empty' } } },
    { type: 'response', response: { id: 900_050, result: { type: 'seedHidden' } } },
    {
      type: 'response',
      response: { id: 900_014, result: { type: 'path', path: '/tmp/a (1).jpg' } },
    },
    {
      type: 'response',
      response: { id: 900_015, result: { type: 'byteCount', bytes: 5_000_000 } },
    },
    { type: 'response', response: { id: 900_016, result: { type: 'byteCount' } } },
    // A file server's upload limit is a uint64, so one past 32 bits has to cross whole.
    {
      type: 'response',
      response: { id: 900_021, result: { type: 'byteCount', bytes: 5_000_000_000 } },
    },
    { type: 'response', response: { id: 900_017, result: { type: 'edge', edgePx: 720 } } },
    {
      type: 'response',
      response: {
        id: 900_018,
        result: {
          type: 'configSizes',
          sizes: [
            { name: 'user_profile', bytes: 312 },
            { name: 'contacts', bytes: 18_400 },
          ],
        },
      },
    },
    { type: 'response', response: { id: 900_019, result: { type: 'configSizes', sizes: [] } } },
    // Every PathDestination once, and a hop with no country beside one with.
    {
      type: 'response',
      response: {
        id: 900_060,
        result: {
          type: 'networkPaths',
          snapshot: {
            // Every PathDestination once: the enum's names are what the converters spell.
            paths: (['ownSwarm', 'storageNode', 'fileServer', 'anyNode', 'anyFile'] as const).map(
              (destination, i) => ({
                remoteHex: String(i).repeat(64),
                destination,
                standby: i === 1,
                hops: [{ pubkeyHex: 'a'.repeat(64), country: 'DE' }, { pubkeyHex: 'b'.repeat(64) }],
                latencyMs: 240 + i,
                jitterMs: 12.5,
                requestsSent: 9_007_199_254_740_991,
                proxiedRequestsSent: 0,
                // Present on one path only: absent is its own case, a remote nothing went to.
                ...(i === 0 ? { msSinceLastRequest: 1_234 } : {}),
                pingsAnswered: 2_147_483_647,
              }),
            ),
            nodesByCountry: [
              { country: 'DE', nodes: 412 },
              { country: 'US', nodes: 230 },
            ],
            countryAttribution: 'IP Geolocation by DB-IP (https://db-ip.com)',
          },
        },
      },
    },
    {
      type: 'response',
      response: {
        id: 900_061,
        result: {
          type: 'networkPaths',
          snapshot: { paths: [], nodesByCountry: [], countryAttribution: '' },
        },
      },
    },
    ...(
      [
        'reencoded',
        'as-is',
        'original-cannot-decode',
        'original-animated-png',
        'too-large-to-decode',
        'too-large-for-server',
        'unreadable',
        'missing',
      ] as const
    ).map((plan, at): Frame => ({
      type: 'response',
      response: { id: 900_100 + at, result: { type: 'sendPlan', plan } },
    })),
    // Every NetworkStatus value once: the enum's names are what the converters spell.
    ...(['unknown', 'connecting', 'connected', 'disconnected'] as const).map((status, at) => ({
      type: 'response' as const,
      response: { id: 900_020 + at, result: { type: 'networkStatus' as const, status } },
    })),
    // Both ends of a placement set, then the least of one: `after` absent and `from` none.
    {
      type: 'event',
      event: {
        type: 'conversation-added',
        conversation: fullConversation,
        placement: { from: 'requests', to: 'conversations', after: conversationId },
      },
    },
    {
      type: 'event',
      event: {
        type: 'conversation-updated',
        conversation: bareConversation,
        placement: { from: 'none', to: 'requests' },
      },
    },
    // Every ConversationList value once, as with NetworkStatus above.
    ...(['none', 'conversations', 'requests'] as const).map((list): Frame => ({
      type: 'event',
      event: { type: 'conversation-removed', conversationId, list },
    })),
    { type: 'event', event: { type: 'messages-added', messages: [fullMessage] } },
    { type: 'event', event: { type: 'messages-updated', messages: [bareMessage] } },
    { type: 'event', event: { type: 'history-replaced', conversationId } },
    {
      type: 'event',
      event: {
        type: 'attachment-progress',
        transfer: 'download',
        messageId: 42,
        index: 0,
        doneBytes: 0,
        totalBytes: 0,
      },
    },
    {
      type: 'event',
      event: {
        type: 'attachment-progress',
        transfer: 'export',
        messageId: 42,
        index: 1,
        doneBytes: 2_411_748,
        totalBytes: 2_411_748,
        outcome: { ok: true },
      },
    },
    {
      type: 'event',
      event: {
        type: 'attachment-progress',
        transfer: 'upload',
        messageId: 43,
        index: 2,
        doneBytes: 0,
        totalBytes: 0,
        outcome: { ok: false, error: 'network.unavailable' },
      },
    },
    { type: 'event', event: { type: 'log', message: 'm', category: 'c', level: 'info' } },
    { type: 'event', event: { type: 'network-status-changed', status: 'connected' } },
    { type: 'event', event: { type: 'network-status-changed', status: 'disconnected' } },
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

/** The addon's own class, for what the transport does not expose. */
interface RawBridge {
  call(request: Request): void
  databasesReplaced(): number
  close(): void
}

describeAddon('the database-replaced hook', () => {
  let dir: string
  // A skipped suite still runs its body to collect tests, so the load waits for beforeAll.
  let open: (name: string) => RawBridge

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'session-replaced-'))
    const { SessionBridge } = createRequire(import.meta.url)(addon) as {
      SessionBridge: new (options: object, onFrame: (frame: Frame) => void) => RawBridge
    }
    open = (name) =>
      new SessionBridge(
        {
          dbPath: join(dir, `${name}.db`),
          cacheDir: join(dir, `${name}-cache`),
          rawKey: new Uint8Array(32).fill(9),
          deferAccount: true,
        },
        () => undefined,
      )
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('is called once a discard has replaced the database', () => {
    const bridge = open('discarded')
    try {
      bridge.call({ id: 1, command: { type: 'createAccount' } })
      expect(bridge.databasesReplaced()).toBe(0)

      bridge.call({ id: 2, command: { type: 'discardAccount' } })
      expect(bridge.databasesReplaced()).toBe(1)
    } finally {
      bridge.close()
    }
  })

  it('is called by the sweep at startup, and only for an account nobody kept', () => {
    const abandoned = open('abandoned')
    abandoned.call({ id: 1, command: { type: 'createAccount' } })
    abandoned.close()
    const kept = open('kept')
    kept.call({ id: 1, command: { type: 'createAccount' } })
    kept.call({ id: 2, command: { type: 'keepAccount' } })
    kept.close()

    const swept = open('abandoned')
    const reopened = open('kept')
    try {
      expect(swept.databasesReplaced()).toBe(1)
      expect(reopened.databasesReplaced()).toBe(0)
    } finally {
      swept.close()
      reopened.close()
    }
  })
})
