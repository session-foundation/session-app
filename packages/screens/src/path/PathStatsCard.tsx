import { PENDING_COPY } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import { LABEL_MAX_SCALE, Text, useFontScale, XStack, YStack } from '@session/ui'
import { useState } from 'react'

import type { PathStats } from './pathActivity'

/** The path screen's figures, under its drawing. */

function ms(value: number | null, copy: string): string {
  return value === null ? '-' : copy.replace('{ms}', String(Math.round(value)))
}

/** A figure over what it counts, a quarter of the card wide, or half where that is too narrow. */
interface StatProps {
  label: string
  value: string
  name: string
  timing: boolean
}

function Stat({ label, value, name, timing }: StatProps) {
  return (
    <YStack flex={1} flexBasis={0} minWidth={0} testID={ELEMENT.settings.pathStat(name)}>
      {timing ? (
        <Text
          size="$body"
          weight="semibold"
          fontFamily="$mono"
          numberOfLines={1}
          maxFontSizeMultiplier={LABEL_MAX_SCALE}
        >
          {value}
        </Text>
      ) : (
        <Text size="$title" weight="bold" numberOfLines={1} maxFontSizeMultiplier={LABEL_MAX_SCALE}>
          {value}
        </Text>
      )}
      <Text size="$caption" tone="secondary" maxFontSizeMultiplier={LABEL_MAX_SCALE}>
        {label}
      </Text>
    </YStack>
  )
}

/** The figures in rows of `perRow`. */
function StatRows({ stats, perRow }: { stats: readonly StatProps[]; perRow: number }) {
  const rows: StatProps[][] = []
  for (let i = 0; i < stats.length; i += perRow) rows.push(stats.slice(i, i + perRow))
  return (
    <YStack gap="$xs">
      {rows.map((row) => (
        <XStack key={row[0]?.name} gap="$2xs">
          {row.map((stat) => (
            <Stat key={stat.name} {...stat} />
          ))}
        </XStack>
      ))}
    </YStack>
  )
}

/**
 * The narrowest a figure's column can be at the default text size: room for a label's longest word
 * ("countries") and a timing with its unit ("304 ms"). It grows with the text, as far as the text
 * itself is allowed to.
 */
const STAT_MIN_PX = 60

/**
 * What is in use, then how quickly it answers, under a rule: four to a row, or two where a quarter
 * of the card is narrower than a figure needs, which large text and a zoomed desktop both reach.
 */
export function PathStatsCard({ stats }: { stats: PathStats }) {
  const [widthPx, setWidthPx] = useState<number | null>(null)
  const textScale = Math.min(Math.max(useFontScale(), 1), LABEL_MAX_SCALE)
  const perRow = widthPx !== null && widthPx / 4 < STAT_MIN_PX * textScale ? 2 : 4
  const counts: StatProps[] = [
    {
      name: 'in-use',
      label: PENDING_COPY.onionRoutingPathsInUse,
      value: String(stats.pathsInUse),
      timing: false,
    },
    {
      name: 'countries',
      label: PENDING_COPY.onionRoutingPathCountries,
      value: String(stats.countriesCrossed),
      timing: false,
    },
    {
      name: 'entry',
      label: PENDING_COPY.onionRoutingPathEntryNodes,
      value: String(stats.entryNodes),
      timing: false,
    },
    {
      name: 'rebuilt',
      label: PENDING_COPY.onionRoutingPathRebuilt,
      value: String(stats.rebuilt),
      timing: false,
    },
  ]
  // Under onion requests a timing is how long requests took to be answered, so it is named as one,
  // and jitter cannot be measured at all.
  const onion = stats.onionRequests
  const timings: StatProps[] = [
    {
      name: 'average',
      label: onion
        ? PENDING_COPY.onionRoutingPathAverageResponse
        : PENDING_COPY.onionRoutingPathAverage,
      value: ms(stats.averageMs, PENDING_COPY.onionRoutingPathMilliseconds),
      timing: true,
    },
    {
      name: 'fastest',
      label: onion
        ? PENDING_COPY.onionRoutingPathFastestResponse
        : PENDING_COPY.onionRoutingPathFastest,
      value: ms(stats.fastestMs, PENDING_COPY.onionRoutingPathMilliseconds),
      timing: true,
    },
    {
      name: 'slowest',
      label: onion
        ? PENDING_COPY.onionRoutingPathSlowestResponse
        : PENDING_COPY.onionRoutingPathSlowest,
      value: ms(stats.slowestMs, PENDING_COPY.onionRoutingPathMilliseconds),
      timing: true,
    },
    {
      name: 'jitter',
      label: PENDING_COPY.onionRoutingPathJitter,
      value: onion
        ? PENDING_COPY.onionRoutingPathNotApplicable
        : ms(stats.jitterMs, PENDING_COPY.onionRoutingPathJitterMilliseconds),
      timing: true,
    },
  ]
  return (
    <YStack
      gap="$xs"
      paddingVertical="$xs"
      paddingHorizontal="$sm"
      borderRadius="$md"
      backgroundColor="$backgroundSecondary"
      onLayout={(event) => {
        setWidthPx(event.nativeEvent.layout.width)
      }}
    >
      <StatRows stats={counts} perRow={perRow} />
      <YStack borderTopWidth={1} borderColor="$separatorColor" paddingTop="$xs">
        <StatRows stats={timings} perRow={perRow} />
      </YStack>
    </YStack>
  )
}
