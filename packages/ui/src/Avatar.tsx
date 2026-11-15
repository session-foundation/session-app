import { COLORS, FONT_SIZE, PRIMARY_COLOR_HEX } from '@session/theme-tokens'
import { XStack } from 'tamagui'

import { avatarInitials } from './avatarInitials'
import { avatarPairLayout } from './avatarPair'
import { logical } from './logicalEdges'
import { rampSizeAtMost } from './rampSize'
import { SIZE_SCALE } from './scales'
import { Text } from './Text'
import { usePaneSurface } from './paneSurface'

/**
 * Initials on a colour derived from the id, until a display picture is fetched.
 *
 * The colour comes from the account id rather than the name, so it stays put when someone
 * changes their display name or is given a nickname.
 */
const ACCENTS = Object.values(PRIMARY_COLOR_HEX)

function colorFor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return ACCENTS[hash % ACCENTS.length] ?? ACCENTS[0] ?? '#31F196'
}

/** Initials scale with the diameter; one letter gets more room. */
const INITIALS_RATIO = { one: 0.5, more: 0.4 } as const

/**
 * The top of the type ramp. Initials that would be larger are drawn at their own size rather
 * than capped here, or an enlarged display picture's initials barely grow with the disc. A font
 * size rather than a scale transform, which iOS draws as a stretched bitmap.
 */
const RAMP_TOP_PX = Math.max(...Object.values(FONT_SIZE))

const DEFAULT_SIZE_PX = SIZE_SCALE['2xl']

/** A rung of the size ladder, so a caller outside this package can name one without the scale. */
type AvatarSize = Exclude<keyof typeof SIZE_SCALE, 'none' | 'true'>

/** Whose avatar: the account the colour and the initials are read from. */
interface AvatarMember {
  id: string
  name: string
}

type WithAvatarFrame = {
  /**
   * The diameter, or for a pair the square both discs sit in: a rung of the size ladder, or
   * points.
   */
  size?: AvatarSize | number | undefined
  testID?: string | undefined
}

type SingleAvatarProps = AvatarMember & WithAvatarFrame

/** Two members of a group, the first drawn in front. */
type AvatarPairProps = { members: readonly [AvatarMember, AvatarMember] } & WithAvatarFrame

export type AvatarProps = SingleAvatarProps | AvatarPairProps

interface DiscProps extends AvatarMember {
  sizePx: number
  ringPx?: number | undefined
  testID?: string | undefined
}

function Disc({ id, name, sizePx, ringPx, testID }: DiscProps) {
  const letters = avatarInitials(name, id)
  // The ring is inside the box on both platforms, so the initials fit what is left of it.
  const innerPx = sizePx - 2 * (ringPx ?? 0)
  const surface = usePaneSurface()
  const initialsPx = Math.floor(innerPx * INITIALS_RATIO[letters.length > 1 ? 'more' : 'one'])
  const initialsSize =
    initialsPx > RAMP_TOP_PX
      ? { fontSize: initialsPx, lineHeight: initialsPx }
      : { size: `$${rampSizeAtMost(initialsPx)}` as const }
  return (
    <XStack
      width={sizePx}
      height={sizePx}
      borderRadius={sizePx / 2}
      backgroundColor={colorFor(id)}
      alignItems="center"
      justifyContent="center"
      borderWidth={ringPx ?? 0}
      borderColor={surface}
      testID={testID}
    >
      {/* White: the circle is the account's colour, not the theme's, so no theme role fits. The
          initials are sized off the disc, so the system text size must not scale them a second
          time: a disc that grows with the text already carries them with it. */}
      <Text {...initialsSize} weight="bold" color={COLORS.WHITE} allowFontScaling={false}>
        {letters}
      </Text>
    </XStack>
  )
}

/**
 * One account's disc, or two members of a group overlapping in one square.
 *
 * A pair's ring is the page colour, which is the ground a conversation list row sits on; on a row
 * that is hovered or pressed the ring keeps the page colour rather than following the state.
 */
export function Avatar(props: AvatarProps) {
  const sizePx =
    props.size === undefined
      ? DEFAULT_SIZE_PX
      : typeof props.size === 'number'
        ? props.size
        : SIZE_SCALE[props.size]
  if (!('members' in props))
    return <Disc id={props.id} name={props.name} sizePx={sizePx} testID={props.testID} />

  const [front, back] = props.members
  const { backPx, frontPx, ringPx } = avatarPairLayout(sizePx)
  return (
    // `position="relative"`: the web makes no containing block by default, so the absolute discs
    // would otherwise place themselves against whichever ancestor happens to be positioned.
    <XStack width={sizePx} height={sizePx} position="relative" testID={props.testID}>
      <XStack position="absolute" top={0} {...logical({ insetStart: 0 })}>
        <Disc id={back.id} name={back.name} sizePx={backPx} />
      </XStack>
      <XStack position="absolute" bottom={0} {...logical({ insetEnd: 0 })}>
        <Disc id={front.id} name={front.name} sizePx={frontPx} ringPx={ringPx} />
      </XStack>
    </XStack>
  )
}
