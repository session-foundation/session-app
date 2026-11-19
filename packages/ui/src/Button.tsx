import { INTERACTION_OPACITY } from '@session/theme-tokens'
import type { ComponentProps, ReactNode } from 'react'
import { isWeb, Spinner, styled, XStack, YStack } from 'tamagui'

import { INHERITED_LABEL } from './labelColor'
import { MIN_HIT_TARGET, buttonHeight } from './buttonHitTarget'
import type { FocusRingShape } from './keyboardPress'
import { PRESS_PASSTHROUGH } from './pressPassthrough'
import { PressArea } from './PressArea'
import { touchReach } from './touchReach'
import { Concealed } from './Concealed'
import { Text } from './Text'
import { LABEL_MAX_SCALE } from './fontScaleCaps'

/**
 * What each variant looks like while it is held down: the web's `pressStyle`, and on native the
 * frame's style while `PressArea` reports a press (see `PRESSED`). One table, so the two can only
 * agree.
 *
 * Hover has no such table because native needs no copy of it: while `PressArea` reports a pointer
 * over the button, the frame is given `forceStyle="hover"`, and tamagui applies the variant's own
 * `hoverStyle`. So each `hoverStyle` is written once, in its variant.
 */
const PRESS_STYLE = {
  solid: {
    backgroundColor: '$accentPressed',
    borderColor: '$accentPressed',
    color: '$onAccent',
  },
  outline: {
    backgroundColor: '$textPrimary',
    borderColor: '$textPrimary',
    color: '$backgroundPrimary',
    opacity: INTERACTION_OPACITY.filledPressed,
  },
  outlineAccent: {
    backgroundColor: '$primaryColor',
    borderColor: '$primaryColor',
    color: '$onAccent',
    opacity: INTERACTION_OPACITY.filledPressed,
  },
  ghost: { backgroundColor: '$pressedOverlay' },
  ghostAccent: { backgroundColor: '$pressedOverlay' },
  simple: { opacity: INTERACTION_OPACITY.dimPressed },
  subtle: { color: '$textPrimary', opacity: INTERACTION_OPACITY.brightenedPressed },
  tonal: { opacity: 0.7 },
  danger: {
    backgroundColor: '$dangerColor',
    borderColor: '$dangerColor',
    color: '$onDanger',
    opacity: INTERACTION_OPACITY.filledPressed,
  },
} as const

const Frame = styled(XStack, {
  name: 'Button',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '$xs',
  borderRadius: '$full',
  borderWidth: 1,
  '$platform-web': { cursor: 'pointer' },
  // A label is not text you select; dragging across a control should do nothing. The desktop
  // client sets the same thing on its button for the same reason.
  userSelect: 'none',

  variants: {
    /**
     * Every state here is the table in `docs/THEMING.md` and the derivation page, which is the
     * spec this is meant to implement: four variants against default, hover, pressed and disabled.
     * It had drifted -- outline hovered onto a surface where the table inverts it, and disabled was
     * a flat opacity where the table names roles -- which is the kind of drift nobody sees until
     * the two are put side by side.
     */
    variant: {
      solid: {
        backgroundColor: '$primaryColor',
        borderColor: '$primaryColor',
        color: '$onAccent',
        hoverStyle: {
          backgroundColor: '$accentHover',
          borderColor: '$accentHover',
          color: '$onAccent',
        },
        pressStyle: PRESS_STYLE.solid,
      },
      /**
       * Hover **inverts** rather than tinting: the outline fills with the text colour and the label
       * takes the page. An outline control on white has no headroom to brighten into, so a surface
       * step is nearly invisible there -- inverting works in both polarities.
       */
      outline: {
        backgroundColor: 'transparent',
        borderColor: '$textPrimary',
        color: '$textPrimary',
        // The label colour moves with the fill, declared here rather than tracked in JS so the two
        // can never disagree. See labelColor.ts.
        hoverStyle: {
          backgroundColor: '$textPrimary',
          borderColor: '$textPrimary',
          color: '$backgroundPrimary',
        },
        pressStyle: PRESS_STYLE.outline,
      },
      /**
       * The outline, in the accent rather than in the text colour.
       *
       * What the legacy client draws beside its filled primary button on the landing screen --
       * stroke *and* label in the primary colour, so the pair reads as one accented group with one
       * of them filled. Outlined in the text colour instead, the quieter half reads as a secondary
       * action of a different family rather than as the other half of a pair.
       *
       * At rest, stroke and label are `accentText`: the accent where it reads on the page, and the
       * text colour where it does not, which is a light theme's page for Session's green (about
       * 1.5:1). The fill it takes when hovered or held is the accent itself, under `onAccent`.
       */
      outlineAccent: {
        backgroundColor: 'transparent',
        borderColor: '$accentText',
        color: '$accentText',
        hoverStyle: {
          backgroundColor: '$primaryColor',
          borderColor: '$primaryColor',
          color: '$onAccent',
        },
        pressStyle: PRESS_STYLE.outlineAccent,
      },
      /** Overlays rather than surfaces, so the step shows on any ground, even a hovered row. */
      ghost: {
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        color: '$textPrimary',
        hoverStyle: { backgroundColor: '$hoverOverlay' },
        pressStyle: PRESS_STYLE.ghost,
      },
      /**
       * `ghost`, in the accent.
       *
       * For a bare label that is the only thing to do on the screen it is on -- the clients' camera
       * permission prompt is the one this was added for, and they draw it as text in the primary
       * colour with nothing around it. An outlined control would read as a form's action, which is
       * not what a single offer in the middle of an empty pane is.
       */
      ghostAccent: {
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        // `accentText`, for the same reason as `outlineAccent`'s label.
        color: '$accentText',
        hoverStyle: { backgroundColor: '$hoverOverlay' },
        pressStyle: PRESS_STYLE.ghostAccent,
      },
      /**
       * Text on its own, no frame -- what the desktop client calls Simple and uses for every modal
       * action. Its hover dims the label rather than lighting a surface, because there is no
       * surface to light.
       */
      simple: {
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        color: '$textPrimary',
        hoverStyle: { opacity: INTERACTION_OPACITY.dimHover },
        pressStyle: PRESS_STYLE.simple,
      },
      /**
       * A quiet label in the secondary text colour, for an action that defers to the one beside
       * it. It brightens to the primary colour under a pointer rather than fading as `simple`
       * does: faded, the secondary colour falls below the contrast floor in a light theme.
       */
      subtle: {
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        color: '$textSecondary',
        hoverStyle: { color: '$textPrimary' },
        pressStyle: PRESS_STYLE.subtle,
      },
      /**
       * A quiet fill: the nested surface under a plain label, in a rounded rect rather than a pill.
       *
       * Legacy iOS's non-primary rounded rect, for a control among content -- an attachment's
       * Download -- where a bare label does not read as something to press and an outline is louder
       * than what it sits in. The nested surface steps off both message bubbles in every theme.
       */
      tonal: {
        backgroundColor: '$backgroundNested',
        borderColor: '$backgroundNested',
        borderRadius: '$sm',
        color: '$textPrimary',
        hoverStyle: { opacity: 0.8 },
        pressStyle: PRESS_STYLE.tonal,
      },
      /** Danger text on a transparent ground, filling on hover. The table's destructive row. */
      danger: {
        backgroundColor: 'transparent',
        borderColor: '$dangerColor',
        color: '$dangerColor',
        hoverStyle: {
          backgroundColor: '$dangerColor',
          borderColor: '$dangerColor',
          color: '$onDanger',
        },
        pressStyle: PRESS_STYLE.danger,
      },
    },
    size: {
      // `xs` is for an icon on its own, where the ladder's next rung up is bigger than any glyph
      // needs. It is not a smaller text button: there is no padding on it worth speaking of.
      xs: { height: '$lg', paddingHorizontal: '$xs' },
      sm: { height: '$xl', paddingHorizontal: '$md' },
      md: { height: '$2xl', paddingHorizontal: '$lg' },
      lg: { height: '$3xl', paddingHorizontal: '$xl' },
    },
    /**
     * Square, so the full radius draws a circle rather than a pill.
     *
     * Applied after `size` so the padding it clears is that variant's -- tamagui merges variants in
     * declaration order, and a circle with a pill's padding is neither.
     */
    circular: {
      // The width follows the height rather than naming a token of its own, so a circular button
      // stays circular at whichever size it is given.
      true: { aspectRatio: 1, paddingHorizontal: '$none' },
    },
    /**
     * A danger-coloured label without a fill, declared on the frame so the web label inherits it.
     *
     * Every destructive action in a modal is drawn this way in the desktop client -- red text
     * beside plain text, no fill on either. Applied after `variant` so it overrides that variant's
     * colour, which is the whole point of it.
     */
    destructive: {
      true: {
        color: '$dangerColor',
        // **Colour only, in every state.** What a press does to the surface is the variant's
        // business -- `ghost` lights a background, `simple` dims itself -- and this only has to
        // stop that variant's own colour winning. An opacity here is inherited by the subtree, so
        // it fades the label along with the fill.
        hoverStyle: { color: '$dangerColor' },
        pressStyle: { color: '$dangerColor' },
      },
    },
    /**
     * Named roles rather than an opacity, which is what the table says and what a theme can act on.
     * A blanket `opacity: .5` dims a disabled control toward whatever is behind it, so on a
     * recessed surface it fades further than on the page -- and it takes the border with it.
     */
    disabled: {
      true: {
        pointerEvents: 'none',
        backgroundColor: 'transparent',
        borderColor: '$bordersColor',
        color: '$textDisabled',
      },
    },
  } as const,

  defaultVariants: { variant: 'solid', size: 'md' },
})

/** A press style without its label colour, which native hands to the label instead. */
function withoutColor<T extends object>(style: T): Omit<T, 'color'> {
  const { color: _color, ...rest } = style as T & { color?: unknown }
  return rest
}

/**
 * The frame's style while `PressArea` reports a press, on native.
 *
 * **Native cannot use `pressStyle`**: the frame no longer owns the press -- `PressArea` does, so
 * that a finger sliding off the control clears the highlight the way the platform does -- and
 * tamagui only applies `pressStyle` for presses it handled itself. So the same table is applied
 * by hand, less the colour: a native label inherits nothing from its frame, and `PRESSED_LABEL`
 * colours it. On the web nothing reads this; the pseudo-class still does the work.
 */
const PRESSED = {
  solid: withoutColor(PRESS_STYLE.solid),
  outline: withoutColor(PRESS_STYLE.outline),
  outlineAccent: withoutColor(PRESS_STYLE.outlineAccent),
  ghost: PRESS_STYLE.ghost,
  ghostAccent: PRESS_STYLE.ghostAccent,
  simple: PRESS_STYLE.simple,
  subtle: PRESS_STYLE.subtle,
  tonal: PRESS_STYLE.tonal,
  danger: withoutColor(PRESS_STYLE.danger),
} as const

/**
 * The variants that replace the ground under the label when held, rather than tinting it.
 *
 * They are the ones whose pressed label colour exists for contrast against a new fill, so it has
 * to win over anything else. Everything else only shades the surface behind the label, and the
 * label's own meaning survives -- see `destructive` below.
 */
const INVERTS_ON_PRESS = new Set(['solid', 'outline', 'outlineAccent', 'danger'])

/**
 * Label colour follows the variant.
 *
 * A filled button's label sits on the fill, not on the page, so it takes the fill's own on-colour
 * rather than the body text. The body text is white in the dark themes, and white on the accent
 * green measures about 1.6:1.
 */
const LABEL_TONE = {
  solid: '$onAccent',
  outline: '$textPrimary',
  outlineAccent: '$accentText',
  ghost: '$textPrimary',
  ghostAccent: '$accentText',
  simple: '$textPrimary',
  subtle: '$textSecondary',
  tonal: '$textPrimary',
  danger: '$dangerColor',
} as const

/**
 * The label colour while held, for the variants that replace the ground under it.
 *
 * Native only: a `Text` inherits nothing from a `View`, so `color` inside `pressStyle` reaches the
 * frame alone. The web label inherits instead -- see labelColor.ts. A variant that only moves the
 * surface behind the label needs no entry, since the resting colour reads against both.
 */
const PRESSED_LABEL: Partial<Record<keyof typeof LABEL_TONE, string>> = {
  solid: '$onAccent',
  outline: '$backgroundPrimary',
  outlineAccent: '$onAccent',
  danger: '$onDanger',
  subtle: '$textPrimary',
}

/** On the web the `PressArea` round the frame is the button; a second role inside it is noise. */
const FRAME_ROLE = isWeb ? {} : ({ role: 'button' } as const)

/** Outside the frame, so the ring reads against a fill in the ring's own colour. */
const RING_OFFSET = 2

/** A cell shares its edges with what holds it, which would clip a ring drawn outside it. */
const CELL_RING_OFFSET = -2

export interface ButtonProps {
  children?: ReactNode
  onPress?: () => void
  variant?: keyof typeof LABEL_TONE
  size?: 'xs' | 'sm' | 'md' | 'lg'
  /**
   * For an icon on its own: equal width and height, so a full radius draws a circle and `tonal`'s
   * rounded rect a rounded square.
   */
  circular?: boolean
  /** Takes an equal share of the row it is in. What a dialog's actions do. */
  fill?: boolean
  /** See `PressAreaProps.focusOnMount`. */
  focusOnMount?: boolean | undefined
  /**
   * Overrides the size variant's horizontal padding.
   *
   * For a control whose content is already the right width -- a flag and a chevron, say -- where
   * the variant's padding is what makes it look further from its neighbours than it is.
   */
  paddingHorizontal?: number
  /**
   * Overrides the size variant's corner radius.
   *
   * For a control that is a **cell** rather than a control -- a dialog's actions run the full
   * width of the dialog and share an edge, so a pill-shaped pressed highlight sits inside a
   * rectangular cell with a gap all round it, which reads as the highlight having missed.
   *
   * A token rather than a number, so a caller outside this package can name a rung without
   * importing the scale -- which `screens` is not allowed to do.
   */
  borderRadius?: ComponentProps<typeof Frame>['borderRadius']
  /**
   * The size of the control's box on a phone, with the button drawn at its own size in the middle:
   * the box takes the touch, and a screen reader and an accessibility audit read it as the
   * control's size. Given back as margin, so nothing round it moves. Ignored on the web, where a
   * pointer needs no more.
   */
  touchTarget?: number | undefined
  /**
   * Colour the label danger without filling the button.
   *
   * Every destructive action in a modal is drawn this way in the desktop client -- red text beside
   * plain text, no fill on either. A filled red button in a dialog reads as the safe default
   * because it is the one that looks like a primary action.
   */
  destructive?: boolean
  /**
   * Drawn on an accent fill, a bubble you sent. Only the web focus ring reads it, since the
   * ring falls on the fill round the button.
   */
  onAccent?: boolean | undefined
  disabled?: boolean
  loading?: boolean
  icon?: ReactNode
  /**
   * What a screen reader announces. Needed whenever the button is drawn as an icon alone: the
   * glyph carries the meaning for everyone who can see it and nothing at all for anyone who
   * cannot.
   *
   * Passed down as `aria-label`, which is the name tamagui takes on both platforms - it maps it
   * to `accessibilityLabel` itself on native. Spelling it the react-native way here reached the
   * DOM as nothing whatsoever, which an icon-only button cannot afford.
   */
  accessibilityLabel?: string
  testID?: string
}

/**
 * Each size's height, as a floor for a text button: at a large system text size the label outgrows
 * it, and a fixed height cuts the label's second line or the bottom of its first. A circular
 * button keeps the variant's fixed height, since its width is taken from it.
 */
const SIZE_MIN_HEIGHT = { xs: '$lg', sm: '$xl', md: '$2xl', lg: '$3xl' } as const

/**
 * The variants with no frame: text alone, or a surface only while hovered or held.
 *
 * Disabled keeps them frameless. The `disabled` variant draws the border role, which is the
 * disabled look of a framed button, and on one of these it put an outline round a loading label.
 */
const FRAMELESS = new Set(['ghost', 'ghostAccent', 'simple', 'subtle'])

/**
 * The loading spinner's scale, following the label's text size: the platform's small spinner is
 * sized for a body label, and over the smaller sizes' label it reads a size too large.
 */
const SPINNER_SCALE = { xs: 0.8, sm: 0.8, md: 1, lg: 1 } as const

export function Button({
  children,
  onPress,
  variant = 'solid',
  size = 'md',
  disabled = false,
  loading = false,
  circular = false,
  destructive = false,
  fill = false,
  focusOnMount = false,
  paddingHorizontal,
  borderRadius,
  touchTarget = 0,
  onAccent = false,
  icon,
  accessibilityLabel,
  testID,
}: ButtonProps) {
  /**
   * The label's colour where it cannot be inherited.
   *
   * On the web this is unused -- `INHERITED_LABEL` is `'inherit'` and the frame's variant supplies
   * every state. On native the frame's `color` reaches nothing, so the label is told; there is no
   * hover on a touch screen, so a resting colour is the whole story.
   */
  const nativeLabel =
    disabled || loading ? '$textDisabled' : destructive ? '$dangerColor' : LABEL_TONE[variant]

  /**
   * The label while held.
   *
   * **`destructive` survives the press** on any variant that merely tints the surface behind the
   * label: a red action that turns white the moment somebody commits to it says it has stopped
   * being the dangerous one. Only the variants that put a new fill under the label override it,
   * because their pressed colour exists for contrast against that fill.
   *
   * The web half already behaves: `destructive` is applied to the frame after `variant`, and its
   * own `pressStyle` keeps the colour. This is the native label, which is told rather than
   * inheriting.
   */
  const pressedLabel =
    destructive && !INVERTS_ON_PRESS.has(variant) ? '$dangerColor' : PRESSED_LABEL[variant]

  const inert = disabled || loading
  const reach = touchReach(buttonHeight(size), touchTarget)
  /**
   * The name a screen reader gives the button. While loading the label is hidden, and Android
   * drops a fully transparent child from the accessibility tree, so the label's text is passed
   * as the button's own name -- which every platform announces whatever the child's opacity.
   */
  const name =
    accessibilityLabel ?? (loading && typeof children === 'string' ? children : undefined)

  const ring: FocusRingShape =
    borderRadius === undefined
      ? { onAccent, offset: RING_OFFSET, radius: variant === 'tonal' ? '$sm' : '$full' }
      : { onAccent, offset: CELL_RING_OFFSET, radius: 0 }

  return (
    <PressArea
      fill={fill}
      focusOnMount={focusOnMount}
      ring={ring}
      {...(inert || onPress === undefined ? {} : { onPress })}
      disabled={inert}
      // Grown outwards rather than drawn larger: the control keeps the size the designs give it and
      // the target reaches the floor. Ignored on the web, where a pointer does not need it.
      hitSlop={reach > 0 ? 0 : touchReach(buttonHeight(size), MIN_HIT_TARGET)}
      reach={reach}
      {...(name === undefined ? {} : { accessibilityLabel: name })}
      busy={loading}
      {...(testID === undefined ? {} : { testID })}
    >
      {(pressed, hovered) => (
        <Frame
          // The loading spinner's containing block: on the web a stack is static, and the
          // spinner's absolute offsets would otherwise resolve against the page.
          position="relative"
          {...(fill ? { flex: 1 } : {})}
          // A box reaching past the frame is the button; a role here reads as a smaller one.
          {...(reach > 0 ? {} : FRAME_ROLE)}
          variant={variant}
          size={size}
          circular={circular}
          {...(circular
            ? {}
            : { height: 'auto', minHeight: SIZE_MIN_HEIGHT[size], paddingVertical: '$2xs' })}
          destructive={destructive}
          {...(paddingHorizontal === undefined ? {} : { paddingHorizontal })}
          {...(borderRadius === undefined ? {} : { borderRadius })}
          disabled={inert}
          {...(inert && FRAMELESS.has(variant) ? { borderColor: 'transparent' } : {})}
          {...PRESS_PASSTHROUGH}
          // The variant's own `hoverStyle`, applied from the wrapper's hover: see `PressArea`.
          {...(hovered && !pressed && !inert ? { forceStyle: 'hover' as const } : {})}
          {...(pressed && !inert
            ? // Only the catalog reports a press on the web, where `pressStyle` is the press.
              isWeb
              ? { forceStyle: 'press' as const }
              : PRESSED[variant]
            : {})}
        >
          {/* Loading hides the content but keeps its room, so the button keeps its size and
              nothing around it moves; the spinner is drawn over it, centred. The button's
              accessible name is set above, since Android does not read a transparent child. */}
          <Concealed when={loading}>{icon}</Concealed>
          <Concealed when={loading}>
            {typeof children === 'string' ? (
              <Text
                size={size === 'xs' || size === 'sm' ? '$label' : '$body'}
                // Bold, which is what the desktop client's button is: `font-weight: 700` unless a
                // caller says otherwise, and none of the onboarding callers do.
                weight="bold"
                // Centred line by line, so a label that wraps stays centred in the button.
                textAlign="center"
                maxFontSizeMultiplier={LABEL_MAX_SCALE}
                color={
                  INHERITED_LABEL ??
                  ((pressed || hovered) && !inert ? (pressedLabel ?? nativeLabel) : nativeLabel)
                }
              >
                {children}
              </Text>
            ) : (
              children
            )}
          </Concealed>
          {loading ? (
            <YStack
              position="absolute"
              top={0}
              bottom={0}
              left={0}
              right={0}
              alignItems="center"
              justifyContent="center"
              pointerEvents="none"
              // The button already says it is busy and carries its label as its name, so the
              // spinner has nothing to add, and a progress bar with no name is an error.
              aria-hidden
            >
              <YStack scale={SPINNER_SCALE[size]}>
                <Spinner size="small" color={nativeLabel} />
              </YStack>
            </YStack>
          ) : null}
        </Frame>
      )}
    </PressArea>
  )
}
