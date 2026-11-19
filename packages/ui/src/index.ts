/**
 * Every visual component in the app.
 *
 * Nothing outside this package imports tamagui or a react-native primitive, which is why
 * the layout primitives and the provider are re-exported here too: a screen that needs a
 * row should get it from @session/ui rather than reaching around the rule.
 */

export { Avatar } from './Avatar'
export {
  ProBadge,
  RecoveryPasswordMark,
  RecoveryPasswordShield,
  SessionBrand,
  SessionTokenLogo,
  SessionTokenMark,
  SessionWordmark,
  sessionBrandWidth,
  sessionWordmarkWidth,
  type MarkProps,
} from './Brand'
export { HeroImage } from './HeroImage'
export { KeyboardAvoiding } from './KeyboardAvoiding'
export { PressArea } from './PressArea'
export { QrCode, type QrCodeProps } from './QrCode'
export { QrViewer, type QrViewerAction, type QrViewerMenu, type QrViewerProps } from './QrViewer'
export { RadioIndicator } from './RadioIndicator'
export { Reveal } from './Reveal'
export { Swap } from './Swap'
export { ScannerFrame } from './ScannerFrame'
export { textHeight } from './textHeight'
export { useFontScale } from './useFontScale'
export { EndPinnedScroll } from './EndPinnedScroll'
export { EndAboveKeyboardScroll } from './EndAboveKeyboardScroll'
export {
  GLYPH_MAX_SCALE,
  LABEL_MAX_SCALE,
  useCappedFontScale,
  useGlyphScale,
} from './fontScaleCaps'
export { FitText } from './FitText'
export { MIN_FIT_SCALE } from './fittedFontSize'
export { setPageZoom, usePageZoom } from './pageZoom'
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
export {
  PathFlow,
  pathFlowColor,
  pathFlowTripMs,
  type PathFlowKind,
  type PathFlowPacket,
  type PathFlowPath,
  type PathFlowProps,
} from './PathFlow'
export { ProgressRing } from './ProgressRing'
export { inkFor, ON_ACCENT_SECONDARY_OPACITY, type InkTone } from './ink'
export type { AvatarProps } from './Avatar'
export { BarButton, type BarButtonProps } from './BarButton'
export { BarRule } from './BarRule'
export { BarTitle } from './BarTitle'
export type { BarTitleProps } from './BarTitle'
export { Button } from './Button'
export { ButtonProgress, type ButtonProgressProps } from './ButtonProgress'
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
export {
  TranscriptList,
  type TranscriptListHandle,
  type TranscriptListProps,
} from './TranscriptList'
export type { ListFocusEntry } from './listFocus'
export { MessageBubble, type MessageBubbleProps } from './MessageBubble'
export { MESSAGE_FRAME_INSET_PX, MessageFrame, type MessageFrameProps } from './MessageFrame'
export { ComposerReply, type ComposerReplyProps } from './ComposerReply'
export { type Haptics, HapticsProvider } from './haptics'
export { replyAction } from './replyAction'
export { SwipeToReply, type SwipeToReplyProps } from './SwipeToReply'
export { ScrollToLatest, type ScrollToLatestProps } from './ScrollToLatest'
export { MessageQuote, type MessageQuoteProps } from './MessageQuote'
export {
  quotePreview,
  type QuotedAttachment,
  type QuotedMessage,
  type QuoteLabels,
} from './quotePreview'
export { Modal } from './Modal'
/** What a row of small controls grows to on touch, and 0 with a pointer. */
export { ROW_TOUCH_TARGET } from './rowTouchTarget'
export { Sheet, SheetSurface } from './Sheet'
export type { SheetProps, SheetSurfaceProps } from './Sheet'
export {
  ModalStackProvider,
  useModalEntries,
  useModalNavigation,
  useModals,
} from './ModalsProvider'
export type { Modals, ModalPresentation, ModalScreen } from './ModalsProvider'
export { ModalStackHost } from './ModalStackHost'
export { ModalStackRoot } from './ModalStackRoot'
export type { ListProps } from './List'
export type { InputProps } from './Input.types'
export { Progress } from './Progress'
export { RailButton, type RailButtonProps } from './RailButton'
export { KeyCombo, type KeyComboProps, type KeyName, type KeyNames } from './KeyCombo'
export { StatusDot, type StatusTone } from './StatusDot'
export { ContextMenu, ContextMenuLayer, elementMenuAnchor } from './ContextMenu'
export type { ContextMenuLayerProps, ContextMenuProps, ContextMenuTestIDs } from './ContextMenu'
export { tidyMenu } from './contextMenuEntries'
export type { ContextMenuEntry, ContextMenuRow } from './contextMenuEntries'
export type { MenuAnchor } from './contextMenuPlacement'
export { ContextMenuTarget } from './ContextMenuTarget'
export { useMenuLongPress } from './menuLongPress'
export type { ContextMenuTargetProps } from './ContextMenuTarget.types'
export { Tooltip } from './Tooltip'
export type { TooltipProps } from './Tooltip.types'
export type { TooltipPlacement } from './tooltipPosition'
export type { ProgressProps } from './Progress'
export { Screen } from './Screen'
export { PaneSurfaceProvider, usePaneSurface, type PaneSurface } from './paneSurface'
export { SettingsGroup, SettingsNote, SettingsRow, SettingsSection } from './SettingsRow'
export type { SettingsRowProps } from './SettingsRow'
export { Text, type TextProps, type TextSize } from './Text'
export { UIProvider } from './UIProvider'
export type { UIProviderProps } from './UIProvider'
export type { BackdropBlur, BackdropBlurProps } from './backdropBlur'
export type { Glass, GlassProps } from './glass'
export type { PathSprite, PathSpriteLayer, PathSprites, PathSpritesProps } from './pathSprites'
export {
  useTopBarControlsPadding,
  WindowControlsInsetProvider,
  type WindowControlsInset,
} from './windowControls'

export { config, tokens } from './config'
// The numbers behind the named scales, for a raw style that tamagui does not resolve.
export { SIZE_SCALE, SPACE_SCALE } from './scales'
export {
  appearanceFrom,
  buildThemes,
  DEFAULT_ACCENT,
  DEFAULT_THEME,
  PRIMARY_COLORS,
  registerTheme,
  themeName,
  THEME_STATES,
} from './themes'

export { keyboardTypeToInputMode, keyboardTypeToNative, domInputType } from './nativeProps'
export type { KeyboardType } from './nativeProps'

// Layout primitives and hooks, re-exported so app and screen code never imports tamagui.
export { ScrollView, Separator, Spinner, XStack, YStack, styled, useMedia, useTheme } from 'tamagui'
export type { GetProps } from 'tamagui'
export { applyDirection } from './textDirection'
export { backChevron, forwardChevron } from './backChevron'
export { isLayoutRtl } from './layoutDirection'
export { DirectionRoot } from './DirectionRoot'
export type { DirectionRootProps } from './DirectionRoot.types'
export { FieldError } from './FieldError'
export type { FieldErrorProps } from './FieldError'
export { InputField } from './InputField'
export type { InputFieldHandle, InputFieldProps } from './InputField'
export { isDarkTheme, oppositePolarity } from './themes'
export { useThemeIsDark } from './UIProvider'
export { logical } from './logicalEdges'
export type { LogicalEdges } from './logicalEdges.types'
export { AttachmentTile } from './AttachmentTile'
export { Announcement, type AnnouncementProps } from './Announcement'
export { ComposerNotice, type ComposerNoticeProps } from './ComposerNotice'
export { DropOverlay, type DropOverlayProps } from './DropOverlay'
export { DropZone } from './DropZone'
export type { DropZoneProps } from './DropZone.types'
export { StagedTile, type StagedTileProps } from './StagedTile'
export { StagedTray, type StagedTrayProps } from './StagedTray'
export { ATTACH_OPENS_MENU } from './stagingMetrics'
export type { AttachmentTileProps } from './AttachmentTile'
export { TILE_RADIUS_STEP, TILE_SCRIM, tileRadius } from './attachmentTileStyle'
export { MIN_HIT_TARGET, buttonHeight } from './buttonHitTarget'
export { MediaViewer } from './MediaViewer'
export type { MediaViewerItem, MediaViewerProps } from './MediaViewer'
export { AttachmentAlbum } from './AttachmentAlbum'
export type { AlbumItem, AttachmentAlbumProps } from './AttachmentAlbum'
export { ALBUM_MAX_TILES, ALBUM_SEAM, albumLayout, lastTile } from './albumLayout'
export type { AlbumLayout, AlbumRow, AlbumTileRect } from './albumLayout'
export { FileRow } from './FileRow'
export type { FileRowProps, FileRowTestIDs, FileRowThumbnail } from './FileRow'
export {
  FILE_GLYPH_SIDE,
  FILE_LEAD_WIDTH,
  FILE_ROW_CONTROL,
  FILE_ROW_GAP,
  fileRowControl,
  fileRowMarker,
  fileRowHeight,
  fileRowTone,
} from './fileRowState'
export type { FileRowState, FileRowTone } from './fileRowState'
export { fileFormat, fileGlyph, splitFilename } from './attachmentFile'
export type { WithTestID } from './with'
export { FONT_ASSETS } from './fontAssets'
export { ToastHost } from './ToastHost'
export { ToastProvider, useToast, type Toasts } from './Toasts'
export { LAUNCH_MARK_HEIGHT } from './brandMark'
export { BRAND_GREEN } from '@session/theme-tokens'
export { UpdateIndicator } from './UpdateIndicator'
export type { UpdateIndicatorProps, UpdateStatus } from './UpdateIndicator.types'
