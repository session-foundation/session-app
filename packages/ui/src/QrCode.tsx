import { QR_MARK_FILL, qrMarkModules } from '@session/basic-types'
import { useMemo, type ComponentType } from 'react'
import Svg, { Path } from 'react-native-svg'
import { YStack } from 'tamagui'
import { encode } from 'uqr'

import type { MarkProps } from './Brand'
import { useTokenColor } from './useTokenColor'

export interface QrCodeProps {
  value: string
  /** The whole panel's width and height, its quiet zone included. */
  sizePx: number
  /** Drawn over the middle in the modules' colour: the recovery password's shield. */
  logo?: ComponentType<MarkProps> | undefined
  /** Its name for a screen reader: a code with no name is an image nobody can identify. */
  accessibilityLabel: string
  testID?: string | undefined
}

/** Modules of panel around the code: the quiet zone a scanner needs to find its edge. */
const QUIET_MODULES = 2

/**
 * One path for every dark module, a rectangle per run along a row: a code is up to 177 modules
 * square, and an element per module is thousands of nodes for the renderer to keep.
 */
function modulePath(data: boolean[][], skip: (x: number, y: number) => boolean): string {
  const parts: string[] = []
  data.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      if (!row[x] || skip(x, y)) {
        x += 1
        continue
      }
      const start = x
      while (x < row.length && row[x] && !skip(x, y)) x += 1
      parts.push(`M${start + QUIET_MODULES} ${y + QUIET_MODULES}h${x - start}v1h${start - x}z`)
    }
  })
  return parts.join('')
}

/**
 * A QR code, dark on light in every theme: the modules take `surfaceInk` and the panel
 * `surfaceInverted`, which swap roles between light and dark themes for exactly this (see
 * docs/THEMING.md). Error correction level Q, as the legacy desktop client draws, so a logo over
 * the middle still scans.
 */
export function QrCode({ value, sizePx, logo: Logo, accessibilityLabel, testID }: QrCodeProps) {
  const ink = useTokenColor('$surfaceInk')
  const { size, data } = useMemo(() => encode(value, { ecc: 'Q', border: 0 }), [value])
  const span = size + QUIET_MODULES * 2
  const modulePx = sizePx / span

  // The same square the saved PNG clears, so the two draw one code.
  const logoModules = Logo === undefined ? 0 : qrMarkModules(size)
  const logoStart = (size - logoModules) / 2
  const path = useMemo(
    () =>
      modulePath(
        data,
        (x, y) =>
          x >= logoStart &&
          x < logoStart + logoModules &&
          y >= logoStart &&
          y < logoStart + logoModules,
      ),
    [data, logoStart, logoModules],
  )

  return (
    // `relative`: the code is laid over this panel, and on the web a stack is static unless it says
    // so, which would place the code against the page instead.
    <YStack
      position="relative"
      width={sizePx}
      height={sizePx}
      backgroundColor="$surfaceInverted"
      borderRadius="$md"
      overflow="hidden"
      alignItems="center"
      justifyContent="center"
      role="img"
      aria-label={accessibilityLabel}
      testID={testID}
    >
      <Svg
        width={sizePx}
        height={sizePx}
        viewBox={`0 0 ${span} ${span}`}
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        <Path d={path} fill={ink} />
      </Svg>
      {Logo === undefined ? null : (
        <Logo size={logoModules * modulePx * QR_MARK_FILL} color="$surfaceInk" />
      )}
    </YStack>
  )
}
