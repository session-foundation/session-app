import type { PathSprites } from './pathSprites'

/**
 * None of its own on a phone: a native view can only be reached from the app, which injects one
 * through `UIProvider`; without it React Native's native driver moves the requests.
 */
export const defaultPathSprites: PathSprites | null = null
