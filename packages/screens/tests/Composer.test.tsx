import { memoryPorts, resetPorts, setPorts, type PickedFile } from '@session/app'
import { formatBytes, MAX_ATTACHMENTS_PER_MESSAGE } from '@session/basic-types'
import type { SendPlan } from '@session/client'
import { PENDING_COPY, tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import type * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  Composer,
  DetachedComposer,
  type ComposerReplyTarget,
  type ComposerSeed,
} from '#src/Composer'
import { PLAN_GIVES_UP_AFTER_MS, useStaging, type StagingState } from '#src/useStaging'

/**
 * A renderer just big enough for the composer: hook state lives in slots taken in call order, as
 * React's does, and a render walks the element tree it returns, running its local components.
 */
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], nextSlot: 0 }))

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useState: (initial: unknown) => {
    const at = hooks.nextSlot++
    if (!(at in hooks.slots)) hooks.slots[at] = initial
    return [
      hooks.slots[at],
      (value: unknown) => {
        hooks.slots[at] =
          typeof value === 'function'
            ? (value as (was: unknown) => unknown)(hooks.slots[at])
            : value
      },
    ]
  },
  useRef: (current: unknown) => {
    const at = hooks.nextSlot++
    if (!(at in hooks.slots)) hooks.slots[at] = { current }
    return hooks.slots[at]
  },
  useCallback: (callback: unknown) => callback,
  useEffect: () => undefined,
}))

vi.mock('@session/ui', () => {
  const named = (name: string) => name
  return {
    ATTACH_OPENS_MENU: false,
    Announcement: named('Announcement'),
    Button: named('Button'),
    ComposerNotice: named('ComposerNotice'),
    ComposerReply: named('ComposerReply'),
    Icon: named('Icon'),
    Input: named('Input'),
    PressArea: named('PressArea'),
    Sheet: named('Sheet'),
    StagedTile: named('StagedTile'),
    StagedTray: named('StagedTray'),
    Text: named('Text'),
    XStack: named('XStack'),
    YStack: named('YStack'),
  }
})

interface Element {
  type: unknown
  props: Record<string, unknown> & { children?: unknown }
}

function isElement(node: unknown): node is Element {
  return typeof node === 'object' && node !== null && 'props' in node && 'type' in node
}

/** Every host element below `node`, local components rendered in place. */
function hostElements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(hostElements)
  if (!isElement(node)) return []
  if (typeof node.type === 'function')
    return hostElements((node.type as (props: unknown) => unknown)(node.props))
  return [node, ...hostElements(node.props.children)]
}

let onSend: ReturnType<typeof vi.fn<(body: string, files: readonly PickedFile[]) => Promise<void>>>
let planSend: (file: PickedFile) => Promise<SendPlan>

/** What the composer is answering, when a test sets it. */
let replying: { reply: ComposerReplyTarget; onCancelReply: () => void } | undefined

/** One render of a conversation's composer and the staging it is given. */
function render(): { staging: StagingState; find: (testID: string) => Element | undefined } {
  hooks.nextSlot = 0
  const staging = useStaging((file) => planSend(file))
  const tree = Composer({ staging, onSend, ...replying, focusSerial: 3 })
  const elements = hostElements(tree)
  return {
    staging,
    // The announcement has no test id, and there is one.
    find: (testID) =>
      elements.find((element) =>
        testID === 'announcement'
          ? element.type === 'Announcement'
          : element.props.testID === testID,
      ),
  }
}

function press(testID: string): void {
  const target = render().find(testID)
  ;(target?.props.onPress as () => void)()
}

function type(text: string): void {
  ;(render().find(ELEMENT.conversation.composerInput)?.props.onChangeText as (t: string) => void)(
    text,
  )
}

function deferred() {
  let settle: { resolve: () => void; reject: (error: Error) => void } | undefined
  const promise = new Promise<void>((resolve, reject) => {
    settle = { resolve, reject }
  })
  return { promise, ...(settle as NonNullable<typeof settle>) }
}

const PHOTO_BYTES = 4

const photo: PickedFile = { path: '/home/a/photo.jpg', name: 'photo.jpg', size: PHOTO_BYTES }

beforeEach(() => {
  setPorts(memoryPorts())
  hooks.slots = []
  planSend = () => Promise.resolve('as-is')
  replying = undefined
})

afterEach(() => {
  resetPorts()
})

describe('the composer while a send is out', () => {
  it('sends once however often Send is pressed', async () => {
    const answer = deferred()
    onSend = vi.fn(() => answer.promise)
    await render().staging.add([photo])
    type('hi')
    press(ELEMENT.conversation.sendButton)
    press(ELEMENT.conversation.sendButton)
    expect(render().find(ELEMENT.conversation.sendButton)?.props.disabled).toBe(true)
    expect(onSend).toHaveBeenCalledTimes(1)
    answer.resolve()
    await answer.promise
    await Promise.resolve()
    expect(render().staging.files).toEqual([])
  })

  it('holds the staging as sending until libsession answers, either way', async () => {
    for (const settle of ['resolve', 'reject'] as const) {
      const answer = deferred()
      onSend = vi.fn(() => answer.promise)
      type('hi')
      press(ELEMENT.conversation.sendButton)
      expect(render().staging.sending).toBe(true)
      answer[settle](new Error('refused'))
      await answer.promise.catch(() => undefined)
      await Promise.resolve()
      expect(render().staging.sending).toBe(false)
    }
  })

  it('disables removing and clearing what it is sending', async () => {
    onSend = vi.fn(() => deferred().promise)
    await render().staging.add([photo])
    press(ELEMENT.conversation.sendButton)
    const { find } = render()
    expect(find(ELEMENT.conversation.stagedTray)?.props.clearDisabled).toBe(true)
    expect(find(ELEMENT.conversation.stagedTile(0))?.props.removeDisabled).toBe(true)
  })
})

describe('the composer while replying', () => {
  const answered: ComposerReplyTarget = {
    heading: 'Replying to Bob',
    message: { id: 4, outgoing: false, body: 'Are we still on?', attachments: [] },
  }
  const bar = () => render().find(ELEMENT.conversation.composerReply)
  const input = () => render().find(ELEMENT.conversation.composerInput)

  it('draws no bar, and gives Escape nothing to do, while not replying', () => {
    expect(bar()).toBeUndefined()
    expect(input()?.props.onEscape).toBeUndefined()
  })

  it('heads the bar with what it answers, named as the close button is', () => {
    replying = { reply: answered, onCancelReply: vi.fn() }
    expect(bar()?.props).toMatchObject({
      heading: 'Replying to Bob',
      message: answered.message,
      closeLabel: tr('close'),
      closeTestID: ELEMENT.conversation.composerReplyClose,
    })
  })

  it('stops replying from the X and from Escape in the input, keeping what was typed', () => {
    const onCancelReply = vi.fn()
    replying = { reply: answered, onCancelReply }
    type('half a thought')
    ;(bar()?.props.onClose as () => void)()
    ;(input()?.props.onEscape as () => void)()
    expect(onCancelReply).toHaveBeenCalledTimes(2)
    expect(input()?.props.value).toBe('half a thought')
  })

  it('hands the input the focus request a reply makes', () => {
    expect(input()?.props.focusSerial).toBe(3)
  })
})

describe('a staged tile', () => {
  // A right-to-left name sets the tile's direction, which a picture shows only for one name.
  it('isolates its size, so no name’s direction puts the unit first', async () => {
    const unsized: PickedFile = { path: '/home/a/notes.txt', name: 'notes.txt' }
    await render().staging.add([photo, unsized])
    const { find } = render()
    const tile = find(ELEMENT.conversation.stagedTile(0))
    expect(tile?.props.sizeLabel).toBe(`\u2068${formatBytes(PHOTO_BYTES)}\u2069`)
    expect(tile?.props.label).toBe(`photo.jpg, ${formatBytes(PHOTO_BYTES)}`)
    expect(find(ELEMENT.conversation.stagedTile(1))?.props.sizeLabel).toBeUndefined()
  })
})

describe('the draft after a send went', () => {
  async function sendWhileTyping(sent: string, ...meanwhile: string[]): Promise<unknown> {
    const answer = deferred()
    onSend = vi.fn(() => answer.promise)
    type(sent)
    press(ELEMENT.conversation.sendButton)
    for (const typed of meanwhile) type(typed)
    answer.resolve()
    await answer.promise
    await Promise.resolve()
    return render().find(ELEMENT.conversation.composerInput)?.props.value
  }

  it('is empty when nothing was typed while it was out', async () => {
    expect(await sendWhileTyping('hi')).toBe('')
  })

  it('keeps only what was typed after the sent text', async () => {
    expect(await sendWhileTyping('hi', 'hi ', 'hi there')).toBe('there')
  })

  it('keeps a draft cleared and retyped whole, even one starting with the sent text', async () => {
    expect(await sendWhileTyping('ok', '', 'o', 'ok', 'okay')).toBe('okay')
  })
})

describe('a refused send', () => {
  it.each([
    ['with files', [photo], tr('attachmentsErrorSending')],
    ['of text alone', [], tr('messageStatusFailedToSend')],
  ])('%s keeps the draft and the tray and says it failed', async (_, files, message) => {
    const answer = deferred()
    onSend = vi.fn(() => answer.promise)
    await render().staging.add(files)
    type('hi')
    press(ELEMENT.conversation.sendButton)
    answer.reject(new Error('refused'))
    await answer.promise.catch(() => undefined)
    // A refused send of files asks each file's plan again before saying so.
    await vi.waitFor(() => {
      expect(render().find(ELEMENT.conversation.composerNotice('send'))).toBeDefined()
    })
    const { staging, find } = render()
    expect(staging.files).toEqual(files)
    expect(find(ELEMENT.conversation.composerInput)?.props.value).toBe('hi')
    expect(find(ELEMENT.conversation.composerNotice('send'))?.props.message).toBe(message)
    expect(find('announcement')?.props.text).toBe(`${message}.`)
  })
})

describe('staging by libsession’s plan', () => {
  it.each([
    ['too-large-for-server', 'size', tr('attachmentsErrorSize')],
    ['too-large-to-decode', 'pixels', PENDING_COPY.attachmentsErrorImageTooLarge],
    ['unreadable', 'open', tr('attachmentsErrorOpen')],
    ['missing', 'open', tr('attachmentsErrorOpen')],
  ] as const)('refuses a file planned %s, naming it', async (plan, id, message) => {
    planSend = (file) => Promise.resolve(file === photo ? plan : 'as-is')
    const notes: PickedFile = { path: '/home/a/notes.txt', name: 'notes.txt' }
    await render().staging.add([photo, notes])
    const { staging, find } = render()
    expect(staging.files).toEqual([notes])
    const notice = find(ELEMENT.conversation.composerNotice(id))
    expect(notice?.props.message).toBe(message)
    expect(String(notice?.props.detail)).toMatch(/^\u2068photo\.jpg\u2069/)
    expect(find('announcement')?.props.text).toContain('photo.jpg')
  })

  it.each(['reencoded', 'as-is', 'original-cannot-decode', 'original-animated-png'] as const)(
    'stages a file planned %s',
    async (plan) => {
      planSend = () => Promise.resolve(plan)
      await render().staging.add([photo])
      expect(render().staging.files).toEqual([photo])
      expect(render().staging.refused.tooLarge).toEqual([])
    },
  )

  it('refuses a file whose plan could not be asked for', async () => {
    planSend = () => Promise.reject(new Error('bridge closed'))
    await render().staging.add([photo])
    expect(render().staging.files).toEqual([])
    expect(render().find(ELEMENT.conversation.composerNotice('open'))).toBeDefined()
  })

  it('holds a send of staged files until every plan is in, and sends them all with the text', async () => {
    const notes: PickedFile = { path: '/home/a/notes.txt', name: 'notes.txt' }
    await render().staging.add([notes])
    let answer: (plan: SendPlan) => void = () => undefined
    planSend = () =>
      new Promise((resolve) => {
        answer = resolve
      })
    onSend = vi.fn(() => deferred().promise)
    const staged = render().staging.add([photo])
    type('hi')
    expect(render().staging.planning).toBe(true)
    expect(render().find(ELEMENT.conversation.sendButton)?.props.disabled).toBe(true)
    press(ELEMENT.conversation.sendButton)
    expect(onSend).not.toHaveBeenCalled()
    answer('reencoded')
    await staged
    expect(render().find(ELEMENT.conversation.sendButton)?.props.disabled).toBe(false)
    press(ELEMENT.conversation.sendButton)
    expect(onSend).toHaveBeenCalledWith('hi', [notes, photo])
  })

  it('sends text alone while a pick is still planned, and stages the pick after', async () => {
    let answer: (plan: SendPlan) => void = () => undefined
    planSend = () =>
      new Promise((resolve) => {
        answer = resolve
      })
    onSend = vi.fn(() => Promise.resolve())
    const staged = render().staging.add([photo])
    type('hi')
    expect(render().find(ELEMENT.conversation.sendButton)?.props.disabled).toBe(false)
    press(ELEMENT.conversation.sendButton)
    expect(onSend).toHaveBeenCalledWith('hi', [])
    answer('as-is')
    await staged
    expect(render().staging.files).toEqual([photo])
  })

  it('refuses a file whose plan never answers, so Send is not held for good', async () => {
    vi.useFakeTimers()
    try {
      planSend = () => new Promise(() => undefined)
      const staged = render().staging.add([photo])
      expect(render().staging.planning).toBe(true)
      await vi.advanceTimersByTimeAsync(PLAN_GIVES_UP_AFTER_MS)
      await staged
      expect(render().staging.planning).toBe(false)
      expect(render().staging.files).toEqual([])
      expect(render().find(ELEMENT.conversation.composerNotice('open'))).toBeDefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a file dropped again unchanged as it was staged, without asking its plan again', async () => {
    const asked = vi.fn(() => Promise.resolve<SendPlan>('as-is'))
    planSend = asked
    const released: PickedFile[] = []
    const ports = memoryPorts()
    setPorts({
      ...ports,
      files: {
        ...ports.files,
        releasePreview: (file) => {
          released.push(file)
        },
      },
    })
    const first = { ...photo, modifiedMs: 1000, previewUrl: 'session-media://picked/a' }
    await render().staging.add([first])
    const again = { ...first, previewUrl: 'session-media://picked/b' }
    await render().staging.add([again])
    expect(render().staging.files).toEqual([first])
    expect(asked).toHaveBeenCalledTimes(1)
    expect(released).toEqual([again])
    const edited = { ...first, modifiedMs: 2000, previewUrl: 'session-media://picked/c' }
    await render().staging.add([edited])
    expect(render().staging.files).toEqual([edited])
  })

  it('names a staged file gone before Send and takes it out of the tray', async () => {
    const notes: PickedFile = { path: '/home/a/notes.txt', name: 'notes.txt' }
    await render().staging.add([photo, notes])
    onSend = vi.fn(() => Promise.reject(new Error('attachment is not a readable file')))
    planSend = (file) => Promise.resolve(file === notes ? 'missing' : 'as-is')
    press(ELEMENT.conversation.sendButton)
    await vi.waitFor(() => {
      expect(render().staging.planning).toBe(false)
      expect(render().staging.files).toEqual([photo])
    })
    expect(render().staging.refused.unopenable).toEqual([notes])
    expect(render().staging.refused.sendRefused).toBe('none')
    expect(render().find(ELEMENT.conversation.composerNotice('open'))?.props.detail).toBe(
      'notes.txt',
    )
  })

  it('says a send was refused when every staged file still plans to send', async () => {
    await render().staging.add([photo])
    onSend = vi.fn(() => Promise.reject(new Error('refused')))
    press(ELEMENT.conversation.sendButton)
    await vi.waitFor(() => {
      expect(render().staging.refused.sendRefused).toBe('files')
    })
    expect(render().staging.files).toEqual([photo])
  })

  it('stages picks in the order they were made, whichever plan answers first', async () => {
    const answers: ((plan: SendPlan) => void)[] = []
    planSend = () =>
      new Promise((resolve) => {
        answers.push(resolve)
      })
    const notes: PickedFile = { path: '/home/a/notes.txt', name: 'notes.txt' }
    const first = render().staging.add([photo])
    const second = render().staging.add([notes])
    answers[1]?.('as-is')
    answers[0]?.('reencoded')
    await Promise.all([first, second])
    expect(render().staging.files).toEqual([photo, notes])
  })
})

describe('the detached composer', () => {
  const notes: PickedFile = { path: '/home/a/notes.pdf', name: 'notes.pdf', size: PHOTO_BYTES }

  function detached(seed: ComposerSeed) {
    hooks.nextSlot = 0
    const elements = hostElements(DetachedComposer({ seed }))
    return {
      elements,
      find: (testID: string) => elements.find((element) => element.props.testID === testID),
    }
  }

  it('draws a tile for each file it is seeded with, and no tray with none', () => {
    expect(detached({ files: [] }).find(ELEMENT.conversation.stagedTray)).toBeUndefined()
    const { elements } = detached({ files: [photo, notes] })
    expect(elements.filter((element) => element.type === 'StagedTile')).toHaveLength(2)
  })

  it('draws a notice for each refusal it is seeded with', () => {
    const { elements } = detached({ files: [photo], refused: { tooLarge: [notes], overLimit: 3 } })
    expect(
      elements.filter((element) => element.type === 'ComposerNotice').map((n) => n.props.message),
    ).toEqual([
      tr('attachmentsErrorSize'),
      PENDING_COPY.attachmentsErrorLimit(MAX_ATTACHMENTS_PER_MESSAGE),
    ])
  })

  it('takes the add tile away and disables + once full', () => {
    const full = Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE }, (_, at) => ({
      path: `/home/a/${String(at)}.jpg`,
      name: `${String(at)}.jpg`,
    }))
    const { find } = detached({ files: full })
    expect(find(ELEMENT.conversation.stagedTray)?.props.onAdd).toBeUndefined()
    expect(find(ELEMENT.conversation.attachButton)?.props.disabled).toBe(true)
  })
})
