/**
 * Every visual component in the app.
 *
 * Nothing outside this package imports tamagui or a react-native primitive, which is why
 * the layout primitives and the provider are re-exported here too: a screen that needs a
 * row should get it from @session/ui rather than reaching around the rule.
 */

export { Avatar } from './Avatar'
export type { AvatarProps } from './Avatar'
export { Button } from './Button'
export type { ButtonProps } from './Button'
export { Icon } from './Icon'
export type { IconName, IconProps } from './Icon.types'
export { Input } from './Input'
export { List } from './List'
export type { ListProps } from './List'
export type { InputProps } from './Input.types'
export { Progress } from './Progress'
export type { ProgressProps } from './Progress'
export { Screen } from './Screen'
export { Text } from './Text'
export { UIProvider } from './UIProvider'
export type { UIProviderProps } from './UIProvider'

export { config, tokens } from './config'
export {
  buildThemes,
  DEFAULT_ACCENT,
  DEFAULT_THEME,
  PRIMARY_COLORS,
  themeName,
  THEME_STATES,
} from './themes'

export { keyboardTypeToInputMode, keyboardTypeToNative, domInputType } from './nativeProps'
export type { KeyboardType } from './nativeProps'

// Layout primitives and hooks, re-exported so app and screen code never imports tamagui.
export { ScrollView, Separator, Spinner, XStack, YStack, styled, useMedia, useTheme } from 'tamagui'
export type { GetProps } from 'tamagui'
