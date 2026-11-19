import { FONT_SIZE, LINE_HEIGHT_RATIO } from '@session/theme-tokens'
import type { ReactNode } from 'react'
import { isWeb, Spinner, XStack, YStack } from 'tamagui'

import type { ElementId } from '@session/test-ids'

import { FileName } from './FileName'
import type { inkFor } from './ink'
import { PressArea } from './PressArea'
import { PRESS_PASSTHROUGH } from './pressPassthrough'
import {
  quoteAccessibleName,
  quotePreview,
  type QuoteInk,
  type QuoteLabels,
  type QuotePreview,
  type QuotedMessage,
} from './quotePreview'
import { QuoteThumb } from './QuoteThumb'
import { StateLayer } from './StateLayer'
import { Text } from './Text'
import type { WithTestID } from './with'

/**
 * The quote's metrics, measured off the plan's mock rather than taken from the ladder: the
 * square is the 44 pt target on its own, so the quote is never shorter than one.
 */
const QUOTE_THUMB_SIDE_PX = 44
/** Legacy iOS's accent line: square-ended, so it reads as a rule rather than a pill. */
const STRIPE_WIDTH_PX = 4
/** How far a text quote's stripe runs past the author and summary, above and below. */
export const STRIPE_OVERHANG_PX = 2
const QUOTE_INSET_PX = 6
/** From the tint's edge to the text: the stripe's overhang comes out of it. */
const QUOTE_TEXT_INSET_BLOCK_PX = 8

/** The author's line: a text quote's busy spinner is held to it, so the quote keeps its height. */
const HEADING_LINE_PX = FONT_SIZE.label * LINE_HEIGHT_RATIO
/** Shrinks the 20 px small spinner to the author's line. */
const HEADING_SPINNER_SCALE = 0.7

/** How far a quote tints its bubble towards the bubble's ink, which works in either polarity. */
const QUOTE_TINT_OPACITY = { incoming: 0.07, outgoing: 0.1 } as const

/**
 * The stripe or the square, then the author and the summary: what the bar draws too. A quote of
 * an attachment leads with its square and no stripe, as legacy iOS draws it.
 */
export function QuoteLines({
  heading,
  preview,
  ink,
  secondary,
  stripe,
  summaryLines,
  thumb,
  busy = false,
}: {
  /** The author, or the bar's "Replying to" with the author. */
  heading: string
  preview: QuotePreview
  ink: QuoteInk
  secondary: { color: QuoteInk | ReturnType<typeof inkFor>['color']; opacity: number }
  stripe: '$onAccent' | '$primaryColor'
  /** The quote wraps a body to two lines; the composer's bar holds every summary to one. */
  summaryLines: 1 | 2
  /** The picture or glyph, in the stripe's place, for a quote of an attachment. */
  thumb: ReactNode
  /**
   * A spinner after the author, for a quote with no square to turn into one: beside the summary
   * it would narrow the summary and could wrap it to a second line.
   */
  busy?: boolean | undefined
}) {
  const author = (
    <Text size="$label" weight="semibold" color={ink} numberOfLines={1} flexShrink={1}>
      {heading}
    </Text>
  )
  return (
    <>
      {preview.visual === null ? <YStack width={STRIPE_WIDTH_PX} backgroundColor={stripe} /> : null}
      {thumb}
      {/* Yoga sizes a bubble from its children's bases: a zero one gives the text no width. */}
      <YStack
        flexGrow={1}
        flexShrink={1}
        flexBasis="auto"
        minWidth={0}
        justifyContent="center"
        gap="$2xs"
        paddingVertical={STRIPE_OVERHANG_PX}
      >
        {busy ? (
          <XStack minWidth={0} alignItems="center" gap="$2xs">
            {author}
            <YStack
              height={HEADING_LINE_PX}
              justifyContent="center"
              scale={HEADING_SPINNER_SCALE}
              aria-hidden
            >
              <Spinner size="small" color={ink} />
            </YStack>
          </XStack>
        ) : (
          author
        )}
        {preview.isFileName ? (
          <XStack minWidth={0} gap="$2xs">
            {/* A column, which gives the name a width to lose its middle from. */}
            <YStack flexShrink={1} minWidth={0}>
              <FileName name={preview.text} size="$label" weight="regular" ink={secondary} />
            </YStack>
            {preview.more === null ? null : (
              <Text size="$label" {...secondary} flexShrink={0}>
                {preview.more}
              </Text>
            )}
          </XStack>
        ) : (
          <Text size="$label" {...secondary} numberOfLines={Math.min(preview.lines, summaryLines)}>
            {preview.text}
          </Text>
        )}
      </YStack>
    </>
  )
}

export type MessageQuoteProps = WithTestID & {
  /**
   * Already worded: the nickname, display name or short account id, or "You". A reply carries its
   * original's author, so it is known even when the original never arrived.
   */
  author: string
  /** Absent or deleted: the original is not here, and the quote says only that. */
  message: QuotedMessage | undefined
  labels: QuoteLabels
  /** Drawn on a bubble you sent. */
  onAccent: boolean
  /**
   * Jumps to the original. Absent, the quote is no button. A quote of one not found is no button
   * either, but a pointer or a tap still calls this, for the toast that says so.
   */
  onPress?: (() => void) | undefined
  /** Already worded, for what a press does, after the name. */
  hint?: string | undefined
  /** The original is being read in. */
  busy?: boolean | undefined
  /** Addresses the picture in the square, so a test can ask whether it arrived. */
  thumbnailTestID?: ElementId | undefined
}

function QuoteBody({
  author,
  preview,
  onAccent,
  busy,
  pressable,
  pressed = false,
  thumbnailTestID,
}: {
  author: string
  preview: QuotePreview
  onAccent: boolean
  busy: boolean
  pressable: boolean
  /** Reported by the native `PressArea`, whose frame cannot see its own press. */
  pressed?: boolean | undefined
  thumbnailTestID: ElementId | undefined
}): ReactNode {
  const ink = onAccent ? '$onAccent' : '$messageBubbleIncomingText'
  return (
    <XStack
      {...(pressable ? { group: 'quote' as const, ...PRESS_PASSTHROUGH } : {})}
      position="relative"
      minHeight={QUOTE_THUMB_SIDE_PX}
      paddingHorizontal={QUOTE_INSET_PX}
      paddingVertical={QUOTE_TEXT_INSET_BLOCK_PX - STRIPE_OVERHANG_PX}
      gap="$xs"
      borderRadius="$sm"
      overflow="hidden"
      {...(pressable ? { '$platform-web': { cursor: 'pointer' as const } } : {})}
    >
      <YStack
        position="absolute"
        top={0}
        bottom={0}
        left={0}
        right={0}
        backgroundColor={ink}
        opacity={onAccent ? QUOTE_TINT_OPACITY.outgoing : QUOTE_TINT_OPACITY.incoming}
      />
      {pressable ? (
        <StateLayer group="quote" tone="ink" borderRadius="$sm" pressed={pressed} />
      ) : null}
      <QuoteLines
        heading={author}
        preview={preview}
        ink={ink}
        // Undimmed: the tint and the hover layer already spend the margin a dimmed ink relies on.
        secondary={{ color: ink, opacity: 1 }}
        stripe={onAccent ? '$onAccent' : '$primaryColor'}
        summaryLines={2}
        busy={busy && preview.visual === null}
        thumb={
          <QuoteThumb
            visual={preview.visual}
            sidePx={QUOTE_THUMB_SIDE_PX}
            ink={ink}
            busy={busy && preview.visual !== null}
            testID={thumbnailTestID}
          />
        }
      />
    </XStack>
  )
}

/**
 * The message a reply quotes, heading the reply's bubble inside its padding on a tint of its
 * own: one press target that jumps to the original, named "{author}: {summary}" for a screen
 * reader, the picture's words included. One whose original was deleted or never received says
 * "Original message not found" under its author, with nothing else.
 */
export function MessageQuote({
  author,
  message,
  labels,
  onAccent,
  onPress,
  hint,
  busy = false,
  thumbnailTestID,
  testID,
}: MessageQuoteProps) {
  const preview = quotePreview(message, labels)
  const name = quoteAccessibleName(author, preview)
  const shared = { author, preview, onAccent, busy: busy && preview.found, thumbnailTestID }

  if (!preview.found || onPress === undefined)
    return (
      // The web reads the words where they stand; native would stop on author and summary apart.
      <YStack
        {...(onPress === undefined ? {} : { onPress })}
        {...(isWeb ? {} : { accessible: true, 'aria-label': name })}
        testID={testID}
      >
        <QuoteBody {...shared} pressable={false} />
      </YStack>
    )

  return (
    <PressArea
      onPress={onPress}
      accessibilityLabel={name}
      accessibilityHint={hint}
      busy={busy}
      ring={{ onAccent, offset: 2, radius: '$sm' }}
      {...(testID === undefined ? {} : { testID })}
    >
      {(pressed) => <QuoteBody {...shared} pressable pressed={pressed} />}
    </PressArea>
  )
}
