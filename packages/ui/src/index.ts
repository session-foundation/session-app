/**
 * Every visual component in the app.
 *
 * Nothing outside this package imports tamagui or a react-native primitive, which is why
 * the layout primitives and the provider are re-exported here too: a screen that needs a
 * row should get it from @session/ui rather than reaching around the rule.
 */

export { Avatar } from './Avatar'
export { RecoveryPasswordMark, SessionBrand, SessionWordmark } from './Brand'
export { HeroImage } from './HeroImage'
export { KeyboardAvoiding } from './KeyboardAvoiding'
export { PressArea } from './PressArea'
export { RadioIndicator } from './RadioIndicator'
export { Reveal } from './Reveal'
export { ScannerFrame } from './ScannerFrame'
export { textHeight } from './textHeight'
export { useScreenInsets } from './screenInsets'
export type { ScreenInsets } from './screenInsets.types'
export { SlidePager } from './SlidePager'
export type { SlidePagerProps } from './SlidePager.types'
export { StepTransition } from './StepTransition'
export { TopTabs } from './TopTabs'
/** The tab bar's height, so a layout reserving room for one asks rather than restates it. */
export { BAR_HEIGHT as TOP_TABS_HEIGHT } from './topTabsMetrics'
export type { TopTab, TopTabsProps } from './TopTabs.types'
export { SafeArea, type SafeAreaProps } from './SafeArea'
export { useTokenColor } from './useTokenColor'
export { useWindowSize } from './useWindowSize'
export { ProgressRing } from './ProgressRing'
export type { AvatarProps } from './Avatar'
export { Button } from './Button'
export type { ButtonProps } from './Button'
export { Icon } from './Icon'
export { IconRing } from './IconRing'
export type { IconName, IconProps } from './Icon.types'
export { Image } from './Image'
export type { ImageProps } from './Image'
export { Input } from './Input'
export { LanguagePicker } from './LanguagePicker'
export type {
  LanguageChoice,
  LanguagePickerProps,
  LanguagePickerTestIDs,
} from './LanguagePicker.types'
export { List } from './List'
export { MessageBubble, type MessageBubbleProps } from './MessageBubble'
export { Modal } from './Modal'
export type { ListProps } from './List'
export type { InputProps } from './Input.types'
export { Progress } from './Progress'
export type { ProgressProps } from './Progress'
export { Screen } from './Screen'
export { Text, type TextProps, type TextSize } from './Text'
export { UIProvider } from './UIProvider'
export type { UIProviderProps } from './UIProvider'
export type { BackdropBlur, BackdropBlurProps } from './backdropBlur'

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
export { applyDirection } from './textDirection'
export { backChevron } from './backChevron'
export { isLayoutRtl } from './layoutDirection'
export { DirectionRoot } from './DirectionRoot'
export type { DirectionRootProps } from './DirectionRoot.types'
export { FieldError } from './FieldError'
export type { FieldErrorProps } from './FieldError'
export { InputField } from './InputField'
export type { InputFieldHandle, InputFieldProps } from './InputField'
export { isDarkTheme } from './themes'
export { useThemeIsDark } from './UIProvider'
export { logical } from './logicalEdges'
export type { LogicalEdges } from './logicalEdges.types'
export { AttachmentTile } from './AttachmentTile'
export type { AttachmentTileProps } from './AttachmentTile'
export { TILE_RADIUS_STEP, TILE_SCRIM, tileRadius } from './attachmentTile'
export { MediaViewer } from './MediaViewer'
export type { MediaViewerItem, MediaViewerProps } from './MediaViewer'
