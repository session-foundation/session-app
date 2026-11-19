import { PENDING_COPY, tr } from '@session/localization'
import type { KeyName, KeyNames } from '@session/ui'

interface KeyboardShortcut {
  /** Addresses the row in tests. */
  name: string
  label: string
  /** Each one does it, drawn a line each; most shortcuts have one. */
  combos: readonly (readonly KeyName[])[]
}

export interface KeyboardShortcutGroup {
  name: string
  title: string
  shortcuts: readonly KeyboardShortcut[]
}

/**
 * Every key the desktop app handles beyond typing and Tab, as each platform presses it.
 *
 * Only what is handled: the transcript's keys (`listFocus.ts` in `@session/ui`), the media viewer's
 * (`mediaViewerArrowKeys.ts` there) and the menu bar's
 * accelerators (`appMenu.ts` in the desktop app). Full screen is Electron's own accelerator, ⌃⌘F
 * on a Mac and F11 elsewhere. Built per call, so the labels follow the language.
 */
export function keyboardShortcuts(names: KeyNames): readonly KeyboardShortcutGroup[] {
  const mac = names === 'mac'
  return [
    {
      name: 'messages',
      title: tr('messages'),
      shortcuts: [
        { name: 'navigate', label: PENDING_COPY.messageNavigate, combos: [['up'], ['down']] },
        // Shift+F10 and the Menu key work too, as the platform's, but are not what to learn.
        { name: 'menu', label: tr('openMessageContextMenu'), combos: [['enter'], ['space']] },
        {
          name: 'attachment-navigate',
          label: PENDING_COPY.attachmentNavigate,
          combos: [['left'], ['right']],
        },
      ],
    },
    {
      name: 'view',
      title: tr('view'),
      shortcuts: [
        { name: 'zoom-in', label: tr('appearanceZoomIn'), combos: [['mod', 'plus']] },
        { name: 'zoom-out', label: tr('appearanceZoomOut'), combos: [['mod', 'minus']] },
        { name: 'actual-size', label: tr('actualSize'), combos: [['mod', 'zero']] },
        {
          name: 'full-screen',
          label: tr('fullScreenToggle'),
          combos: mac ? [['ctrl', 'mod', 'f']] : [['f11']],
        },
        { name: 'shortcuts', label: tr('keyboardShortcuts'), combos: [['mod', 'slash']] },
      ],
    },
  ]
}
