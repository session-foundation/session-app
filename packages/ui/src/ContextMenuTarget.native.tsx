import { Pressable } from 'react-native'

import type { ContextMenuTargetProps } from './ContextMenuTarget.types'
import { ContextMenuOpener } from './menuLongPress'

export type { ContextMenuTargetProps }

/**
 * The native half: a long press opens the menu under the finger.
 *
 * Not an accessibility element itself, so what it wraps stays separately reachable: as one, the
 * wrapper would hide its children from VoiceOver. A control inside takes the touch first, so it
 * hands its long press up through `ContextMenuOpener` (see `useMenuLongPress`).
 */
export function ContextMenuTarget({
  onOpen,
  alignSelf,
  maxWidth,
  children,
}: ContextMenuTargetProps) {
  return (
    <ContextMenuOpener.Provider value={onOpen}>
      <Pressable
        style={{ alignSelf, maxWidth }}
        accessible={false}
        // Android makes a long-pressable view a focusable node whatever `accessible` says, folding
        // the bubble into one element that a double tap reaches with nothing to do.
        importantForAccessibility="no"
        onLongPress={(event) => {
          onOpen({ kind: 'point', x: event.nativeEvent.pageX, y: event.nativeEvent.pageY })
        }}
      >
        {children}
      </Pressable>
    </ContextMenuOpener.Provider>
  )
}
