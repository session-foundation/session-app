import { protocol } from 'electron'

/**
 * Whatever can answer with an attachment's bytes: the addon, or the fake behind the same door.
 *
 * Narrower than the transport on purpose - serving the scheme has no business with frames, and
 * the dev fake has no addon to borrow the type from.
 */
export interface MediaSource {
  fetchMedia(messageId: number, index: number): Promise<{ contentType: string; bytes: Uint8Array }>
}

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
 * Registered before `app.whenReady()`, which is the only time Electron accepts it.
 *
 * `standard` is what gives the scheme an origin, which is what lets a CSP name it and what stops
 * every URL under it being treated as opaque. `secure` keeps it out of the mixed-content rules a
 * page served over `file:` would otherwise apply to it. Deliberately not `supportFetchAPI`,
 * `corsEnabled` or `stream`: the renderer draws these in an `<img>`, and anything script can call
 * directly is more surface than that needs.
 */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true } },
  ])
}

/** The authority every media URL carries, so that no part of one is parsed as a host name. */
export const MEDIA_HOST = 'attachment'

/** `session-media://attachment/<messageId>/<index>` split back into the pair, or null. */
export function parseMediaUrl(url: string): { messageId: number; index: number } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${MEDIA_SCHEME}:` || parsed.hostname !== MEDIA_HOST) return null

  const [message, index, ...rest] = parsed.pathname.replace(/^\//, '').split('/')
  if (rest.length > 0) return null

  const messageId = Number(message)
  const at = Number(index)
  if (!Number.isInteger(messageId) || messageId <= 0) return null
  if (!Number.isInteger(at) || at < 0) return null
  return { messageId, index: at }
}

/**
 * Serves the scheme from the bridge, in the main process, where the addon already is.
 *
 * Bytes never touch the frame stream and never cross as a message: Chromium fetches them for the
 * element that asked, decodes off the main thread, and caches the result itself. A transfer that
 * has to happen still reports progress as `attachment-progress` events, so the row draws the same
 * bar it would for a tap.
 */
export function serveMedia(bridge: MediaSource): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const target = parseMediaUrl(request.url)
    if (!target) return new Response(null, { status: 400 })

    try {
      const media = await bridge.fetchMedia(target.messageId, target.index)
      return new Response(new Uint8Array(media.bytes), {
        status: 200,
        headers: {
          'content-type': media.contentType,
          // The sender chose the type and the name, so a browser deciding for itself is a way in.
          'x-content-type-options': 'nosniff',
          // Bytes for one message never change, and the cache is libsession's problem rather than
          // Chromium's - but within one run, re-decrypting on every scroll past is pure waste.
          'cache-control': 'private, max-age=3600',
        },
      })
    } catch {
      // What went wrong is already on the frame stream as a failed transfer, which is where the
      // row that asked is watching. A status here would only be read by the image element.
      return new Response(null, { status: 404 })
    }
  })
}
