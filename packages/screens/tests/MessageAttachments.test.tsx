import { ALBUM_WIDTH } from '@session/basic-types'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { memoryPorts, resetPorts, setPorts } from '@session/app'
import type { Attachment, ConversationId, Message } from '@session/client'
import { friends } from '@session/client/fake'
import {
  ALBUM_PICTURE_ID,
  ALBUM_TILE_ID,
  ATTACHMENT_ROW_IDS as IDS,
  attachmentFooterAction,
  FOOTER_ACTION_ID,
} from '@session/expectations'
import { byId, declared, nodeOf } from '@session/render-tier'
import { createSessionStore, emptyWindow, type SessionStore } from '@session/state'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'

import { AttachmentSheet, DetachedAttachmentSheet } from '#src/AttachmentSheet'
import { LIST_MAX_ROWS } from '#src/AttachmentList'
import type { ConversationUi } from '#src/conversationUi'
import { MessageAttachments } from '#src/MessageAttachments'
import { MessageMediaViewer } from '#src/MessageMediaViewer'

import { renderScreen } from './support/render'

const CONVERSATION = 'conversation' as ConversationId
const MESSAGE_ID = 7

function attachment(index: number, over: Partial<Attachment>): Attachment {
  return {
    index,
    voiceMessage: false,
    hasThumbhash: false,
    hasThumbnail: false,
    thumbnailWidthPx: 0,
    thumbnailHeightPx: 0,
    hasRendition: false,
    renditionRefused: false,
    originalFile: false,
    uploaded: true,
    availability: 'absent',
    fetchDoneBytes: 0,
    fetchTotalBytes: 0,
    ...over,
  }
}

const picture = (index: number, over: Partial<Attachment> = {}) =>
  attachment(index, { contentType: 'image/jpeg', filename: `p${String(index)}.jpg`, ...over })
const document = (index: number) =>
  attachment(index, { contentType: 'application/pdf', filename: `d${String(index)}.pdf` })

/** More documents than a bubble lists, so it draws "Show all" under them. */
const PAPERWORK = Array.from({ length: LIST_MAX_ROWS + 1 }, (_, index) => document(index))

function message(attachments: Attachment[], outgoing: boolean): Message {
  return {
    id: MESSAGE_ID,
    attachments,
    outgoing,
    galleryViewable: true,
    gallery: true,
  } as unknown as Message
}

function storeWith(shown: Message): SessionStore {
  const client = friends(['Alice', 'Bob']).clients['Alice']
  if (client === undefined) throw new Error('fixture did not produce a client')
  const store = createSessionStore(client)
  store.setState({
    histories: {
      [CONVERSATION]: { ...emptyWindow, ready: true, messages: [shown] },
    },
  })
  return store
}

function conversation(): ConversationUi {
  return {
    conversationId: CONVERSATION,
    requestAutoDownloadPrompt: vi.fn(),
    openViewer: vi.fn(),
    openSheet: vi.fn(),
    openMenu: vi.fn(),
    reply: vi.fn(),
  }
}

function drawn(shown: Message) {
  return renderScreen(<MessageAttachments message={shown} width={ALBUM_WIDTH} />, {
    store: storeWith(shown),
    ui: conversation(),
  })
}

const colour = (element: Element | null | undefined) =>
  element === null || element === undefined ? undefined : declared(element).color

/** The ink of a row's name, of "Show all" and its count, and of the footer's caption. */
function listInks(): Record<string, string | undefined> {
  const showAll = byId(ELEMENT.conversation.attachmentShowAll)
  const [label, count] = showAll.querySelectorAll('span')
  return {
    name: colour(byId(IDS.name).querySelector('span:last-child')),
    showAll: colour(label),
    showAllCount: colour(count),
    footer: colour(
      byId(ELEMENT.conversation.attachmentFooter).querySelector(
        `[data-testid="${ELEMENT.conversation.attachmentState}"]`,
      ),
    ),
  }
}

afterEach(() => {
  resetPorts()
})

/**
 * A bubble you sent is `$primaryColor`, so the text and glyphs its attachments draw on it take
 * `$onAccent`; the same rows in the sheet sit on the page and keep the page roles.
 */
describe('attachments on a bubble you sent', () => {
  it('draw every row, "Show all" and the footer’s caption in the fill’s ink', () => {
    drawn(message(PAPERWORK, true))
    expect(listInks()).toEqual({
      name: 'var(--onAccent)',
      showAll: 'var(--onAccent)',
      showAllCount: 'var(--onAccent)',
      footer: 'var(--onAccent)',
    })
  })

  it('keep the page’s ink on a bubble you received', () => {
    drawn(message(PAPERWORK, false))
    expect(listInks()).toEqual({
      name: 'var(--textPrimary)',
      showAll: 'var(--accentText)',
      showAllCount: 'var(--textSecondary)',
      footer: 'var(--textSecondary)',
    })
  })

  it('ring an album’s tiles in the fill’s focus colour', () => {
    drawn(message([picture(0), picture(1)], true))
    expect(declared(byId(ALBUM_TILE_ID), ':focus-visible')['outline-color']).toBe('var(--onAccent)')
  })

  it('leave the footer’s button on its own fill, ringed in the fill’s focus colour', () => {
    const footerButton = () => byId(ELEMENT.conversation.attachmentAction)
    const { unmount } = drawn(message([picture(0), picture(1)], false))
    const received = declared(footerButton().firstElementChild!)['background-color']
    unmount()
    drawn(message([picture(0), picture(1)], true))
    expect(declared(footerButton().firstElementChild!)['background-color']).toBe(received)
    expect(declared(footerButton(), ':focus-visible')['outline-color']).toBe('var(--onAccent)')
  })

  it('are drawn on the page in the sheet, whoever sent them', () => {
    const shown = message(PAPERWORK, true)
    renderScreen(
      <AttachmentSheet
        conversationId={CONVERSATION}
        messageId={MESSAGE_ID}
        onClose={() => {}}
        overlay={null}
      />,
      { store: storeWith(shown), ui: conversation() },
    )
    expect(colour(byId(IDS.name).querySelector('span:last-child'))).toBe('var(--textPrimary)')
  })

  it('are drawn in the same sheet on the page, out of any modal', () => {
    const shown = message(PAPERWORK, true)
    renderScreen(<DetachedAttachmentSheet conversationId={CONVERSATION} messageId={MESSAGE_ID} />, {
      store: storeWith(shown),
      ui: conversation(),
    })
    expect(byId(ELEMENT.conversation.attachmentSheet)).toBeTruthy()
    expect(byId(ELEMENT.conversation.attachmentSheetList)).toBeTruthy()
    expect(colour(byId(IDS.name).querySelector('span:last-child'))).toBe('var(--textPrimary)')
  })
})

/** The `src` react-native-web hands its image, which is the url the place asked for. */
const sourceOf = (element: Element) => element.querySelector('img')?.getAttribute('src')

describe('which picture each place draws', () => {
  function serving(): void {
    setPorts(
      memoryPorts({
        media: {
          urlFor: ({ messageId, index }) => `file://${String(messageId)}/${String(index)}`,
          thumbhashUrlFor: () => null,
          renditionUrlFor: () => null,
          thumbnailUrlFor: ({ messageId, index }) =>
            `thumb://${String(messageId)}/${String(index)}`,
        },
      }),
    )
  }

  it('draws libsession’s thumbnail on an album’s tile, never the file', () => {
    serving()
    drawn(
      message(
        [0, 1].map((index) => picture(index, { hasThumbnail: true, availability: 'cached' })),
        false,
      ),
    )
    expect(sourceOf(byId(ALBUM_PICTURE_ID, 0))).toBe(`thumb://${String(MESSAGE_ID)}/0`)
    expect(sourceOf(byId(ALBUM_PICTURE_ID, 1))).toBe(`thumb://${String(MESSAGE_ID)}/1`)
  })

  it('draws libsession’s thumbnail on a row’s lead square, never the file', () => {
    serving()
    drawn(message([picture(0, { hasThumbnail: true, availability: 'cached' }), document(1)], false))
    expect(sourceOf(byId(IDS.thumbnail))).toBe(`thumb://${String(MESSAGE_ID)}/0`)
  })

  it('draws the file only for a picture libsession never thumbnails, once it is here', () => {
    serving()
    const bmp = attachment(0, {
      contentType: 'image/bmp',
      filename: 'scan.bmp',
      availability: 'cached',
    })
    drawn(message([bmp, document(1)], false))
    expect(sourceOf(byId(IDS.thumbnail))).toBe(`file://${String(MESSAGE_ID)}/0`)
  })

  it('draws the file in the viewer, never its thumbnail', () => {
    serving()
    const shown = message([picture(0, { hasThumbnail: true, availability: 'cached' })], false)
    renderScreen(
      <MessageMediaViewer
        conversationId={CONVERSATION}
        target={{ messageId: MESSAGE_ID, index: 0 }}
        onIndex={() => {}}
        onClose={() => {}}
      />,
      { store: storeWith(shown) },
    )
    expect(sourceOf(byId(ELEMENT.conversation.mediaViewerImage))).toBe(
      `file://${String(MESSAGE_ID)}/0`,
    )
  })
})

/** Every row control there is, by what it currently means. */
const rowControls = () =>
  [IDS.download, IDS.export, ELEMENT.conversation.attachmentRetry].filter(
    (id) => nodeOf(id) !== null,
  )

/**
 * A message's one attachment has one control, its footer's verb, in list view as under an album,
 * so switching views never moves it. Two or more keep a control on every row.
 */
describe('the controls of a message drawn as a list', () => {
  it('leave a lone document’s row without one, and give the footer’s verb its name', () => {
    drawn(message([document(0)], false))
    expect(nodeOf(IDS.row)).not.toBeNull()
    expect(rowControls()).toEqual([])
    expect(nodeOf(FOOTER_ACTION_ID)).toMatchObject(
      attachmentFooterAction({ state: 'idle', count: 1 }).desktop ?? {},
    )
  })

  it('leave a lone picture’s row without one when it is switched to a list', () => {
    drawn({ ...message([picture(0)], false), gallery: false })
    expect(nodeOf(IDS.lead)).not.toBeNull()
    expect(rowControls()).toEqual([])
    expect(nodeOf(FOOTER_ACTION_ID)).toMatchObject(
      attachmentFooterAction({ state: 'idle', count: 1 }).desktop ?? {},
    )
  })

  it('keep one on each of two rows, beside the footer’s download of both', () => {
    drawn(message([document(0), document(1)], false))
    expect(nodeOf(IDS.download, 0)).not.toBeNull()
    expect(nodeOf(IDS.download, 1)).not.toBeNull()
    expect(nodeOf(FOOTER_ACTION_ID)).toMatchObject(
      attachmentFooterAction({ state: 'idle', count: 2 }).desktop ?? {},
    )
  })

  it('leave the retry of our lone file that failed to send to the footer', () => {
    drawn({
      ...message([document(0)], true),
      sendState: 'failed',
      attachments: [{ ...document(0), uploaded: false }],
    })
    expect(rowControls()).toEqual([])
    expect(nodeOf(FOOTER_ACTION_ID)?.name).toBe(tr('retry'))
  })
})
