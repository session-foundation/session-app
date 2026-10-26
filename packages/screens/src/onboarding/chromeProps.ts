import type { ReactNode } from 'react'

/**
 * What a layout is told about the step it is framing.
 *
 * One shape for both, so a screen asks for a chrome without knowing which it will get -- the
 * width decides that, and a screen that had to know would be a screen with a third layout rule
 * in it.
 */
export interface ChromeProps {
  children: ReactNode
  testID: string
  onBack?: (() => void) | undefined
  /**
   * Refuses back without taking the control away.
   *
   * For a step with work in flight that cannot be called off. Omitting `onBack` would hide the
   * chevron instead, which reads as a step you never could leave rather than one you cannot
   * leave yet.
   */
  backDisabled?: boolean
  barTitle?: string
  banner?: ReactNode
  padContent?: boolean
  avoidsKeyboard?: boolean
}
