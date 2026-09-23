import type { Attachment } from '@session/client'
import type { AttachmentTransferState } from '@session/state'

/** What one attachment's bytes are doing, as far as anything drawing it is concerned. */
export type FetchState = 'idle' | 'fetching' | 'ready' | 'failed' | 'unavailable'

export interface Fetch {
  state: FetchState
  /** Encrypted bytes moved and expected. Both 0 unless something is running. */
  done: number
  total: number
}

/**
 * One attachment's state, from what libsession says plus whatever this session has heard.
 *
 * **The attachment is the resting truth and a report is the live one.** `availability` arrives
 * with the message and is corrected whenever it changes, so it is right after a restart, after
 * scrolling back to an old message, and for a transfer somebody else's tap started. What it
 * cannot say is that a fetch *failed* transiently - libsession records only failures that will
 * not come out differently - so a report is still the only thing that knows a download has just
 * given up, and it carries fresher figures while one is running.
 */
export function fetchOf(attachment: Attachment, report?: AttachmentTransferState): Fetch {
  const none = { done: 0, total: 0 }

  // `unavailable` says the file server will not hand this out again, which does not unsay a copy
  // already in the cache - drawing "expired" over bytes we hold would refuse to show a file for
  // the one reason that does not apply to it.
  if (attachment.unavailable !== undefined && attachment.availability !== 'cached')
    return { state: 'unavailable', ...none }

  if (report?.state === 'failed') return { state: 'failed', ...none }
  if (attachment.availability === 'cached' || report?.state === 'done')
    return { state: 'ready', ...none }

  if (report?.state === 'running')
    return { state: 'fetching', done: report.done, total: report.total }
  if (attachment.availability === 'fetching')
    return { state: 'fetching', done: attachment.fetchDone, total: attachment.fetchTotal }

  return { state: 'idle', ...none }
}
