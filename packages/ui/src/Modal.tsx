import type { ReactNode } from 'react'
import { Modal as NativeModal, ScrollView } from 'react-native'
import { useTheme, XStack, YStack } from 'tamagui'

import { useBackdropBlur } from './backdropBlur'
import { useThemeIsDark } from './UIProvider'
import { Button } from './Button'
import { LABEL_MAX_SCALE } from './fontScaleCaps'
import { Icon } from './Icon'
import { Text } from './Text'
import { logical } from './logicalEdges'
import { ACTION_HEIGHT } from './modalPanelMetrics'
import { RADIUS_SCALE, SPACE_SCALE } from './scales'
import { useScreenInsets } from './screenInsets'
import { ALERT_BORDER, alertShadow } from './alertEdge'

interface ModalProps {
  open: boolean
  onClose: () => void
  /** Centred, bold, with the close control beside it. */
  title: string
  /** Names the close control for a screen reader, since it is drawn as a cross. */
  closeLabel: string
  /**
   * Whether the cross in the corner is drawn.
   *
   * On for a dialog that shows something, where closing is the only thing to do with it. **Off for
   * one that asks a question**: a cross is a third answer next to the two in the actions row, and
   * an unlabelled one -- somebody deciding whether to leave the app wants to read the word Cancel,
   * not infer it from a glyph. Such a dialog puts its own cancel in `actions`.
   */
  showClose?: boolean
  /**
   * Whether a press outside, Escape, or the Android back button closes it.
   *
   * Defaults to whatever `showClose` is, because the two say the same thing: a dialog offering
   * a cross is one you may simply leave. **A dialog asking a question is not**, and leaving these
   * on while the cross was hidden put back the third, unlabelled answer the cross was removed to
   * avoid -- reachable by a stray tap on the scrim, and reachable while the destructive action
   * it was confirming was already running.
   */
  dismissible?: boolean
  children: ReactNode
  /** The row of actions along the bottom. Text buttons, in the client's shape. */
  actions?: ReactNode
  testID: string
  closeTestID: string
  /**
   * How far the content sits from the dialog's sides and its bottom edge.
   *
   * **The client has more than one dialog and they do not share these.** `Modal.swift` is the
   * alert -- 35 across, and 4 under a final child that is a full-width row of buttons reaching the
   * rounded corners. `MutipleLinksModal` is its own screen with its own rhythm: narrower sides, and
   * room under a box that is not trying to touch anything. Defaulting to the alert's keeps every
   * caller that wants one honest, and the other says so.
   */
  sideInset?: number
  bottomInset?: number
}

const RADIUS = RADIUS_SCALE.md
const SIDE_INSET = SPACE_SCALE['2xl']
const TOP_INSET = SPACE_SCALE.xl
const BOTTOM_INSET = SPACE_SCALE['2xs']
const CONTENT_GAP = SPACE_SCALE.xs

/**
 * The extra air above the actions, on top of the body's own rhythm.
 *
 * The row is a different kind of thing from the lines above it -- it runs the full width and is
 * held down at the dialog's edge -- and at the body's gap it read as another line of the copy.
 */
const ACTIONS_GAP = SPACE_SCALE.md

/**
 * How far the close's **touch target** sits from the dialog's own corner.
 *
 * It belongs to the dialog rather than to the column of text, so it is pulled back out of the
 * content inset. Small because the target is much bigger than the glyph -- what the eye measures
 * is the cross, which ends up about ten points in from each edge.
 */
const CLOSE_INSET = SPACE_SCALE['3xs']

/** How far an alert stays from the edges of the area the hardware leaves free. */
const FRAME_MARGIN = SPACE_SCALE.xl

/** The body scrolls between the fixed title and actions; only the body's own gaps go inside it. */
const BODY_GAP = { gap: CONTENT_GAP } as const

/**
 * Shrinks to fit rather than growing to fill, so a short body leaves the box its natural height.
 */
const BODY_SCROLL = { flexGrow: 0, flexShrink: 1 } as const

/**
 * Where an alert sits: centred, clear of the notch, the home indicator and the rounded corners,
 * with a margin of its own inside them.
 *
 * The box is capped at this frame's height, so the frame has to stop at the hardware's edges: a
 * frame that ran under them let a long dialog put its title and close control under the notch.
 */
export function AlertFrame({
  children,
  pointerEvents,
}: {
  children: ReactNode
  pointerEvents: 'box-none' | 'none'
}) {
  const insets = useScreenInsets()
  return (
    <YStack
      fullscreen
      alignItems="center"
      justifyContent="center"
      paddingTop={insets.top + FRAME_MARGIN}
      paddingBottom={insets.bottom + FRAME_MARGIN}
      paddingLeft={insets.left + FRAME_MARGIN}
      paddingRight={insets.right + FRAME_MARGIN}
      pointerEvents={pointerEvents}
    >
      {children}
    </YStack>
  )
}

/**
 * Something asked over the top of the page.
 *
 * Drawn in react-native's `Modal` rather than an absolutely-positioned panel, for the same reason
 * the language picker is: a child that overflows its parent is clipped on Android.
 *
 * **Dimmed behind, unlike the picker.** A dropdown belongs to the control that opened it; this
 * stops the page until it is answered, and the dimming says so.
 *
 * The shape is the desktop client's `SessionWrapperModal`: a header with the title and the exit
 * cross, the body, then a row of **text** buttons. Text rather than filled, because a filled button
 * reads as the safe default by looking like a primary action -- and here the emphasised option is
 * usually the one to think twice about.
 */
export function Modal({
  open,
  onClose,
  title,
  closeLabel,
  children,
  actions,
  showClose = true,
  dismissible = showClose,
  testID,
  closeTestID,
  sideInset = SIDE_INSET,
  bottomInset = BOTTOM_INSET,
}: ModalProps) {
  /**
   * **iOS blurs what is behind a dialog; Android and the desktop client only darken it.** Null on
   * both of those, and the scrim below is then the whole backdrop.
   */
  const Blur = useBackdropBlur()
  const dark = useThemeIsDark()

  // Named once: the same answer has to reach the scrim, Escape and the hardware back button, or
  // the dialog is dismissible by whichever of them was forgotten.
  const dismiss = dismissible ? onClose : undefined

  return (
    <NativeModal visible={open} transparent animationType="fade" onRequestClose={dismiss}>
      {Blur === null ? null : (
        <YStack fullscreen>
          <Blur dark={dark} />
        </YStack>
      )}
      {/* No scrim over a blur: a dim would hide what the blur shows. */}
      {Blur !== null ? null : <YStack fullscreen backgroundColor="$scrim" />}
      {/* Presses outside land here rather than on a pressable container, which would stop the
          body scrolling. See `ModalStackHost`'s backdrop. */}
      <YStack fullscreen {...(dismiss === undefined ? {} : { onPress: dismiss })} />
      <AlertFrame pointerEvents="box-none">
        <AlertBox
          title={title}
          closeLabel={closeLabel}
          showClose={showClose}
          onClose={onClose}
          actions={actions}
          testID={testID}
          closeTestID={closeTestID}
          sideInset={sideInset}
          bottomInset={bottomInset}
        >
          {children}
        </AlertBox>
      </AlertFrame>
    </NativeModal>
  )
}

interface AlertBoxProps {
  title: string
  closeLabel: string
  showClose: boolean
  onClose: () => void
  children: ReactNode
  actions?: ReactNode
  testID: string
  closeTestID: string
  sideInset?: number
  bottomInset?: number
}

/**
 * The dialog without its window, so `Modal` and the modal stack draw the same alert.
 *
 * **No taller than its frame, whatever the text size.** The title row and the actions stay put and
 * the body scrolls between them: at the largest sizes a body that pushes the box past the screen
 * takes the close control and the buttons with it, leaving nothing to answer the dialog with.
 */
export function AlertBox({
  title,
  closeLabel,
  showClose,
  onClose,
  children,
  actions,
  testID,
  closeTestID,
  sideInset = SIDE_INSET,
  bottomInset = BOTTOM_INSET,
}: AlertBoxProps) {
  const theme = useTheme()
  return (
    <YStack
      width="100%"
      maxWidth={360}
      maxHeight="100%"
      gap={CONTENT_GAP}
      paddingTop={TOP_INSET}
      paddingHorizontal={sideInset}
      paddingBottom={bottomInset}
      borderRadius={RADIUS}
      // The surface above the page.
      backgroundColor="$backgroundSecondary"
      // Its edge against a dimmed page is the same surface over another. See `alertEdge.ts`.
      {...ALERT_BORDER}
      boxShadow={alertShadow(String(theme.shadow?.val ?? ''))}
      testID={testID}
    >
      <XStack alignItems="flex-start" gap="$xs">
        {/* Centred across the full width, with the cross overlaid rather than taking a column,
            so the title is centred on the dialog and not on what is left of it. */}
        <Text
          flex={1}
          size="$bodyLarge"
          weight="bold"
          textAlign="center"
          userSelect="none"
          maxFontSizeMultiplier={LABEL_MAX_SCALE}
        >
          {title}
        </Text>
        {!showClose ? null : (
          <YStack
            position="absolute"
            top={-(TOP_INSET - CLOSE_INSET)}
            // The trailing corner, which is the right one only until the layout is mirrored.
            {...logical({ insetEnd: -(sideInset - CLOSE_INSET) })}
          >
            <Button
              variant="ghost"
              // Sized for the touch target: an `xs` button is a 24pt square to hit.
              size="md"
              circular
              accessibilityLabel={closeLabel}
              testID={closeTestID}
              onPress={onClose}
              icon={<Icon name="x" size="lg" color="$textPrimary" />}
            />
          </YStack>
        )}
      </XStack>

      <ScrollView style={BODY_SCROLL} contentContainerStyle={BODY_GAP} alwaysBounceVertical={false}>
        {children}
      </ScrollView>

      {actions === undefined ? null : (
        /* Full width, no gap, equal shares. Clipped so a held cell's fill stops
           at the rounded bottom corners. */
        <XStack
          alignItems="stretch"
          marginTop={ACTIONS_GAP}
          marginHorizontal={-sideInset}
          marginBottom={-bottomInset}
          height={ACTION_HEIGHT}
          borderBottomLeftRadius={RADIUS}
          borderBottomRightRadius={RADIUS}
          overflow="hidden"
        >
          {/* The actions take their equal share themselves with `fill`: a fragment of them
              arrives here as one child and cannot be divided from outside. */}
          {actions}
        </XStack>
      )}
    </YStack>
  )
}
