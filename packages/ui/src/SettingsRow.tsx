import {
  Children,
  Fragment,
  isValidElement,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from 'react'
import { useWindowDimensions } from 'react-native'
import { XStack, YStack } from 'tamagui'

import { forwardChevron } from './backChevron'
import type { MarkProps } from './Brand'
import { Icon } from './Icon'
import type { IconName } from './Icon.types'
import type { FocusRingShape } from './keyboardPress'
import { logical } from './logicalEdges'
import { usePageZoom } from './pageZoom'
import { PressArea } from './PressArea'
import { PRESS_PASSTHROUGH } from './pressPassthrough'
import { SIZE_SCALE, SPACE_SCALE } from './scales'
import { Text } from './Text'
import { useFontScale } from './useFontScale'
import { LABEL_MAX_SCALE, useGlyphScale } from './fontScaleCaps'

/** A control's rung rather than a text line's: a row is a tap target. */
const ROW_MIN_HEIGHT = SIZE_SCALE['4xl']

/** Inside the row: its group clips whatever is drawn past its edge. */
const ROW_RING: FocusRingShape = { onAccent: false, offset: -2, radius: '$sm' }

/** How wide the leading icon's column is, so labels line up whether or not a row has one. */
const ICON_COLUMN = SIZE_SCALE.lg

/** The leading glyph, at the default text size. */
const ICON_SIZE = SIZE_SCALE.lg

/**
 * The text size from which a wide trailing control goes under the text rather than beside it: the
 * accessibility sizes. Beside it, a button keeps its width and squeezes the label and subtitle into
 * a column a word or two wide.
 */
const STACK_TRAILING_FROM_SCALE = 1.5

/**
 * One device pixel, under the desktop's zoom too. A fixed length lands on one device pixel or two
 * depending on position, and a fraction of one is rounded to nothing at some positions, so one
 * group's lines would draw at different weights or not at all.
 */
function useSeparatorHeight(): number {
  const { scale } = useWindowDimensions()
  return 1 / (scale * usePageZoom())
}

/** One line of a row's details: a setting's name, as the caller words it, and how it stands. */
export interface SettingsRowDetail {
  /** Punctuated by the caller, "Current:", since a colon is not the same in every language. */
  label: string
  value: string
  /**
   * Not in effect, as a mock that is off: in the secondary ink rather than the accent. Not the
   * disabled ink, which on a row that is not disabled falls short of the contrast text needs.
   */
  inactive?: boolean | undefined
}

export interface SettingsRowProps {
  label: string
  /**
   * Rows in one group either all have one or none do. An element is drawn as given, for a glyph
   * that is not one colour on a square (the Pro badge); the caller sizes and tones it.
   */
  icon?: IconName | ComponentType<MarkProps> | ReactElement
  /** Draws the icon in the accent, as Donate's is. */
  accentIcon?: boolean
  /**
   * A second line under the label, for a row whose meaning is not obvious from its name. Its line
   * breaks are kept, for an explanation with paragraphs or a list.
   */
  subtitle?: string
  /**
   * An aside after the subtitle, a blank line below it and in the secondary text colour: something
   * worth knowing about the row that is not part of what it does, as Instant's word on communities.
   */
  note?: string | undefined
  /**
   * How the row's settings stand, a line each under the subtitle: one for a setting, or a summary
   * of a screen's settings on the row that opens it, as legacy iOS's developer settings have.
   */
  details?: readonly SettingsRowDetail[] | undefined
  /** A value, a switch, a button. No chevron by default: see `leadsTo`. */
  trailing?: ReactNode
  /**
   * Where pressing the row goes, drawn after anything trailing: `screen`, a chevron, for a row that
   * opens another screen; `outside`, the link-out glyph, for one that leaves the app for a website
   * or the OS's settings. A row that acts where it is has neither.
   */
  leadsTo?: 'screen' | 'outside' | undefined
  /**
   * The trailing control is wide, a labelled button, so at the accessibility text sizes it goes
   * under the text instead of squeezing it. A glyph or a switch stays beside it.
   */
  wideTrailing?: boolean
  /**
   * The trailing text gives way before the label: it shrinks first and truncates, so a long
   * translation of either keeps the row's name whole. For a value that only qualifies the name, as
   * the path's state does.
   */
  trailingYields?: boolean
  /** Tints the label and its icon, for a row that destroys something. */
  destructive?: boolean
  /** Without one the row is static, with nothing to press but its trailing control. */
  onPress?: () => void
  /** For a row whose screen is not built yet. See the component. */
  disabled?: boolean
  testID: string
}

/**
 * One row of a settings list.
 *
 * A row whose screen is not built yet is shown `disabled` rather than hidden, so the list keeps its
 * designed order. `disabled` is explicit because a row with no `onPress` may still have a live
 * trailing control.
 */
export function SettingsRow({
  label,
  icon,
  subtitle,
  note,
  details,
  trailing: given,
  leadsTo,
  wideTrailing = false,
  trailingYields = false,
  accentIcon = false,
  destructive = false,
  onPress,
  disabled = false,
  testID,
}: SettingsRowProps) {
  const inert = disabled || onPress === undefined
  const glyph =
    leadsTo === undefined ? null : leadsTo === 'screen' ? (
      <Icon
        name={forwardChevron()}
        size="md"
        color={disabled ? '$textDisabled' : '$textSecondary'}
      />
    ) : (
      // The accent on dark, body text on light, where the accent is too faint as a glyph.
      <Icon name="externalLink" size="md" color={disabled ? '$textDisabled' : '$accentText'} />
    )
  const trailing =
    glyph === null ? (
      given
    ) : given === undefined ? (
      glyph
    ) : (
      <XStack alignItems="center" gap="$xs">
        {given}
        {glyph}
      </XStack>
    )
  const tone = disabled ? '$textDisabled' : destructive ? '$dangerColor' : '$textPrimary'
  // `accentText`, not the accent: as a glyph the accent is too faint on a light ground.
  const iconTone = accentIcon && !disabled ? '$accentText' : tone
  const content = {
    label,
    icon,
    subtitle,
    note,
    details,
    trailing,
    wideTrailing,
    trailingYields,
    disabled,
    inert,
    tone,
    iconTone,
  }

  // A static row is not a control: as a disabled press area it would be announced as a dimmed
  // button with a live one inside it, and its trailing control counted as disabled with it.
  if (onPress === undefined && !disabled) {
    return (
      <YStack testID={testID}>
        <RowContent {...content} pressed={false} hovered={false} />
      </YStack>
    )
  }
  return (
    <PressArea {...(disabled ? {} : { onPress })} disabled={inert} ring={ROW_RING} testID={testID}>
      {(pressed, hovered) => <RowContent {...content} pressed={pressed} hovered={hovered} />}
    </PressArea>
  )
}

interface RowContentProps {
  label: string
  icon?: SettingsRowProps['icon'] | undefined
  subtitle?: string | undefined
  note?: string | undefined
  details?: readonly SettingsRowDetail[] | undefined
  trailing?: ReactNode | undefined
  wideTrailing: boolean
  trailingYields: boolean
  disabled: boolean
  /** Not pressable, whether static or disabled: no hover, press or pointer. */
  inert: boolean
  pressed: boolean
  /** A pointer over a pressable row, on native: see `PressArea`. */
  hovered: boolean
  tone: string
  iconTone: string
}

/**
 * A hovered or pressed row's ground. A row with a note steps to the next surface rather than take
 * the overlay: secondary text clears AA on every surface but only 3:1 under an overlay.
 */
function stateGround(note: string | undefined, overlay: '$hoverOverlay' | '$pressedOverlay') {
  return note === undefined ? overlay : '$backgroundTertiary'
}

/** What a row draws, pressable or not. */
function RowContent({
  label,
  icon,
  subtitle,
  note,
  details,
  trailing,
  wideTrailing,
  trailingYields,
  disabled,
  inert,
  pressed,
  hovered,
  tone,
  iconTone,
}: RowContentProps) {
  const glyphScale = useGlyphScale()
  const fontScale = useFontScale()
  const stacked = wideTrailing && trailing !== undefined && fontScale >= STACK_TRAILING_FROM_SCALE
  const iconColumn = Math.round(ICON_COLUMN * glyphScale)
  const trailingBox =
    trailing === undefined ? null : stacked ? (
      // Under the text, lined up with it.
      <YStack
        alignItems="flex-start"
        {...logical({ paddingStart: icon === undefined ? 0 : iconColumn + SPACE_SCALE.sm })}
      >
        {trailing}
      </YStack>
    ) : (
      // More room than icon-to-label, so wrapped label text does not run into the control.
      <YStack
        {...logical({ paddingStart: SPACE_SCALE.xs, paddingEnd: SPACE_SCALE['2xs'] })}
        {...(trailingYields
          ? { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, alignItems: 'flex-end' }
          : {})}
      >
        {trailing}
      </YStack>
    )
  return (
    // Its own frame, so the state overlays step from the row's surface rather than the page.
    <YStack backgroundColor="$backgroundSecondary">
      <XStack
        minHeight={ROW_MIN_HEIGHT}
        alignItems="center"
        gap="$sm"
        // The side padding matches the separators' inset, so a line starts where content does.
        // Less vertically because a line's own leading adds to it.
        paddingHorizontal="$md"
        paddingVertical="$sm"
        {...(inert
          ? {}
          : {
              '$platform-web': { cursor: 'pointer' },
              hoverStyle: { backgroundColor: stateGround(note, '$hoverOverlay') },
              pressStyle: { backgroundColor: stateGround(note, '$pressedOverlay') },
              // Native: without this a frame with a `pressStyle` claims the touch from
              // `PressArea` and the row never fires. Pressable rows only: it takes the subtree
              // with it, and on a static row the trailing control is what gets pressed.
              ...PRESS_PASSTHROUGH,
              ...(hovered && !pressed ? { forceStyle: 'hover' as const } : {}),
              ...(pressed ? { backgroundColor: stateGround(note, '$pressedOverlay') } : {}),
            })}
      >
        {icon === undefined ? null : (
          <YStack width={iconColumn} alignItems="center">
            {typeof icon === 'string' ? (
              <Icon name={icon} size={Math.round(ICON_SIZE * glyphScale)} color={iconTone} />
            ) : isValidElement(icon) ? (
              icon
            ) : (
              // A mark fills its box where a lucide glyph has a margin: a rung smaller.
              <Mark mark={icon} color={iconTone} scale={glyphScale} />
            )}
          </YStack>
        )}

        <YStack
          // When the trailing text yields, the label keeps its own width and the trailing text,
          // starting from nothing, takes what is left. Short of room, only the label has width to
          // give up, so it wraps once the trailing text is gone rather than before.
          {...(trailingYields
            ? { flexGrow: 0, flexShrink: 1, flexBasis: 'auto', minWidth: 0 }
            : { flex: 1 })}
          gap="$3xs"
        >
          <Text
            size="$bodyLarge"
            weight="bold"
            color={tone}
            maxFontSizeMultiplier={LABEL_MAX_SCALE}
          >
            {label}
          </Text>
          {subtitle === undefined ? null : (
            // Unmuted. Label size so it reads as the name's
            // explanation rather than as a second line of body text.
            <Text
              size="$label"
              color={disabled ? '$textDisabled' : '$textPrimary'}
              maxFontSizeMultiplier={LABEL_MAX_SCALE}
              whiteSpace="pre-line"
            >
              {subtitle}
              {note === undefined ? null : (
                <Text size="$label" color={disabled ? '$textDisabled' : '$textSecondary'}>
                  {`\n\n${note}`}
                </Text>
              )}
            </Text>
          )}
          {details === undefined || details.length === 0 ? null : (
            // Set apart from the subtitle, as a paragraph would be.
            <YStack paddingTop="$xs">
              {details.map((detail) => (
                <Text
                  key={detail.label}
                  size="$label"
                  color={disabled ? '$textDisabled' : '$textPrimary'}
                  maxFontSizeMultiplier={LABEL_MAX_SCALE}
                >
                  <Text
                    size="$label"
                    weight="bold"
                    color={disabled ? '$textDisabled' : '$textPrimary'}
                  >
                    {detail.label}
                  </Text>{' '}
                  {/* `accentText`, as for a link or an inline emphasis: the accent itself is too
                      faint as text on a light ground. */}
                  <Text
                    size="$label"
                    color={
                      disabled
                        ? '$textDisabled'
                        : detail.inactive === true
                          ? '$textSecondary'
                          : '$accentText'
                    }
                  >
                    {detail.value}
                  </Text>
                </Text>
              ))}
            </YStack>
          )}
        </YStack>

        {stacked ? null : trailingBox}
      </XStack>
      {stacked ? (
        <YStack paddingHorizontal="$md" paddingBottom="$sm">
          {trailingBox}
        </YStack>
      ) : null}
    </YStack>
  )
}

/** The pixel height a mark is drawn at: the icon ladder's `md`, a rung under the glyphs' `lg`. */
const MARK_SIZE = SIZE_SCALE.md

function Mark({
  mark: Drawn,
  color,
  scale,
}: {
  mark: ComponentType<MarkProps>
  color: string
  scale: number
}) {
  return <Drawn size={Math.round(MARK_SIZE * scale)} color={color} />
}

/**
 * A run of rows drawn as one block.
 *
 * Separators are drawn here so a row need not know whether it is last, inset from both edges:
 * a full-width divider reads as two cards.
 */
export function SettingsGroup({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children)
  const separator = useSeparatorHeight()
  return (
    <YStack borderRadius="$md" overflow="hidden" backgroundColor="$backgroundSecondary">
      {rows.map((row, at) => (
        <Fragment key={at}>
          {at === 0 ? null : (
            <YStack height={separator} marginHorizontal="$md" backgroundColor="$separatorColor" />
          )}
          {row}
        </Fragment>
      ))}
    </YStack>
  )
}

/**
 * A line of secondary text in a group, in place of a row that is not there: says why, and does
 * nothing. Shorter than a row, because nothing in it is a tap target.
 */
export function SettingsNote({ text, testID }: { text: string; testID: string }) {
  return (
    <YStack
      backgroundColor="$backgroundSecondary"
      paddingHorizontal="$md"
      paddingVertical="$sm"
      testID={testID}
    >
      <Text size="$label" tone="secondary">
        {text}
      </Text>
    </YStack>
  )
}

/**
 * A heading over a group, with an optional explanation.
 * Use sparingly; over rows whose names already say what they are it is noise.
 */
export function SettingsSection({ label, description }: { label: string; description?: string }) {
  return (
    <YStack gap="$3xs" paddingBottom="$xs" {...logical({ paddingStart: SPACE_SCALE.xs })}>
      <Text size="$body" tone="secondary" maxFontSizeMultiplier={LABEL_MAX_SCALE}>
        {label}
      </Text>
      {description === undefined ? null : (
        <Text size="$caption" tone="secondary">
          {description}
        </Text>
      )}
    </YStack>
  )
}
