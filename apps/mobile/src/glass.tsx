import type { Glass } from '@session/ui'
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect'
import { Platform, View } from 'react-native'

/** iOS 26 bar-button glass; null where there is none, so controls keep their own drawing. */
export const mobileGlass: Glass | null =
  Platform.OS === 'ios' && isLiquidGlassAvailable()
    ? ({ size, dark, highlight, children }) => (
        <GlassView
          glassEffectStyle="regular"
          isInteractive
          // The app's theme, not the device's: a light-mode phone showing a dark theme would
          // otherwise get pale glass.
          colorScheme={dark ? 'dark' : 'light'}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {highlight === null ? null : (
            // The whole disc, as a system glass button lights under a pointer.
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: highlight,
              }}
            />
          )}
          {children}
        </GlassView>
      )
    : null
