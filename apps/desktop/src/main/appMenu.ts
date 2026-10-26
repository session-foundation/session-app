import type { MenuItemConstructorOptions } from 'electron'

import { tr } from '@session/localization'

import type { ZoomStep } from './zoom'

/**
 * The menu bar, which replaces Electron's default for one reason: its View menu.
 *
 * The default's Zoom In and Zoom Out are the browser's zoom, which shrinks the page's CSS width and
 * so flips a wide window to the phone layout. These items zoom the content instead (see
 * `setPageZoom` in the UI package) and leave the layout to the window's size.
 *
 * The other menus are Electron's own roles, unchanged, so the platform's standard items -- About,
 * Quit, the editing commands, Minimise -- stay as every Mac and PC app has them.
 */
export function appMenuTemplate({
  platform,
  dev,
  onZoom,
}: {
  platform: NodeJS.Platform
  /** Unpackaged: reload and the developer tools, which the default menu also offers. */
  dev: boolean
  onZoom: (step: ZoomStep) => void
}): MenuItemConstructorOptions[] {
  const view: MenuItemConstructorOptions[] = [
    {
      label: tr('appearanceZoomIn'),
      accelerator: 'CmdOrCtrl+Plus',
      click: () => {
        onZoom('in')
      },
    },
    // The same command on the unshifted key. `+` shares a key with `=` on most layouts, and making
    // somebody hold Shift to zoom in, but not to zoom out, is the browser's convention to avoid.
    {
      label: tr('appearanceZoomIn'),
      accelerator: 'CmdOrCtrl+=',
      visible: false,
      click: () => {
        onZoom('in')
      },
    },
    {
      label: tr('appearanceZoomOut'),
      accelerator: 'CmdOrCtrl+-',
      click: () => {
        onZoom('out')
      },
    },
    {
      label: tr('actualSize'),
      accelerator: 'CmdOrCtrl+0',
      click: () => {
        onZoom('reset')
      },
    },
    { type: 'separator' },
    { role: 'togglefullscreen', label: tr('fullScreenToggle') },
    ...(dev
      ? ([
          { type: 'separator' },
          { role: 'reload' },
          { role: 'toggleDevTools', label: tr('developerToolsToggle') },
        ] satisfies MenuItemConstructorOptions[])
      : []),
  ]

  return [
    platform === 'darwin' ? { role: 'appMenu' } : { role: 'fileMenu' },
    { role: 'editMenu' },
    // The role menus are Electron's, titles and items in its English; only View's items are ours,
    // and translated. Titling the others needs catalogue keys that do not exist yet.
    { role: 'viewMenu', submenu: view },
    { role: 'windowMenu' },
  ]
}
