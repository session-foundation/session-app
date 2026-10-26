import type { AbortSignalLike } from './cancellation'

export type WithSnodeEd25519 = { snodeEd25519: string }
export type WithSwarmStr = { swarm: string }

export type WithAbortSignal = { abortSignal: AbortSignalLike }
export type WithCiphertext = { ciphertext: Uint8Array }
export type WithHeaders = { headers: Record<string, string> }
export type WithHeadersMixed = { headers: Record<string, string | number> }

export type WithMessageHash = { messageHash: string }
export type WithMessageHashOrNull = { messageHash: string | null }
export type WithPlaintext = { plaintext: Uint8Array }
export type WithServerId = { serverId: number }
export type WithEnvelopePayload = { envelopePayload: Uint8Array }
export type WithSenderEd25519Seed = { senderEd25519Seed: Uint8Array }
export type WithSentTimestampMs = { sentTimestampMs: number }

/**
 * Where the bytes are. Absent: nothing to draw yet. `null`: this platform has no resolver for them.
 */
export type WithMediaUri = { uri?: string | null | undefined }
/** The sender's placeholder, as a url resolved like `uri`, with the same absent/`null` meanings. */
export type WithMediaThumbhash = { thumbhash?: string | null | undefined }
/** A press on it downloads it rather than opening it, which hovering it says. */
export type WithFetchesOnOpen = { fetchesOnOpen?: boolean | undefined }
export type WithFilename = { filename: string }
/** The sender's declared type, absent on plenty of attachments. */
export type WithContentType = { contentType?: string | undefined }
/** Already worded, for a package that cannot reach the catalogue. */
export type WithCaption = { caption: string }
/** Label then value, in the order a person reads them: a startup block's or an export's rows. */
export type Rows = ReadonlyArray<readonly [string, string]>
/** The first and last timed lines of a stretch of log; null where there is no such line to read. */
export type WithSpan = { firstLine: string | null; lastLine: string | null }
