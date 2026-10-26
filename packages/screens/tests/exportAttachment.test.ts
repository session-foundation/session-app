import {
  ExportAccessRefused,
  memoryPorts,
  resetPorts,
  setPorts,
  type FilesPort,
} from '@session/app'
import type { Attachment, AttachmentRef, Message } from '@session/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { exportOne } from '#src/exportAttachment'

function attachment(index: number, fields: Partial<Attachment> = {}): Attachment {
  return {
    index,
    contentType: 'application/pdf',
    filename: 'itinerary.pdf',
    voiceMessage: false,
    hasThumbhash: false,
    hasThumbnail: false,
    uploaded: true,
    availability: 'cached',
    fetchDoneBytes: 0,
    fetchTotalBytes: 0,
    ...fields,
  }
}

// Local time, as the suggested name is.
const SENT_AT_MS = new Date(2026, 9, 9, 14, 3, 5).getTime()

function message(attachments: Attachment[]): Message {
  return { id: 7, timestamp: SENT_AT_MS, attachments } as unknown as Message
}

function installFiles(files: Partial<FilesPort>): FilesPort {
  const ports = memoryPorts()
  const installed = { ...ports.files, ...files }
  setPorts({ ...ports, files: installed })
  return installed
}

function feedback() {
  return { accessRefused: vi.fn(), failed: vi.fn() }
}

afterEach(() => {
  resetPorts()
})

describe('exporting one attachment', () => {
  it('asks where with the sender name and type, writes there, then shows where it landed', async () => {
    const choose = vi.fn(() => Promise.resolve('/chosen/itinerary.pdf'))
    const reveal = vi.fn(() => Promise.resolve())
    installFiles({ chooseExportLocation: choose, revealInFolder: reveal })
    const write = vi.fn((_ref: AttachmentRef, destination: string) =>
      Promise.resolve(destination.replace('.pdf', ' (1).pdf')),
    )

    await exportOne(message([attachment(0)]), 0, { exportAttachment: write }, feedback())

    expect(choose).toHaveBeenCalledWith('itinerary.pdf', 'application/pdf')
    expect(write).toHaveBeenCalledWith({ messageId: 7, index: 0 }, '/chosen/itinerary.pdf')
    // Where libsession says it landed, not where it was asked to go: a collision renames it.
    expect(reveal).toHaveBeenCalledWith('/chosen/itinerary (1).pdf')
  })

  it('exports the attachment at that index, not the first one', async () => {
    const choose = vi.fn(() => Promise.resolve('/chosen/b.jpg'))
    installFiles({ chooseExportLocation: choose })
    const write = vi.fn(() => Promise.resolve('/chosen/b.jpg'))
    const set = [
      attachment(0, { filename: 'a.pdf' }),
      attachment(1, { filename: 'b.jpg', contentType: 'image/jpeg' }),
    ]

    await exportOne(message(set), 1, { exportAttachment: write }, feedback())

    expect(choose).toHaveBeenCalledWith('b.jpg', 'image/jpeg')
    expect(write).toHaveBeenCalledWith({ messageId: 7, index: 1 }, '/chosen/b.jpg')
  })

  it('names a nameless attachment by when it was sent and its place in the message', async () => {
    const choose = vi.fn(() => Promise.resolve(null))
    installFiles({ chooseExportLocation: choose })
    const nameless = attachment(1)
    delete nameless.filename

    await exportOne(
      message([attachment(0), nameless]),
      1,
      { exportAttachment: vi.fn() },
      feedback(),
    )

    expect(choose).toHaveBeenCalledWith('Session_2026-10-09-140305_2.pdf', 'application/pdf')
  })

  it('writes nothing, and says nothing, when the person cancels', async () => {
    const reveal = vi.fn(() => Promise.resolve())
    installFiles({ chooseExportLocation: () => Promise.resolve(null), revealInFolder: reveal })
    const write = vi.fn()
    const said = feedback()

    await exportOne(message([attachment(0)]), 0, { exportAttachment: write }, said)

    expect(write).not.toHaveBeenCalled()
    expect(reveal).not.toHaveBeenCalled()
    expect(said.failed).not.toHaveBeenCalled()
    expect(said.accessRefused).not.toHaveBeenCalled()
  })

  it('says it failed, reveals nothing and throws nothing when the write fails', async () => {
    const reveal = vi.fn(() => Promise.resolve())
    installFiles({
      chooseExportLocation: () => Promise.resolve('/chosen/x'),
      revealInFolder: reveal,
    })
    const said = feedback()

    await expect(
      exportOne(
        message([attachment(0)]),
        0,
        { exportAttachment: () => Promise.reject(new Error('not a chosen folder')) },
        said,
      ),
    ).resolves.toBeUndefined()
    expect(reveal).not.toHaveBeenCalled()
    expect(said.failed).toHaveBeenCalledOnce()
  })

  it('says it failed, and throws nothing, when handing the file on fails', async () => {
    installFiles({
      chooseExportLocation: () => Promise.resolve('/chosen/x'),
      revealInFolder: () => Promise.reject(new Error('photo library refused it')),
    })
    const said = feedback()

    await expect(
      exportOne(
        message([attachment(0)]),
        0,
        { exportAttachment: () => Promise.resolve('/chosen/x') },
        said,
      ),
    ).resolves.toBeUndefined()
    expect(said.failed).toHaveBeenCalledOnce()
  })

  it('explains a refused access, and writes nothing', async () => {
    installFiles({
      chooseExportLocation: () => Promise.reject(new ExportAccessRefused('storage')),
    })
    const write = vi.fn()
    const said = feedback()

    await exportOne(message([attachment(0)]), 0, { exportAttachment: write }, said)

    expect(write).not.toHaveBeenCalled()
    expect(said.accessRefused).toHaveBeenCalledWith('storage')
    expect(said.failed).not.toHaveBeenCalled()
  })

  it('says a choice that failed for any other reason failed', async () => {
    installFiles({ chooseExportLocation: () => Promise.reject(new Error('picker crashed')) })
    const said = feedback()

    await exportOne(message([attachment(0)]), 0, { exportAttachment: vi.fn() }, said)

    expect(said.accessRefused).not.toHaveBeenCalled()
    expect(said.failed).toHaveBeenCalledOnce()
  })
})
