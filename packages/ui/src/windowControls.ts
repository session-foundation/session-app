import { createContext, useContext } from 'react'

import { SPACE_SCALE } from './scales'

/**
 * How far in from each physical side a top bar touching the window's top corners has to keep its
 * content, to clear the window's close, minimise and zoom controls -- beyond the safe area `Screen`
 * already keeps.
 *
 * iPadOS 26 draws those controls inside a resizable window and leaves them out of the safe area.
 * Supplied by the app, which can ask the platform; zero everywhere else, the desktop included,
 * where the controls sit in a title bar of their own. Physical sides, because the platform places
 * the controls by the system's language while the app lays out its panes by its own.
 */
export interface WindowControlsInset {
  left: number
  right: number
}

const NO_INSET: WindowControlsInset = { left: 0, right: 0 }

const WindowControlsInsetContext = createContext<WindowControlsInset>(NO_INSET)

export const WindowControlsInsetProvider = WindowControlsInsetContext.Provider

/**
 * The padding a top bar with the usual `$md` side padding needs on each physical side to clear the
 * window's controls, or undefined on a side where its own padding already does.
 *
 * The platform reports a few points even where no controls are drawn -- the margin the window's
 * rounded corner asks for -- which is less than the bar keeps anyway. Taking it as the padding
 * would pull the bar's content towards the edge in every full-screen window.
 */
export function useTopBarControlsPadding(): { left?: number; right?: number } {
  const { left, right } = useContext(WindowControlsInsetContext)
  return {
    ...(left > SPACE_SCALE.md ? { left } : {}),
    ...(right > SPACE_SCALE.md ? { right } : {}),
  }
}
