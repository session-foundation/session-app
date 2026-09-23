import type { Attachment, Message } from '@session/client'
import type { AttachmentTransferState } from '@session/state'

import { fetchOf } from './attachmentFetch'

/**
 * What a message's attachments are collectively doing.
 *
 * `failed` beats `fetching`, because a set where one file is never coming cannot complete: a bar
 * that would stop short is a worse thing to draw than a retry.
 */
export type AttachmentSetState = 'ready' | 'fetching' | 'failed' | 'idle'

export interface AttachmentSet {
  state: AttachmentSetState
  /** How many attachments the message has, drawn or not. */
  count: number
  /** Plaintext bytes across the set, absent when any attachment did not declare its size. */
  size?: number
  /**
   * How much of the whole set is here, in the same plaintext bytes `size` counts.
   *
   * **Over every attachment, not over the ones currently moving.** Folded over the running ones
   * it went backwards: a file that landed left both sums, so `done` fell and the total fell with
   * it - the set got smaller because part of it had arrived. A reading that goes backwards is
   * worse than no reading.
   *
   * A file already here counts as all of itself, so a set that was half cached starts half done
   * rather than covering ground it has already covered. A running one counts for its share,
   * taken as the fraction its own report gives: that fraction is computed from encrypted bytes,
   * which is the only honest way to get it, and then applied to the plaintext size so the two
   * numbers on screen are in the same units as each other and as `size`.
   *
   * `total` is 0 when any attachment declined to say how big it is, which is what
   * "indeterminate" means here - the same thing an absent `size` means.
   */
  done: number
  total: number
  /** How many failed. The gallery draws the count; only the list can say which. */
  failed: number
}

/**
 * Folds a message's attachments and their transfers into one answer.
 *
 * **Over every attachment, not over the ones a gallery draws.** A message can carry 32 and an
 * album draws five, so a count taken from the visible tiles would be wrong in exactly the case
 * somebody needs it.
 */
export function summarise(
  message: Message,
  reportFor: (attachment: Attachment) => AttachmentTransferState | undefined,
): AttachmentSet {
  const attachments = message.attachments
  let size: number | undefined = 0
  let done = 0
  let failed = 0
  let running = 0
  let ready = 0

  for (const attachment of attachments) {
    if (attachment.size === undefined || size === undefined) size = undefined
    else size += attachment.size

    const fetch = fetchOf(attachment, reportFor(attachment))
    // Unavailable counts as neither: the set is not failing at something a retry would fix, and
    // it is not ready either. A message of one expired file rests at idle, and its one control
    // is the row's, which says what happened.
    if (fetch.state === 'failed') failed += 1
    if (fetch.state === 'ready') {
      ready += 1
      done += attachment.size ?? 0
    }
    if (fetch.state === 'fetching') {
      running += 1
      // The fraction comes from the encrypted figures because that is what is being moved; it is
      // then spent against the plaintext size, so `done` and `total` agree with each other.
      const fraction = fetch.total > 0 ? fetch.done / fetch.total : 0
      done += (attachment.size ?? 0) * fraction
    }
  }

  const state: AttachmentSetState =
    failed > 0
      ? 'failed'
      : running > 0
        ? 'fetching'
        : attachments.length > 0 && ready === attachments.length
          ? 'ready'
          : 'idle'

  return {
    state,
    count: attachments.length,
    ...(size === undefined ? {} : { size }),
    // Rounded once, at the end: a sum of fractions of byte counts is not a byte count, and a
    // display that formatted it would show a size nobody's file has.
    done: Math.round(done),
    total: size ?? 0,
    failed,
  }
}
