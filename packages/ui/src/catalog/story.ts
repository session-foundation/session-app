import type { ReactNode } from 'react'

export type ForcedState = 'hover' | 'press' | 'focus'

/** What a component's look depends on beyond its theme, which decides which pages draw it. */
interface Sensitivity {
  /** Draws `$primaryColor`, so each accent can change it. */
  accent?: boolean | undefined
  /** Has a leading and a trailing edge, so right to left mirrors it. */
  rtl?: boolean | undefined
  /** Lays itself out by the width it is given. */
  responsive?: boolean | undefined
  /**
   * Draws a role whose colour each theme picks for itself rather than by light or dark alone --
   * `surfaceInk` on `surfaceInverted`, say -- so a pull request draws it in every theme, not only
   * the two classic ones.
   */
  theme?: boolean | undefined
}

export interface Story<P> {
  component: string
  story: string
  /** One row each; the worst case (longest text, largest scale) belongs here as a row too. */
  variants: Record<string, P>
  /** Drawn as columns beside the resting state. */
  forced?: readonly ForcedState[] | undefined
  sensitive?: Sensitivity | undefined
  /** The cell's width, in px, where the page does not set one. */
  width: number
  /** Reads `CatalogPictures`, so its page waits for the showcase's photographs. */
  pictures?: boolean | undefined
  render: (props: P) => ReactNode
}

export type AnyStory = Story<never>

export function defineStory<P>(story: Story<P>): AnyStory {
  return story as unknown as AnyStory
}
