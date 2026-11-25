/** The query parameter `routes.conversation` puts the message to land on in. */
export const LAND_ON_PARAM = 'at'

/**
 * Every destination in the app, built in one place.
 *
 * The paths are platform-neutral and always absolute; each app's driver applies whatever
 * prefix its own router needs. Building a path anywhere else is how the two apps end up
 * disagreeing about what a route is called.
 */
export const routes = {
  home: () => '/',
  /** `landOn`: a message to open the transcript on, as a tapped notification names it. */
  conversation: (id: string, landOn?: number) =>
    `/c/${encodeURIComponent(id)}${landOn === undefined ? '' : `?${LAND_ON_PARAM}=${String(landOn)}`}`,
  newConversation: () => '/new',
  requests: () => '/requests',
} as const

/**
 * Which conversation a path is showing, or null.
 *
 * Reading the selection out of the URL rather than holding it in state is what makes the
 * back button - and the Android hardware one - walk back out of a conversation without
 * anything having to remember that it should.
 */
export function conversationFromPath(pathname: string): string | null {
  const match = /^\/c\/([^/]+)\/?$/.exec(pathname)
  const encoded = match?.[1]
  if (encoded === undefined) return null
  try {
    return decodeURIComponent(encoded)
  } catch {
    // A malformed escape is not a conversation; showing the list beats throwing.
    return null
  }
}

/**
 * The message a conversation's route says to open on, from its `LAND_ON_PARAM` value, or
 * undefined for none. Anything but a message id, which is a whole number, is none.
 */
export function landingFromParam(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined || !/^\d+$/.test(value)) return undefined
  return Number(value)
}
