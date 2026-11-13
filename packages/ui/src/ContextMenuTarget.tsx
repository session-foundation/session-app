import type { MouseEvent } from 'react'
import { YStack } from 'tamagui'

import type { ContextMenuTargetProps } from './ContextMenuTarget.types'
import { ContextMenuOpener } from './menuLongPress'
import { currentPageZoom } from './pageZoom'

export type { ContextMenuTargetProps }

/** Whether the reader has text selected inside `element`, which the window's own Copy is for. */
function selectsTextIn(element: Element): boolean {
  const selection = globalThis.getSelection?.()
  if (selection === null || selection === undefined || selection.isCollapsed) return false
  return element.contains(selection.anchorNode) || element.contains(selection.focusNode)
}

/**
 * Whether a double-click selected words: one on a word is a selection, as everywhere else. One on
 * the padding or a picture selects nothing, or only the whitespace beside it.
 */
function selectsWords(): boolean {
  return String(globalThis.getSelection?.() ?? '').trim() !== ''
}

/** A press on a control inside the target is that control's, not the message's. */
function onControl(event: MouseEvent): boolean {
  const control = (event.target as Element).closest('button, a, input, textarea, [role="button"]')
  return control !== null && event.currentTarget.contains(control)
}

/**
 * The web half: a right-click opens the menu at the pointer.
 *
 * **Not over a text selection inside it.** There the click is left to the window, whose own menu
 * copies what was selected; the app's menu acts on the whole message.
 */
export function ContextMenuTarget({
  onOpen,
  alignSelf,
  maxWidth,
  onDoublePress,
  children,
}: ContextMenuTargetProps) {
  return (
    // Provided on the web too, so a control reads one contract on both; only native acts on it.
    <ContextMenuOpener.Provider value={onOpen}>
      <YStack
        {...(alignSelf === undefined ? {} : { alignSelf })}
        {...(maxWidth === undefined ? {} : { maxWidth })}
        onContextMenu={(event: MouseEvent) => {
          if (selectsTextIn(event.currentTarget)) return
          event.preventDefault()
          // In the window's pixels, as `measureAnchor` reads them, placed inside the zoomed page.
          const zoom = currentPageZoom()
          onOpen({ kind: 'point', x: event.clientX / zoom, y: event.clientY / zoom })
        }}
        {...(onDoublePress === undefined
          ? {}
          : {
              // Reported after the browser has selected the word under the second press.
              onDoubleClick: (event: MouseEvent) => {
                if (!selectsWords() && !onControl(event)) onDoublePress()
              },
            })}
      >
        {children}
      </YStack>
    </ContextMenuOpener.Provider>
  )
}
