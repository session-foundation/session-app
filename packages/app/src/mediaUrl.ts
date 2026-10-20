// Imported by desktop main, the sandboxed renderer and mobile: no platform APIs.
import type { AttachmentRef } from '@session/client'

/**
 * The scheme an attachment's bytes reach the renderer by.
 *
 * `session-media://attachment/<messageId>/<index>`. A registered scheme rather than `file:`
 * because the point is that the renderer gets exactly this one door: it cannot name a path, only
 * a message and a position in it, and what comes back is whatever libsession decrypted for it.
 *
 * The ids are both in the path and the authority is a fixed word, because a standard scheme gets
 * the special-scheme host parser: `session-media://5/0` canonicalises to the host `0.0.0.5`.
 */
export const MEDIA_SCHEME = 'session-media'

/**
 * The authority, so that no part of the ref is parsed as a host name.
 *
 * Two of them rather than a query parameter: the authority is the part the special-scheme host
 * parser already normalises, and it keeps the file and its placeholder at separate URLs, which is
 * what lets the platform cache them separately.
 */
export type MediaUrlKind = 'attachment' | 'preview'

export function mediaUrl(kind: MediaUrlKind, { messageId, index }: AttachmentRef): string {
  return `${MEDIA_SCHEME}://${kind}/${String(messageId)}/${String(index)}`
}

// The canonical form only, as the shim's `parse_media_url` reads it: Chromium hands a handler the
// canonicalised URL, and a native loader is handed the one the app built.
const MEDIA_URL = new RegExp(
  `^${MEDIA_SCHEME}://(?<kind>attachment|preview)/(?<message>0|[1-9]\\d{0,15})/(?<index>0|[1-9]\\d{0,15})$`,
)

/** `session-media://<attachment|preview>/<messageId>/<index>` split back up, or null. */
export function parseMediaUrl(url: string): { kind: MediaUrlKind; ref: AttachmentRef } | null {
  const groups = MEDIA_URL.exec(url)?.groups as
    { kind: MediaUrlKind; message: string; index: string } | undefined
  if (groups === undefined) return null
  const messageId = Number(groups.message)
  const index = Number(groups.index)
  // A rowid, so zero names nothing. Past 2^53 - 1, Number() rounds rather than refusing.
  if (messageId === 0 || !Number.isSafeInteger(messageId) || !Number.isSafeInteger(index)) {
    return null
  }
  return { kind: groups.kind, ref: { messageId, index } }
}
