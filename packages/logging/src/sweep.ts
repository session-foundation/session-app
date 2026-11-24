import { addressShape, renderAddress } from './address'
import type { Pseudonyms } from './pseudonym'
import { renderUrl } from './url'
import { shortenVisible } from './values'

/** What the sweep replaced, by kind; the export header reports the totals. */
export interface SweepCounts {
  url: number
  uuid: number
  hex: number
  base64: number
  base32: number
  ip: number
  words: number
}

export function emptyCounts(): SweepCounts {
  return { url: 0, uuid: 0, hex: 0, base64: 0, base32: 0, ip: 0, words: 0 }
}

const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
/** 32 hex digits and up: every key, hash, salt and signature Session handles is at least that. */
const HEX = /(^|[^0-9a-z])([0-9a-f]{32,})(?![0-9a-z])/gi
/** Swarm message hashes and ed25519/blinded keys in base64 are 43-44 characters; allow longer. */
const BASE64 = /(^|[^A-Za-z0-9+/_-])([A-Za-z0-9+/_-]{40,}={0,2})(?![A-Za-z0-9+/_=-])/g
/**
 * Session Router and service-node addresses: 52 characters of lowercase z-base32, often with
 * `.sesh` or `.snode` after. A client's own is its identity on the router network for the run.
 */
const BASE32 = /\b([a-z0-9]{50,})(\.(?:sesh|snode|loki))?\b/g
const IPV4 = /\b(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?\b/g
const IPV6_BRACKETED = /\[([0-9a-f:.]+)\](?::(\d{1,5}))?/gi
/**
 * The dotted quad is tried before a hex group, and a match may not stop in front of `.digit`:
 * otherwise `::ffff:10.0.0.1` matches as `::ffff:10` and leaves the rest of the IPv4 address.
 */
const IPV6_BARE =
  /(^|[^\w:.])((?:[0-9a-f]{0,4}:){2,7}(?:\d+\.\d+\.\d+\.\d+|[0-9a-f]{1,4})?)(?![\w:]|\.\d)/gi
/**
 * One word of a recovery phrase: 3 to 16 letters, the range libsession's word lists span
 * (Portuguese and Dutch reach 16), with Lojban's apostrophe. Latin and Cyrillic; a phrase in
 * another script - Japanese, Chinese - is the gap this leaves.
 */
const PHRASE_WORD = "[A-Za-zÀ-ɏЀ-ӿ']{3,16}"
/**
 * What can come between the words as a phrase is written: spaces, as typed; a comma, as the
 * bridge's array of words prints; quotes and brackets, as it serialises; a newline, raw or
 * already escaped.
 */
const PHRASE_GAP = '(?:[\\s,;"[\\]]|\\\\n)+'
/**
 * Thirteen or more words in a row is the shape of a recovery phrase, and nothing a log line says
 * on purpose.
 */
const WORD_RUN = new RegExp(`(?:${PHRASE_WORD}${PHRASE_GAP}){12,}${PHRASE_WORD}`, 'g')
const ONE_WORD = new RegExp(PHRASE_WORD, 'g')

/**
 * The backstop: anything in free text that has the shape of something that must not be written.
 *
 * The typed values in `values.ts` are how an identifier is written on purpose; this is for the
 * lines that never went through them - libsession's, whose text comes from C++, and every message
 * somebody wrote without thinking. Order matters: a URL is rendered whole before the hex inside
 * it would be, and a UUID before its hex runs.
 */
export function sweep(text: string, pseudonyms: Pseudonyms, counts: SweepCounts): string {
  let out = text.replace(URL_IN_TEXT, (match) => {
    const rendered = renderUrl(match, pseudonyms)
    if (rendered === undefined) return match
    counts.url += 1
    return rendered
  })
  out = out.replace(UUID, (match) => {
    counts.uuid += 1
    return pseudonyms.of(match.toLowerCase())
  })
  out = out.replace(HEX, (_match, before: string, hex: string) => {
    counts.hex += 1
    return `${before}${shortenVisible(hex) ?? pseudonyms.of(hex.toLowerCase())}`
  })
  out = out.replace(BASE64, (match, before: string, value: string) => {
    // A long run of one case of letters and nothing else is a word, or a path, not a key.
    if (!/[0-9+/=_-]/.test(value) || !/[A-Z]/.test(value) || !/[a-z]/.test(value)) return match
    counts.base64 += 1
    return `${before}${pseudonyms.of(value)}`
  })
  out = out.replace(BASE32, (_match, value: string, suffix: string | undefined) => {
    counts.base32 += 1
    return `${pseudonyms.of(value)}${suffix ?? ''}`
  })
  out = out.replace(IPV6_BRACKETED, (match, host: string, port: string | undefined) => {
    if (addressShape(host) === undefined) return match
    counts.ip += 1
    return `<${renderAddress(host, port)}>`
  })
  out = out.replace(IPV6_BARE, (match, before: string, host: string) => {
    // A time of day is three colon-separated groups too; an address has a hex letter or a `::`.
    if (!/[a-f]/i.test(host) && !host.includes('::')) return match
    if (addressShape(host) === undefined) return match
    counts.ip += 1
    return `${before}<${renderAddress(host)}>`
  })
  out = out.replace(IPV4, (match, host: string, port: string | undefined) => {
    if (addressShape(host) === undefined) return match
    counts.ip += 1
    return `<${renderAddress(host, port)}>`
  })
  out = out.replace(WORD_RUN, (match) => {
    counts.words += 1
    return `<${String(match.match(ONE_WORD)?.length ?? 0)} words>`
  })
  return out
}
