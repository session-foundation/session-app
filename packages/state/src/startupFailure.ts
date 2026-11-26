import { BRIDGE_UNAVAILABLE, KEY_INVALID, KEY_MISSING, KEY_UNAVAILABLE } from '@session/client'

/**
 * Which kind of failed start this is, as far as what the person can do about it.
 *
 * - `unreadable`: the database cannot be opened with what is on this device, and starting again
 *   is unlikely to change that. Only clearing it is sure to get past. A key that reads as missing
 *   may still be an Android Keystore that cannot be reached for now, which a restart can cure.
 * - `transient`: something that may be gone by the next start: a locked keychain, a database
 *   another process holds, a full disk.
 * - `noBridge`: the bridge could not be made for a reason that is not about the key, so nothing
 *   was opened and there is nothing to clear with.
 */
export type StartupFailureKind = 'unreadable' | 'transient' | 'noBridge'

/**
 * Whether clearing is offered for this kind: only where a bridge was made, since clearing is done
 * through it. A switch rather than a comparison, so a new kind does not compile until somebody
 * decides.
 */
export function isClearable(kind: StartupFailureKind): boolean {
  switch (kind) {
    case 'unreadable':
    case 'transient':
      return true
    case 'noBridge':
      return false
  }
}

/**
 * SQLite's own words, as `sqlite3_errstr` gives them, for the failures no restart gets past:
 * `SQLITE_NOTADB` (a wrong key reads as one) and `SQLITE_CORRUPT`. The bridge keeps only the text
 * of what libsession threw, so the text is what there is to go on; these are stable across SQLite
 * versions.
 */
const UNREADABLE_PHRASES: readonly string[] = [
  'file is not a database',
  'database disk image is malformed',
]

/** `phrase` in `message` as a whole phrase, whatever the case: not inside a longer word. */
function containsPhrase(message: string, phrase: string): boolean {
  const lower = message.toLowerCase()
  let at = lower.indexOf(phrase)
  while (at !== -1) {
    const before = at === 0 ? '' : (lower[at - 1] ?? '')
    const after = lower[at + phrase.length] ?? ''
    if (!/[a-z0-9_]/.test(before) && !/[a-z0-9_]/.test(after)) return true
    at = lower.indexOf(phrase, at + 1)
  }
  return false
}

/**
 * Classifies a failed start from the refusal that reached the store: its message and its code.
 *
 * A key failure says which it is by its code. A bridge that could not be made otherwise is
 * `noBridge`. Everything else came from an open database layer -- SQLite busy or locked, unable to
 * open, full, an I/O error, a read after the open -- and is transient unless SQLite said the file
 * is not a database or is malformed.
 */
export function classifyStartupFailure(
  message: string,
  code: string | undefined,
): StartupFailureKind {
  switch (code) {
    case BRIDGE_UNAVAILABLE:
      return 'noBridge'
    case KEY_UNAVAILABLE:
      return 'transient'
    case KEY_MISSING:
    case KEY_INVALID:
      return 'unreadable'
  }
  return UNREADABLE_PHRASES.some((phrase) => containsPhrase(message, phrase))
    ? 'unreadable'
    : 'transient'
}
