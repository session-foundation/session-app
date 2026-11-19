import type { ReactNode } from 'react'

/** The props both BubblePress variants accept. */
export interface BubblePressProps {
  onPress: () => void
  testID?: string | undefined
  children: ReactNode
}
