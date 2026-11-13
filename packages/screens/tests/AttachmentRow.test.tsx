import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { memoryPorts, resetPorts, setPorts } from '@session/app'
import type { Attachment, Message } from '@session/client'
import { friends } from '@session/client/fake'
import {
  ATTACHMENT_ROW_IDS as IDS,
  fileRow,
  type FileRowState,
  verbName,
} from '@session/expectations'
import { tr } from '@session/localization'
import { byId, nodeOf } from '@session/render-tier'
import { createSessionStore, transferKey, type SessionStore } from '@session/state'

import { AttachmentRow } from '#src/AttachmentRow'
import type { ConversationUi } from '#src/conversationUi'

import { renderScreen } from './support/render'

const MESSAGE_ID = 7

/** A received file's states: the rest are a file we are sending, which SendingRow draws. */
type ReceivedState = Exclude<FileRowState, 'queued' | 'uploaded' | 'unsent'>

const AVAILABILITY: Record<ReceivedState, Attachment['availability']> = {
  idle: 'absent',
  fetching: 'fetching',
  ready: 'cached',
  // A failure is the transfer's, not the file's: see `storeIn`.
  failed: 'absent',
  unavailable: 'notFound',
}

const CAPTION: Record<ReceivedState, string> = {
  idle: '',
  fetching: tr('downloading'),
  ready: '',
  failed: tr('failedToDownload'),
  unavailable: tr('attachmentsExpired'),
}

function attachment(
  state: ReceivedState,
  file: { filename: string; contentType: string },
): Attachment {
  return {
    index: 0,
    ...file,
    voiceMessage: false,
    hasThumbhash: false,
    hasThumbnail: false,
    thumbnailWidthPx: 0,
    thumbnailHeightPx: 0,
    hasRendition: false,
    renditionRefused: false,
    originalFile: false,
    uploaded: true,
    availability: AVAILABILITY[state],
    fetchDoneBytes: 0,
    fetchTotalBytes: 0,
  }
}

const PICTURE = { filename: 'harbour.jpg', contentType: 'image/jpeg', format: 'JPG' }
const DOCUMENT = { filename: 'report.pdf', contentType: 'application/pdf', format: 'PDF' }

function storeIn(state: ReceivedState): SessionStore {
  const client = friends(['Alice', 'Bob']).clients['Alice']
  if (client === undefined) throw new Error('fixture did not produce a client')
  const store = createSessionStore(client)
  if (state === 'failed')
    store.setState({
      transfers: {
        [MESSAGE_ID]: {
          [transferKey('download', 0)]: { state: 'failed', doneBytes: 0, totalBytes: 0 },
        },
      },
    })
  return store
}

function conversation(): ConversationUi {
  return {
    conversationId: 'conversation',
    requestAutoDownloadPrompt: vi.fn(),
    openViewer: vi.fn(),
    openSheet: vi.fn(),
    openMenu: vi.fn(),
    reply: vi.fn(),
  }
}

function row(state: ReceivedState, file: { filename: string; contentType: string }) {
  const shown = attachment(state, file)
  const message = { id: MESSAGE_ID, attachments: [shown] } as unknown as Message
  return <AttachmentRow message={message} attachment={shown} />
}

const ROW_VERB = {
  picture: { idle: 'download', fetching: null, ready: 'open', failed: 'retry', unavailable: null },
  document: {
    idle: 'download',
    fetching: null,
    ready: 'export',
    failed: 'retry',
    unavailable: null,
  },
} as const
const CONTROL_VERB = ROW_VERB.document

const STATES: ReceivedState[] = ['idle', 'fetching', 'ready', 'failed', 'unavailable']

afterEach(() => {
  resetPorts()
})

describe('an attachment row', () => {
  it.each(STATES.flatMap((state) => [['picture', state] as const, ['document', state] as const]))(
    'says the row’s verb and the control’s for a %s while %s',
    (kind, state) => {
      setPorts(memoryPorts())
      const file = kind === 'picture' ? PICTURE : DOCUMENT
      renderScreen(row(state, file), { store: storeIn(state), ui: conversation() })
      const rowVerb = ROW_VERB[kind][state]
      const controlVerb = CONTROL_VERB[state]
      const expected = fileRow({
        filename: file.filename,
        format: file.format,
        caption: CAPTION[state],
        state,
        rowVerb: rowVerb === null ? undefined : verbName(rowVerb),
        leadOpens: kind === 'picture' && state !== 'unavailable',
        leadVerb: rowVerb === null ? undefined : verbName(rowVerb),
        controlName:
          state === 'fetching'
            ? tr('downloading')
            : controlVerb === null
              ? undefined
              : verbName(controlVerb),
      })
      expect(nodeOf(IDS.row)).toMatchObject(expected.row.desktop!)
      if (expected.lead.desktop === null) expect(nodeOf(IDS.lead)).toBeNull()
      else expect(nodeOf(IDS.lead)).toMatchObject(expected.lead.desktop)
      const control = controlVerb === 'export' ? IDS.export : IDS.download
      if (expected.control.desktop === null) expect(nodeOf(control)).toBeNull()
      else expect(nodeOf(control)).toMatchObject(expected.control.desktop)
    },
  )

  it('opens a picture that is here in the viewer, from the row and from the lead square', async () => {
    const user = userEvent.setup()
    setPorts(memoryPorts())
    const ui = conversation()
    renderScreen(row('ready', PICTURE), { store: storeIn('ready'), ui })
    await user.click(byId(IDS.name))
    await user.click(byId(IDS.lead))
    expect(ui.openViewer).toHaveBeenCalledTimes(2)
    expect(ui.openViewer).toHaveBeenCalledWith(MESSAGE_ID, 0)
    expect(nodeOf(IDS.export)?.name).toBe(verbName('export'))
  })

  it('exports a picture that is here from its control, rather than opening it', async () => {
    const user = userEvent.setup()
    const ports = memoryPorts()
    const chooseExportLocation = vi.fn(() => Promise.resolve(null))
    setPorts({ ...ports, files: { ...ports.files, chooseExportLocation } })
    const ui = conversation()
    renderScreen(row('ready', PICTURE), { store: storeIn('ready'), ui })
    await user.click(byId(IDS.export))
    expect(chooseExportLocation).toHaveBeenCalledTimes(1)
    expect(ui.openViewer).not.toHaveBeenCalled()
  })

  it('fetches a picture that is not here, from the lead square as from the row', async () => {
    const user = userEvent.setup()
    setPorts(memoryPorts())
    const ui = conversation()
    renderScreen(row('idle', PICTURE), { store: storeIn('idle'), ui })
    await user.click(byId(IDS.lead))
    expect(ui.requestAutoDownloadPrompt).toHaveBeenCalledTimes(1)
    expect(ui.openViewer).not.toHaveBeenCalled()
  })
})
