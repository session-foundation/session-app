import type { BubblePressProps } from './BubblePress.types'

/** Whether a press on a whole message bubble acts: on the web a pointer hits a link as it is. */
export const BUBBLE_TAKES_PRESS = false

/** On the web, the bubble as it is: what it offers, it offers as its own controls. */
export function BubblePress({ children }: BubblePressProps) {
  return children
}
