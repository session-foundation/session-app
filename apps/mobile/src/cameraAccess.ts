import type { CameraAccess } from '@session/app'

/** What the OS reports about the camera permission, in the shape both platforms' calls answer. */
export interface CameraPermission {
  granted: boolean
  canAskAgain: boolean
  status: string
}

/**
 * The OS's answer, as the four states a screen actually has to draw.
 *
 * **`undetermined` is not a refusal**, which is the distinction worth keeping: it means nobody has
 * been asked, so the button offers to ask. `canAskAgain` is what separates a refusal that can be
 * asked about again from one only the settings page can undo.
 */
export function readCameraAccess(permission: CameraPermission | null): CameraAccess {
  if (!permission || permission.status === 'undetermined') return 'unknown'
  if (permission.granted) return 'granted'
  return permission.canAskAgain ? 'denied' : 'blocked'
}
