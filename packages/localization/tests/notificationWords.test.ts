import { describe, expect, it } from 'vitest'

import { notificationWords } from '#src/notificationWords'

describe("a notification's words", () => {
  it('takes a plural as its form for one, with no count left to fill in', () => {
    expect(notificationWords().generic).toBe("You've got a new message.")
  })

  it('names each attachment kind a notification can carry', () => {
    const words = notificationWords()
    expect([words.image, words.animated, words.voice, words.file]).toEqual([
      'Image',
      'GIF',
      'Voice Message',
      'Document',
    ])
  })
})
