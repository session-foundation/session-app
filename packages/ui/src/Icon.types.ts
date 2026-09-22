import type { ComponentProps } from 'react'

import type { Plus } from '@tamagui/lucide-icons-2/icons/Plus'

/**
 * Every icon the app draws, and what it is called here.
 *
 * A closed union rather than a string, because the map in `Icon.tsx` is keyed by it: a name with
 * no glyph behind it and a glyph nothing names are both a type error, rather than an icon that
 * silently fails to appear. Adding one is two lines - a member here, an entry there.
 *
 * Named for the glyph in lucide's vocabulary rather than for where it is used. The same icon turns
 * up in more than one place, and a name like `newConversation` is either duplicated or wrong the
 * second time somebody reaches for it.
 */
export type IconName =
  | 'check'
  | 'chevronDown'
  | 'chevronLeft'
  | 'chevronRight'
  | 'circleHelp'
  | 'clock'
  | 'download'
  | 'ellipsis'
  | 'externalLink'
  | 'eye'
  | 'eyeOff'
  | 'file'
  | 'fileArchive'
  | 'fileAudio'
  | 'fileCode'
  | 'fileImage'
  | 'fileSpreadsheet'
  | 'fileText'
  | 'fileVideo'
  | 'folderOpen'
  | 'hardDriveDownload'
  | 'image'
  | 'layoutGrid'
  | 'link'
  | 'list'
  | 'play'
  | 'plus'
  | 'rotateCw'
  | 'search'
  | 'settings'
  | 'share2'
  | 'triangleAlert'
  | 'video'
  | 'x'

/**
 * How big an icon is drawn, named rather than numbered.
 *
 * The underlying scale is a ladder of dimensions shared with control heights, where a caller can
 * only say which rung -- and a rung number tells a reader nothing about what they will get. These
 * are the sizes the app actually uses, so a screen names one instead of counting.
 *
 * Omitted, an icon takes its size from the sized context it is in: a button sizes the icon inside
 * it, which is why most icons here say nothing.
 *
 * A raw number is still accepted, for the one case a name cannot serve: an icon that has to match
 * something drawn at a measured pixel size, where agreeing with that number is the whole point.
 */
export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

/**
 * Whatever a themed lucide icon accepts, plus which one to draw and how big.
 *
 * Taken from a glyph rather than written out, so `color` and the style props stay whatever the icon
 * set actually takes across a version bump. `color` is tamagui's and reads the theme
 * (`$textSecondary`), so an icon restyles with a theme like everything else. `size` is narrowed to
 * the named vocabulary above.
 */
export type IconProps = Omit<ComponentProps<typeof Plus>, 'size'> & {
  name: IconName
  size?: IconSize | number
}
