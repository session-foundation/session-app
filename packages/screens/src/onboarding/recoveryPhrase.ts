import type { RecoveryInput } from './flow'

/**
 * The shortest phrase that can encode anything.
 *
 * Twelve words carry a 16-byte seed -- the codec packs three words per four bytes -- and the
 * thirteenth is the checksum. The longer option is 24 plus a checksum for a 32-byte seed.
 */
export const SHORTEST_PHRASE_WORDS = 13

/**
 * The words in a phrase as it was typed.
 *
 * Split on any run of whitespace with punctuation dropped, because a phrase is pasted out of a
 * password manager as often as it is typed. The legacy clients tolerate newlines, double spaces
 * and a trailing full stop, and refusing them would reject a correct phrase.
 */
export function phraseWords(input: string): string[] {
  // Every call makes more strings that cannot be wiped. These are the copies that stay unavoidable
  // while a phrase is collected as text -- see `restoreAccountFromWords` in the protocol, which
  // separates them from the one crossing the process boundary, which is fixable. Called once per
  // submit rather than per keystroke, which is what this file can do about it.
  return input
    .toLowerCase()
    .split(/[^\p{Letter}\p{Mark}]+/u)
    .filter((word) => word.length > 0)
}

/**
 * The one check worth making before the bridge sees it: too few words to be a phrase at all.
 *
 * Deliberately the *only* local check. libsession owns the word lists, the prefix matching and the
 * checksum, and a second copy up here is a second answer to disagree with -- but counting words
 * needs none of that, and "not long enough" beats "incorrect" when half a phrase has been pasted.
 *
 * Everything else comes back from libsession, which raises a different exception type per cause.
 * The bridge flattens them into one message, so the screen can only say something generic;
 * carrying a code across would let the other two legacy messages be used again.
 */
export function phraseIsTooShort(input: string): boolean {
  return phraseWords(input).length < SHORTEST_PHRASE_WORDS
}

/** A seed written out in hex, which is what every client's recovery password QR code holds. */
const HEX_SEED = /^[0-9a-f]+$/i

/**
 * What a scanned recovery password QR code restores from.
 *
 * The seed in hex is what every client draws, and goes to libsession as read. A code holding the
 * phrase itself is accepted too, as legacy Android accepts it, and goes the typed phrase's way.
 * Hex is tried first: its letters would otherwise split into words. Anything else is passed on as
 * a seed for libsession to refuse, so a code that is neither gets the QR tab's own error.
 */
export function scannedRecovery(value: string): RecoveryInput {
  const trimmed = value.trim()
  if (HEX_SEED.test(trimmed)) return { hexSeed: trimmed }
  const words = phraseWords(value)
  return words.length < SHORTEST_PHRASE_WORDS ? { hexSeed: value } : { words }
}
