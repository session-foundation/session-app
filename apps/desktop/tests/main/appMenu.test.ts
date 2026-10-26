import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it } from 'vitest'

import { appMenuTemplate } from '#src/main/appMenu'
import type { ZoomStep } from '#src/main/zoom'

function viewItems(template: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  const view = template.find((menu) => menu.role === 'viewMenu')?.submenu
  if (!Array.isArray(view)) throw new Error('no View menu')
  return view
}

describe('the menu bar', () => {
  it('zooms the content from its own items, never with the browser zoom roles', () => {
    const steps: ZoomStep[] = []
    const view = viewItems(
      appMenuTemplate({ platform: 'darwin', dev: false, onZoom: (step) => steps.push(step) }),
    )
    const roles = view.map((item) => item.role)
    for (const role of ['zoomIn', 'zoomOut', 'resetZoom'] as const)
      expect(roles).not.toContain(role)
    for (const accelerator of ['CmdOrCtrl+Plus', 'CmdOrCtrl+=', 'CmdOrCtrl+-', 'CmdOrCtrl+0']) {
      const item = view.find((candidate) => candidate.accelerator === accelerator)
      // @ts-expect-error -- a click handler called without Electron's arguments, which these ignore
      item?.click?.()
    }
    expect(steps).toEqual(['in', 'in', 'out', 'reset'])
  })

  it("keeps the platform's own menus around it", () => {
    const mac = appMenuTemplate({ platform: 'darwin', dev: false, onZoom: () => undefined })
    expect(mac.map((menu) => menu.role)).toEqual(['appMenu', 'editMenu', 'viewMenu', 'windowMenu'])
    const linux = appMenuTemplate({ platform: 'linux', dev: false, onZoom: () => undefined })
    expect(linux[0]?.role).toBe('fileMenu')
  })

  it('offers the developer tools only in an unpackaged build', () => {
    const roles = (dev: boolean) =>
      viewItems(appMenuTemplate({ platform: 'darwin', dev, onZoom: () => undefined })).map(
        (item) => item.role,
      )
    expect(roles(false)).not.toContain('toggleDevTools')
    expect(roles(true)).toContain('toggleDevTools')
  })
})
