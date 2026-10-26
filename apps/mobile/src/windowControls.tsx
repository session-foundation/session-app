import { WindowControlsInsetProvider, type WindowControlsInset } from '@session/ui'
import { requireOptionalNativeModule } from 'expo'
import { useEffect, useState, type ReactNode } from 'react'
import { useWindowDimensions } from 'react-native'

interface WindowChromeModule {
  controlsInsets(): Promise<WindowControlsInset>
}

/** iOS only: see modules/window-chrome. Null on Android, which draws no controls in the window. */
const WindowChrome = requireOptionalNativeModule<WindowChromeModule>('WindowChrome')

/**
 * How long the window's size has to hold still before the controls' inset is read again. A live
 * resize changes the size on every step, and the region the controls take is laid out for the new
 * size only after it settles; one read once it has costs one native call instead of two per step.
 */
const SETTLE_MS = 150

/**
 * The window controls' inset, for everything below it, read when the window settles at a new size
 * -- which is also what entering or leaving a resizable window does, the only times the controls
 * come or go.
 *
 * A component of its own rather than a hook in the root, so a resize re-renders only what reads
 * the inset: its children are the same element each time, and React leaves them alone.
 */
export function WindowControlsInsetRoot({ children }: { children: ReactNode }) {
  const { width, height } = useWindowDimensions()
  const [inset, setInset] = useState<WindowControlsInset>({ left: 0, right: 0 })

  useEffect(() => {
    if (WindowChrome === null) return
    let live = true
    const read = setTimeout(() => {
      void WindowChrome.controlsInsets().then((next) => {
        if (!live) return
        setInset((prev) => (prev.left === next.left && prev.right === next.right ? prev : next))
      })
    }, SETTLE_MS)
    return () => {
      live = false
      clearTimeout(read)
    }
  }, [width, height])

  return <WindowControlsInsetProvider value={inset}>{children}</WindowControlsInsetProvider>
}
