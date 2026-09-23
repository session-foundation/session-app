import type { Attachment } from '@session/client'
import type { AttachmentTransferState } from '@session/state'
import { describe, expect, it } from 'vitest'

import { fetchOf } from '#src/attachmentFetch'

function attachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    index: 0,
    contentType: 'image/jpeg',
    voiceMessage: false,
    uploaded: true,
    availability: 'absent',
    fetchDone: 0,
    fetchTotal: 0,
    ...overrides,
  }
}

function report(overrides: Partial<AttachmentTransferState> = {}): AttachmentTransferState {
  return { state: 'running', done: 0, total: 0, ...overrides }
}

describe('what an attachment is doing', () => {
  it('reads the attachment when nothing has been heard this session', () => {
    // The case the whole redesign is for: a conversation opened after a restart, or scrolled
    // back to an old message. No report has ever arrived and the answer is still right.
    expect(fetchOf(attachment({ availability: 'cached' })).state).toBe('ready')
    expect(fetchOf(attachment({ availability: 'absent' })).state).toBe('idle')
  })

  it('takes a running transfer’s figures over the page’s', () => {
    // Both describe the same transfer; the report is the more recent of the two.
    const fetched = fetchOf(
      attachment({ availability: 'fetching', fetchDone: 100, fetchTotal: 900 }),
      report({ done: 400, total: 900 }),
    )
    expect(fetched).toEqual({ state: 'fetching', done: 400, total: 900 })
  })

  it('falls back to the page’s figures for a transfer somebody else started', () => {
    // An auto-download, or another window's tap. The reports went to whoever started it, so a
    // bar drawn here would begin at nothing without this.
    expect(fetchOf(attachment({ availability: 'fetching', fetchDone: 7, fetchTotal: 9 }))).toEqual({
      state: 'fetching',
      done: 7,
      total: 9,
    })
  })

  it('learns a transient failure only from a report', () => {
    // libsession records what will not come out differently, so a network failure is not on the
    // attachment at all - which is why a report is still worth keeping.
    expect(fetchOf(attachment(), report({ state: 'failed' })).state).toBe('failed')
  })

  it('says a permanent failure whatever this session heard', () => {
    expect(fetchOf(attachment({ unavailable: 404 })).state).toBe('unavailable')
    expect(fetchOf(attachment({ unavailable: -20002 })).state).toBe('unavailable')
  })

  it('shows a cached file we happen to hold rather than refusing it', () => {
    // The one reason that does not apply to bytes already here: the file server will not hand it
    // out again, and it does not have to.
    const held = attachment({ unavailable: 404, availability: 'cached' })
    expect(fetchOf(held).state).toBe('ready')
  })

  it('prefers a finished report to an availability that has not caught up', () => {
    // A download resolves before the message carrying the new availability is reported, so for a
    // moment the two disagree and the row must not go back to offering a download.
    expect(fetchOf(attachment(), report({ state: 'done' })).state).toBe('ready')
  })
})
