import { describe, expect, it } from 'vitest'

import {
  phraseIsTooShort,
  phraseWords,
  scannedRecovery,
  SHORTEST_PHRASE_WORDS,
} from '#src/onboarding/recoveryPhrase'

const thirteen = Array.from({ length: SHORTEST_PHRASE_WORDS }, (_, i) => `word${String(i)}`)

/**
 * Splitting is the whole of it, and it matters because a phrase arrives pasted at least as often
 * as it arrives typed: out of a password manager, a text file, or a photo of a piece of paper.
 */
describe('reading a phrase', () => {
  it('splits on whitespace', () => {
    expect(phraseWords('one two three')).toEqual(['one', 'two', 'three'])
  })

  it('tolerates the mess a paste brings with it', () => {
    // Newlines from a text file, double spaces from a wrapped line, a trailing full stop from
    // prose. The legacy clients accept all three, and a phrase that is correct must not be
    // refused for how it was copied.
    expect(phraseWords('  one\n\ntwo,   three.\t four ')).toEqual(['one', 'two', 'three', 'four'])
  })

  it('lower-cases, because the wordlist is lower case', () => {
    expect(phraseWords('One TWO')).toEqual(['one', 'two'])
  })

  it('keeps the marks a non-English wordlist needs', () => {
    // Japanese, Portuguese and Spanish wordlists all ship, so splitting on anything but letters
    // and marks would tear their words apart.
    expect(phraseWords('café pequeño 日本')).toEqual(['café', 'pequeño', '日本'])
  })

  it('finds nothing in an empty field', () => {
    expect(phraseWords('   \n ')).toEqual([])
  })
})

describe('the one check made before the bridge sees it', () => {
  it('accepts the shortest real phrase', () => {
    expect(phraseIsTooShort(thirteen.join(' '))).toBe(false)
  })

  it('rejects one word fewer', () => {
    expect(phraseIsTooShort(thirteen.slice(0, -1).join(' '))).toBe(true)
  })

  it('accepts a longer one rather than judging it', () => {
    // Length is libsession's to rule on, and a longer phrase is a real option elsewhere in this
    // work. This check exists only to tell half a phrase from a wrong one.
    expect(phraseIsTooShort(Array.from({ length: 25 }, () => 'word').join(' '))).toBe(false)
  })

  it('treats an empty field as too short', () => {
    expect(phraseIsTooShort('')).toBe(true)
  })
})

describe('reading a scanned recovery password QR code', () => {
  const seed = '0123456789abcdef0123456789abcdef'

  it('takes the seed in hex, which is what every client draws', () => {
    expect(scannedRecovery(seed)).toEqual({ hexSeed: seed })
    expect(scannedRecovery(` ${seed.toUpperCase()}\n`)).toEqual({ hexSeed: seed.toUpperCase() })
  })

  it('takes hex as hex even where its letters would make thirteen words', () => {
    const lettersApart = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'
    expect(phraseWords(lettersApart).length).toBeGreaterThanOrEqual(SHORTEST_PHRASE_WORDS)
    expect(scannedRecovery(lettersApart)).toEqual({ hexSeed: lettersApart })
  })

  it('takes the phrase itself, as legacy Android does', () => {
    const phrase =
      'ample bacon cabin dagger eagle fabric gadget habit icon jacket kennel label magic'
    expect(scannedRecovery(phrase)).toEqual({ words: phrase.split(' ') })
  })

  it('passes anything else on as a seed, for libsession to refuse', () => {
    expect(scannedRecovery('057fb21c2cd7')).toEqual({ hexSeed: '057fb21c2cd7' })
    expect(scannedRecovery('https://getsession.org')).toEqual({ hexSeed: 'https://getsession.org' })
  })
})
