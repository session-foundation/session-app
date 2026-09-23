import type { Attachment, Message } from '@session/client'
import type { AttachmentTransferState } from '@session/state'
import { describe, expect, it } from 'vitest'

import { summarise } from '#src/attachmentSet'

function attachment(index: number, size?: number): Attachment {
  return {
    index,
    contentType: 'image/jpeg',
    ...(size === undefined ? {} : { size }),
    voiceMessage: false,
    uploaded: true,
    availability: 'absent',
    fetchDone: 0,
    fetchTotal: 0,
  }
}

function message(attachments: Attachment[]): Message {
  return { attachments } as unknown as Message
}

function running(done: number, total: number): AttachmentTransferState {
  return { state: 'running', done, total }
}

const done: AttachmentTransferState = { state: 'done', done: 0, total: 0 }
const failed: AttachmentTransferState = { state: 'failed', done: 0, total: 0 }

function fold(
  attachments: Attachment[],
  by: Record<number, AttachmentTransferState | undefined>,
): ReturnType<typeof summarise> {
  return summarise(message(attachments), (a) => by[a.index])
}

describe('what a set of attachments is doing', () => {
  it('is idle when nothing has been asked for', () => {
    const set = fold([attachment(0), attachment(1)], {})
    expect(set.state).toBe('idle')
    expect(set.count).toBe(2)
  })

  it('is ready only when every attachment is', () => {
    expect(fold([attachment(0), attachment(1)], { 0: done }).state).toBe('idle')
    expect(fold([attachment(0), attachment(1)], { 0: done, 1: done }).state).toBe('ready')
  })

  it('counts every attachment, not the ones a gallery draws', () => {
    // A message can carry 32 and an album draws five. A count taken from the tiles would be wrong
    // in exactly the case somebody needs it.
    const many = Array.from({ length: 32 }, (_, i) => attachment(i))
    expect(fold(many, {}).count).toBe(32)
  })

  it('lets a failure beat a transfer still running', () => {
    // A set where one file is never coming cannot complete, so a bar that would stop short is a
    // worse thing to draw than a retry.
    const set = fold([attachment(0), attachment(1)], { 0: running(10, 100), 1: failed })
    expect(set.state).toBe('failed')
    expect(set.failed).toBe(1)
  })

  it('measures the whole set, in the units the set is measured in', () => {
    // Halfway through the first of two 100-byte files: half of one file out of two.
    const two = [attachment(0, 100), attachment(1, 100)]
    const set = fold(two, { 0: running(50, 100) })
    expect(set.done).toBe(50)
    expect(set.total).toBe(200)
    expect(set.size).toBe(200)
  })

  it('counts a file already here as all of itself', () => {
    // A set that was half cached starts half done. Anything else would draw a bar that has to
    // cover ground it has already covered.
    const two = [attachment(0, 100), attachment(1, 100)]
    const set = fold(two, { 0: done, 1: running(0, 10) })
    expect(set.done).toBe(100)
    expect(set.total).toBe(200)
  })

  it('never goes backwards as one file finishes and the next begins', () => {
    // The defect this replaced: folded over the running transfers, the total changed as each
    // file announced its own size and `done` fell back to nothing at every hand-off, so the
    // reading jumped twice per file.
    const two = [attachment(0, 100), attachment(1, 300)]
    const readings = [
      fold(two, { 0: running(0, 10) }),
      fold(two, { 0: running(5, 10) }),
      fold(two, { 0: running(10, 10) }),
      fold(two, { 0: done }),
      fold(two, { 0: done, 1: running(0, 30) }),
      fold(two, { 0: done, 1: running(15, 30) }),
      fold(two, { 0: done, 1: done }),
    ].map((set) => set.done)

    expect(readings).toEqual([0, 50, 100, 100, 100, 250, 400])
    for (const [at, reading] of readings.entries()) {
      expect(reading).toBeGreaterThanOrEqual(readings[at - 1] ?? 0)
    }
    // And one total throughout, so the far end of the bar never moves either.
    expect(new Set([fold(two, { 0: running(5, 10) }).total, fold(two, { 0: done }).total])).toEqual(
      new Set([400]),
    )
  })

  it('does not drop when one of several running transfers finishes', () => {
    // What this actually looked like: a message's attachments all start together, and the moment
    // the first one lands both numbers fall - it left the sum it was being counted in, and so did
    // its share of the total. The set got smaller because part of it had arrived.
    const three = [attachment(0, 100), attachment(1, 100), attachment(2, 100)]
    const mid = fold(three, { 0: running(90, 100), 1: running(50, 100), 2: running(50, 100) })
    const justAfter = fold(three, { 0: done, 1: running(50, 100), 2: running(50, 100) })

    expect(mid.total).toBe(justAfter.total)
    expect(justAfter.done).toBeGreaterThanOrEqual(mid.done)
    expect(justAfter.done).toBe(200)
  })

  it('takes the fraction from the encrypted figures and spends it on the plaintext size', () => {
    // A transfer reports what is being moved, which is larger than the file: padding and framing.
    // The ratio is the honest thing to take from it, and the size is what to apply it to.
    const set = fold([attachment(0, 1000)], { 0: running(410, 1640) })
    expect(set.done).toBe(250)
  })

  it('leaves the total at zero when an attachment did not say how big it is', () => {
    // The same thing an absent `size` means. A bar drawn from it has to be indeterminate, which
    // is also what the first report of any transfer - 0 of 0 - is saying.
    const set = fold([attachment(0)], { 0: running(0, 0) })
    expect(set.state).toBe('fetching')
    expect(set.total).toBe(0)
    expect(set.size).toBeUndefined()
  })

  it('adds the sizes up, and gives none at all when one attachment did not say', () => {
    expect(fold([attachment(0, 100), attachment(1, 200)], {}).size).toBe(300)
    expect(fold([attachment(0, 100), attachment(1)], {}).size).toBeUndefined()
  })
})
