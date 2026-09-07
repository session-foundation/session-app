/**
 * A transcript, shaped so that heights genuinely vary.
 *
 * The conversation list has fixed-height rows, which is the easy case - a constant row height
 * becomes getItemLayout and the list never measures anything. A transcript is the opposite: a
 * bubble is as tall as its body wraps to, so the list has to measure as rows come into view. That
 * is the case worth comparing implementations on, and it is the one that was a pain point on the
 * native clients.
 *
 * Body lengths follow the shape real messages take - mostly short, with a long tail - because a
 * uniform length would quietly turn this back into the fixed-height case.
 */

import { mulberry32, words as pickWords } from '../../src/text'

export interface BenchMessage {
  id: string
  body: string
  outgoing: boolean
}

export function makeMessages(count: number, seed = 11): BenchMessage[] {
  const random = mulberry32(seed)

  return Array.from({ length: count }, (_, i) => {
    // Roughly: half are one line, most of the rest a few, and a tail that wraps to a paragraph.
    const roll = random()
    const words =
      roll < 0.5
        ? 2 + Math.floor(random() * 6)
        : roll < 0.9
          ? 10 + Math.floor(random() * 25)
          : 40 + Math.floor(random() * 80)
    return {
      id: `m${String(i)}`,
      body: pickWords(random, words),
      outgoing: i % 3 === 0,
    }
  })
}
