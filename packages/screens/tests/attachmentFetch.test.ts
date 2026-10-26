import type { Attachment } from '@session/client'
import type { AttachmentTransferState } from '@session/state'
import { describe, expect, it } from 'vitest'

import { fetchOf } from '#src/attachmentFetch'

function attachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    index: 0,
    contentType: 'image/jpeg',
    voiceMessage: false,
    hasThumbhash: false,
    hasThumbnail: false,
    uploaded: true,
    availability: 'absent',
    fetchDoneBytes: 0,
    fetchTotalBytes: 0,
    ...overrides,
  }
}

function report(overrides: Partial<AttachmentTransferState> = {}): AttachmentTransferState {
  return { state: 'running', doneBytes: 0, totalBytes: 0, ...overrides }
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
      attachment({ availability: 'fetching', fetchDoneBytes: 100, fetchTotalBytes: 900 }),
      report({ doneBytes: 400, totalBytes: 900 }),
    )
    expect(fetched).toEqual({ state: 'fetching', doneBytes: 400, totalBytes: 900 })
  })

  it('falls back to the page’s figures for a transfer somebody else started', () => {
    // An auto-download, or another window's tap. The reports went to whoever started it, so a
    // bar drawn here would begin at nothing without this.
    expect(
      fetchOf(attachment({ availability: 'fetching', fetchDoneBytes: 7, fetchTotalBytes: 9 })),
    ).toEqual({
      state: 'fetching',
      doneBytes: 7,
      totalBytes: 9,
    })
  })

  it('learns a transient failure only from a report', () => {
    // libsession records what will not come out differently, so a network failure is not on the
    // attachment at all - which is why a report is still worth keeping.
    expect(fetchOf(attachment(), report({ state: 'failed' })).state).toBe('failed')
  })

  it('says a permanent failure whatever this session heard', () => {
    expect(fetchOf(attachment({ availability: 'notFound' })).state).toBe('unavailable')
    expect(fetchOf(attachment({ availability: 'unreadable' })).state).toBe('unavailable')
  })

  it('shows a cached file rather than refusing it', () => {
    // One availability rather than a verdict beside a location, so a copy we hold cannot also be
    // marked gone: `cached` outranks whatever the last fetch of that url found.
    expect(fetchOf(attachment({ availability: 'cached' })).state).toBe('ready')
  })

  it('reads a cached file as ready over a failed report', () => {
    // The bytes can land by another route - another message naming the same file - and a cache
    // hit reports nothing that would replace the failure.
    expect(fetchOf(attachment({ availability: 'cached' }), report({ state: 'failed' })).state).toBe(
      'ready',
    )
  })

  it('reads a fetch somebody else started over an earlier failure', () => {
    expect(
      fetchOf(attachment({ availability: 'fetching' }), report({ state: 'failed' })).state,
    ).toBe('fetching')
  })

  it('prefers a finished report to an availability that has not caught up', () => {
    // A download resolves before the message carrying the new availability is reported, so for a
    // moment the two disagree and the row must not go back to offering a download.
    expect(fetchOf(attachment(), report({ state: 'done' })).state).toBe('ready')
  })
})
