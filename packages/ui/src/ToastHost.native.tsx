import type { ReactNode } from 'react'
import { Platform } from 'react-native'
import { FullWindowOverlay } from 'react-native-screens'
import { YStack } from 'tamagui'

import { useScreenInsets } from './screenInsets'
import { SPACE_SCALE } from './scales'
import { ToastCard } from './ToastCard'
import type { ToastHostProps } from './ToastHost.types'
import { useToastQueue } from './Toasts'

/**
 * Above the settings modal on iOS, which presents it in a window of its own: drawn in the app's
 * window, a toast raised from inside settings would be behind the panel that raised it. Android's
 * modal stack is a view in the app's window, and the toasts are already drawn after it; a
 * full-screen layer there is a window of its own, which draws its own (see `FullScreenModal`).
 */
function AboveModals({ children }: { children: ReactNode }) {
  return Platform.OS === 'ios' ? <FullWindowOverlay>{children}</FullWindowOverlay> : children
}

/**
 * How many are shown at once on a phone, fewer than the desktop's: each takes the full width.
 * Every toast's timer runs from when it is raised, shown or not, so one beyond the third appears
 * only if an earlier one is closed before its time is up.
 */
const PHONE_LIMIT = 3

/**
 * The toasts, centred above the bottom of the screen's safe area, newest on top as on the desktop.
 *
 * Stacked rather than one at a time, so a second message does not hide the first while both may
 * still matter. They go quickly enough, and a press dismisses one.
 */
export function ToastHost({ testID, closeTestID, closeLabel }: ToastHostProps) {
  const { toasts, dismiss } = useToastQueue()
  const insets = useScreenInsets()
  const shown = toasts.slice(0, PHONE_LIMIT)
  if (shown.length === 0) return null
  return (
    <AboveModals>
      <YStack
        fullscreen
        justifyContent="flex-end"
        alignItems="center"
        paddingHorizontal="$md"
        paddingBottom={insets.bottom + SPACE_SCALE.xl}
        gap="$xs"
        pointerEvents="box-none"
      >
        {shown.map((toast) => (
          <ToastCard
            key={toast.serial}
            text={toast.text}
            testID={testID}
            closeTestID={closeTestID}
            closeLabel={closeLabel}
            onPress={() => {
              dismiss(toast.serial)
            }}
          />
        ))}
      </YStack>
    </AboveModals>
  )
}
