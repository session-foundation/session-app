import { createContext, createElement, useContext, type ReactNode } from 'react'

/**
 * Whether the app may use the camera, as the OS currently sees it.
 *
 * `blocked` is the one worth naming separately: asking again does nothing, so the only way
 * forward is the app's own settings page, and a screen that cannot tell it apart from `denied`
 * offers a button that silently does nothing.
 */
export type CameraAccess = 'unknown' | 'granted' | 'denied' | 'blocked'

/**
 * Seeing through the camera, without saying what draws it.
 *
 * A render-scoped port rather than a module one, like NavPort and for the same reason: the preview
 * is a *component*, and a component cannot be handed over by `setPorts` -- the platform that owns
 * it has to put it in the tree. expo-camera may only be imported from `apps/mobile`, so this is
 * the seam between them.
 *
 * **`useCamera` is null where an app installs no provider, which is the desktop app.** That is a
 * fact about this port and not about the platform: Electron reaches a webcam through
 * `getUserMedia`, and the desktop client ships that for calls today. So a screen reads the null as
 * "nothing here can see", never as "nothing here could".
 */
export interface CameraPort {
  /**
   * Whether the device has a camera at all, whatever the permission: false in the iOS Simulator,
   * on a Mac running the iPad app without one, and on an Android tablet or Chromebook with none.
   * A screen offers scanning disabled rather than not at all, so it reads the same everywhere.
   */
  available: boolean
  /** What the OS says right now. `unknown` until it has been asked once. */
  access: CameraAccess
  /**
   * Ask the OS, showing its prompt if this is the first time.
   *
   * Resolves with what the answer became, which is what a screen needs to decide what to draw
   * next: a rejection is a different screen from a grant, and `blocked` is a third.
   */
  request(): Promise<CameraAccess>
  /**
   * The live camera, reading QR codes out of what it sees.
   *
   * Only meaningful once access is `granted`; before that there is nothing to draw. Scanning is
   * part of the preview rather than a separate call because the decoder runs on the frames, and
   * pulling frames across this seam to decode them elsewhere would be a video pipeline for no
   * reason.
   *
   * **`active` is not the same as being mounted, and a scanner needs both.** The native pager
   * mounts every page so that a half-typed phrase survives a look at the other tab, which leaves
   * a granted camera running behind the phrase field -- green dot on iOS, privacy indicator on
   * Android -- for as long as somebody is typing their recovery phrase. Nothing leaves the
   * device, and for this app that is not the point.
   */
  Preview(props: { onScan: (value: string) => void; active?: boolean; testID?: string }): ReactNode
}

const CameraContext = createContext<CameraPort | null>(null)

export function CameraProvider(props: { camera: CameraPort; children: ReactNode }): ReactNode {
  return createElement(CameraContext.Provider, { value: props.camera }, props.children)
}

/**
 * The camera, or null where the platform has none.
 *
 * Null rather than a throw, unlike `useNav`: a screen that offers scanning is expected to run on
 * the desktop app too, where there is nothing to provide and the honest answer is that the feature
 * is absent.
 */
export function useCamera(): CameraPort | null {
  return useContext(CameraContext)
}
