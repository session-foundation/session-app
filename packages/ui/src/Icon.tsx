import { ArrowDown } from '@tamagui/lucide-icons-2/icons/ArrowDown'
import { ArrowLeft } from '@tamagui/lucide-icons-2/icons/ArrowLeft'
import { ArrowRight } from '@tamagui/lucide-icons-2/icons/ArrowRight'
import { ArrowUp } from '@tamagui/lucide-icons-2/icons/ArrowUp'
import { Ban } from '@tamagui/lucide-icons-2/icons/Ban'
import { BellOff } from '@tamagui/lucide-icons-2/icons/BellOff'
import { Bookmark } from '@tamagui/lucide-icons-2/icons/Bookmark'
import { Check } from '@tamagui/lucide-icons-2/icons/Check'
import { ChevronDown } from '@tamagui/lucide-icons-2/icons/ChevronDown'
import { ChevronLeft } from '@tamagui/lucide-icons-2/icons/ChevronLeft'
import { ChevronRight } from '@tamagui/lucide-icons-2/icons/ChevronRight'
import { CircleCheck } from '@tamagui/lucide-icons-2/icons/CircleCheck'
import { CircleEllipsis } from '@tamagui/lucide-icons-2/icons/CircleEllipsis'
import { CircleHelp } from '@tamagui/lucide-icons-2/icons/CircleHelp'
import { Clock } from '@tamagui/lucide-icons-2/icons/Clock'
import { CloudDownload } from '@tamagui/lucide-icons-2/icons/CloudDownload'
import { Copy } from '@tamagui/lucide-icons-2/icons/Copy'
import { Download } from '@tamagui/lucide-icons-2/icons/Download'
import { Ellipsis } from '@tamagui/lucide-icons-2/icons/Ellipsis'
import { ExternalLink } from '@tamagui/lucide-icons-2/icons/ExternalLink'
import { Eye } from '@tamagui/lucide-icons-2/icons/Eye'
import { EyeOff } from '@tamagui/lucide-icons-2/icons/EyeOff'
import { File } from '@tamagui/lucide-icons-2/icons/File'
import { FileArchive } from '@tamagui/lucide-icons-2/icons/FileArchive'
import { FileAudio } from '@tamagui/lucide-icons-2/icons/FileAudio'
import { FileCode } from '@tamagui/lucide-icons-2/icons/FileCode'
import { FileImage } from '@tamagui/lucide-icons-2/icons/FileImage'
import { FilePlus } from '@tamagui/lucide-icons-2/icons/FilePlus'
import { FileSpreadsheet } from '@tamagui/lucide-icons-2/icons/FileSpreadsheet'
import { FileText } from '@tamagui/lucide-icons-2/icons/FileText'
import { FileVideo } from '@tamagui/lucide-icons-2/icons/FileVideo'
import { FolderOpen } from '@tamagui/lucide-icons-2/icons/FolderOpen'
import { Globe } from '@tamagui/lucide-icons-2/icons/Globe'
import { HardDriveDownload } from '@tamagui/lucide-icons-2/icons/HardDriveDownload'
import { Heart } from '@tamagui/lucide-icons-2/icons/Heart'
import { Image } from '@tamagui/lucide-icons-2/icons/Image'
import { Info } from '@tamagui/lucide-icons-2/icons/Info'
import { KeyRound } from '@tamagui/lucide-icons-2/icons/KeyRound'
import { LayoutGrid } from '@tamagui/lucide-icons-2/icons/LayoutGrid'
import { Link } from '@tamagui/lucide-icons-2/icons/Link'
import { List } from '@tamagui/lucide-icons-2/icons/List'
import { LockKeyhole } from '@tamagui/lucide-icons-2/icons/LockKeyhole'
import { Mail } from '@tamagui/lucide-icons-2/icons/Mail'
import { MessageSquare } from '@tamagui/lucide-icons-2/icons/MessageSquare'
import { MessageSquareWarning } from '@tamagui/lucide-icons-2/icons/MessageSquareWarning'
import { Mic } from '@tamagui/lucide-icons-2/icons/Mic'
import { Moon } from '@tamagui/lucide-icons-2/icons/Moon'
import { PackageCheck } from '@tamagui/lucide-icons-2/icons/PackageCheck'
import { PaintbrushVertical } from '@tamagui/lucide-icons-2/icons/PaintbrushVertical'
import { Pin } from '@tamagui/lucide-icons-2/icons/Pin'
import { Play } from '@tamagui/lucide-icons-2/icons/Play'
import { Plus } from '@tamagui/lucide-icons-2/icons/Plus'
import { QrCode } from '@tamagui/lucide-icons-2/icons/QrCode'
import { Reply } from '@tamagui/lucide-icons-2/icons/Reply'
import { RotateCw } from '@tamagui/lucide-icons-2/icons/RotateCw'
import { Search } from '@tamagui/lucide-icons-2/icons/Search'
import { Settings } from '@tamagui/lucide-icons-2/icons/Settings'
import { Share2 } from '@tamagui/lucide-icons-2/icons/Share2'
import { SunMedium } from '@tamagui/lucide-icons-2/icons/SunMedium'
import { Trash2 } from '@tamagui/lucide-icons-2/icons/Trash2'
import { TriangleAlert } from '@tamagui/lucide-icons-2/icons/TriangleAlert'
import { UserRound } from '@tamagui/lucide-icons-2/icons/UserRound'
import { UserRoundPlus } from '@tamagui/lucide-icons-2/icons/UserRoundPlus'
import { UsersRound } from '@tamagui/lucide-icons-2/icons/UsersRound'
import { Video } from '@tamagui/lucide-icons-2/icons/Video'
import { Volume2 } from '@tamagui/lucide-icons-2/icons/Volume2'
import { VolumeX } from '@tamagui/lucide-icons-2/icons/VolumeX'
import { X } from '@tamagui/lucide-icons-2/icons/X'

import type { IconName, IconProps, IconSize } from './Icon.types'
import { isLayoutRtl } from './layoutDirection'

/**
 * The glyph behind each name.
 *
 * **Imported one subpath at a time, never from the package barrel.** The barrel pulls in every one
 * of lucide's ~1500 icons; rollup shakes the unused ones out of the desktop bundle but Metro does
 * not, so a barrel import here costs the mobile app 1500 modules it never draws. The subpaths are
 * declared in the package's exports map, and each one resolves to its own web or native build.
 *
 * `satisfies` rather than an annotation, so this is checked against the union without widening what
 * the values are: every name has a glyph, and a glyph nobody named does not compile.
 */
const GLYPHS = {
  arrowDown: ArrowDown,
  arrowLeft: ArrowLeft,
  arrowRight: ArrowRight,
  arrowUp: ArrowUp,
  ban: Ban,
  bellOff: BellOff,
  bookmark: Bookmark,
  check: Check,
  chevronDown: ChevronDown,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  circleCheck: CircleCheck,
  circleEllipsis: CircleEllipsis,
  circleHelp: CircleHelp,
  clock: Clock,
  cloudDownload: CloudDownload,
  copy: Copy,
  download: Download,
  ellipsis: Ellipsis,
  externalLink: ExternalLink,
  eye: Eye,
  eyeOff: EyeOff,
  file: File,
  fileArchive: FileArchive,
  fileAudio: FileAudio,
  fileCode: FileCode,
  fileImage: FileImage,
  filePlus: FilePlus,
  fileSpreadsheet: FileSpreadsheet,
  fileText: FileText,
  fileVideo: FileVideo,
  folderOpen: FolderOpen,
  globe: Globe,
  hardDriveDownload: HardDriveDownload,
  heart: Heart,
  image: Image,
  info: Info,
  keyRound: KeyRound,
  layoutGrid: LayoutGrid,
  link: Link,
  list: List,
  lockKeyhole: LockKeyhole,
  mail: Mail,
  messageSquare: MessageSquare,
  messageSquareWarning: MessageSquareWarning,
  mic: Mic,
  moon: Moon,
  packageCheck: PackageCheck,
  paintbrush: PaintbrushVertical,
  pin: Pin,
  play: Play,
  plus: Plus,
  qrCode: QrCode,
  reply: Reply,
  rotateCw: RotateCw,
  search: Search,
  settings: Settings,
  share2: Share2,
  sunMedium: SunMedium,
  trash: Trash2,
  triangleAlert: TriangleAlert,
  userRound: UserRound,
  userRoundPlus: UserRoundPlus,
  usersRound: UsersRound,
  video: Video,
  volume: Volume2,
  volumeX: VolumeX,
  x: X,
} satisfies Record<IconName, typeof Plus>

/**
 * Glyphs that depict reading order, and so follow it.
 *
 * The test is what the direction *refers to*, which splits three ways. Reading order mirrors: a
 * list is a picture of text, bullets on the leading edge, so in a mirrored layout the bullets
 * belong on the other side. A media timeline does not: `play` points along the recording, and the
 * platforms' own players keep it pointing the same way in every locale, so mirroring it would make
 * this the only app on the device that disagrees. A picture of an object never does - a folded
 * page corner is a convention, not a direction. `reply` points back up the conversation toward the
 * message answered, which is reading order.
 *
 * Here rather than at the call sites, because `IconName` is closed: one set keyed by it settles
 * each glyph once instead of a judgement repeated wherever one is drawn.
 *
 * **A swap is not a mirror.** `chevronLeft`/`chevronRight` are two real glyphs with their own
 * optical weight, and flipping one gives a worse result than drawing the other - so a caller that
 * needs the pair chooses between them with `isLayoutRtl()` and they are deliberately absent here.
 */
const MIRRORED_IN_RTL: ReadonlySet<IconName> = new Set(['list', 'reply'])

/**
 * One icon, drawn from the set the app has agreed on.
 *
 * The glyphs arrive already wrapped in tamagui's `themed()`, so `color` takes a token and an icon
 * follows the theme without anything here doing the work. No default size: left alone, an icon
 * takes its size from the sized context it is in - a button sizes the icon inside it - and falls
 * back to lucide's own 24 when there is none.
 */
export function Icon({ name, size, ...rest }: IconProps) {
  const Glyph = GLYPHS[name]
  const resolved = typeof size === 'string' ? ICON_SIZES[size] : size
  // lucide ships no mirrored variants, so the flip is ours to apply. `scaleX` rather than a
  // `transform`, which is an array on native and a string on the web; tamagui takes this on both.
  const mirrored = MIRRORED_IN_RTL.has(name) && isLayoutRtl()
  return (
    <Glyph
      {...rest}
      {...(resolved === undefined ? {} : { size: resolved })}
      {...(mirrored ? { scaleX: -1 } : {})}
    />
  )
}

/**
 * Which rung of the dimension ladder each named size is.
 *
 * One to one with the scale's own names, which is not a coincidence -- an icon's vocabulary was
 * chosen to match it. Written out rather than derived, because what this restricts is *which*
 * rungs an icon may use: the ladder runs to 64 and nothing here should draw a glyph that big.
 */
const ICON_SIZES: Record<IconSize, string> = {
  xs: '$xs',
  sm: '$sm',
  md: '$md',
  lg: '$lg',
  xl: '$xl',
}
