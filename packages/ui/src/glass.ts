import { createContext, useContext, type ReactNode } from 'react'

/**
 * A round glass button's surface, as iOS 26 draws its bar buttons. Injected because
 * `expo-glass-effect` may only be imported from `apps/mobile`.
 */
export interface GlassProps {
  /** The diameter. */
  size: number
  /** Whether the app is showing a dark theme, which the platform's own appearance may not match. */
  dark: boolean
  /**
   * The colour to light the button with while a pointer is over it, or null when none is.
   *
   * Drawn by the caller because interactive glass reacts to a touch but has no hover state of its
   * own, which an iPad's pointer and the iPad app on a Mac both expect of a bar button. A colour
   * rather than a flag so the theme decides it; this side has no tokens.
   */
  highlight: string | null
  children: ReactNode
}

export type Glass = (props: GlassProps) => ReactNode

const GlassContext = createContext<Glass | null>(null)

export const GlassProvider = GlassContext.Provider

/** Null where the platform has no glass (iOS before 26, Android, desktop). */
export function useGlass(): Glass | null {
  return useContext(GlassContext)
}
