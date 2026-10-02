import { PRIMARY_COLOR_HEX } from './colors'
import type { PrimaryColorState, ThemeState } from './colors'
import {
  CONTRAST,
  contrastAdjust,
  contrastAdjustAll,
  contrastPickAll,
  contrastPrefer,
  contrastPreferAll,
  contrastTo,
  step,
  tint,
  tintFloor,
  tintedPole,
} from './rules'
import { hexToOklch } from './oklch'

/**
 * A theme, as the few knobs it is actually made of.
 *
 * The shape came from a question worth recording: is Ocean simply Classic with a tint? It very
 * nearly is. Applying Ocean's hue and chroma to Classic's lightnesses lands within 0.008 L of
 * Ocean's shipped surfaces, and on one of them within 0.000 -- so the two "themes" were never two
 * palettes, they were one ladder seen through a tint. The single real exception is Classic Dark's
 * second surface, which is pure black where Ocean's is lifted, and that is a stylistic decision
 * rather than a derivation, so it is an override.
 *
 * That is what makes a fifth theme a few numbers, and what lets a colour a *user* picks be treated
 * exactly like one we shipped.
 */
export type ThemeKnobs = {
  /**
   * Which way every rule steps, and which set of contrast targets applies.
   *
   * Not cosmetic: contrast is not symmetric about the middle of the range, so the same *perceived*
   * separation needs a smaller ratio near white than near black. The shipped themes show it
   * plainly -- their second surface sits at 1.05 in both light themes and 1.14-1.22 in both dark
   * ones. A single target over-darkens the light themes, which is exactly what a first attempt at
   * this did.
   */
  readonly polarity: 'light' | 'dark'
  /** The page. Every surface is a measured distance from this. */
  readonly background: string
  /**
   * Optional. How much of the theme's identity the *text* carries.
   *
   * There is deliberately no authored text colour. Text is contrast-first -- black or white,
   * whichever the base admits -- because an authored one cannot be trusted: a mid-tone base with
   * an authored white text measured 2.5:1 on every text role at once, while the message bubble's
   * text, the one role already picked against what it sits on, stayed legible at 4.9. Deriving it
   * removes a knob rather than adding one, and removes the knob most able to produce something
   * illegible.
   *
   * A theme that wants its text tinted anyway -- Ocean Light's navy is part of what makes it Ocean
   * -- gives a chroma here, and the hue defaults to the theme's own.
   */
  readonly textTint?: { readonly chroma: number; readonly hue?: number }
  /**
   * The hue the theme is seen through, and how much of it each kind of role carries.
   *
   * Two chromas rather than one, because the shipped values need two: Ocean's surfaces sit at
   * 0.013 (light) and 0.026 (dark) while its borders and bubbles sit at 0.059 and 0.045 -- 4.6x
   * and 1.7x more. That is chroma used for *emphasis* rather than for identity, and a single value
   * flattens one into the other. Giving every role the surface chroma is what turned Ocean's blue
   * bubbles grey on the first attempt.
   *
   * Classic is `0, 0`: its surfaces measure C=0.0000 across the board, so it is genuinely neutral
   * rather than subtly warm.
   */
  readonly tint: { readonly hue: number; readonly surface: number; readonly emphasis: number }
  /** The colour a shadow is drawn in. Not derived -- see the elevation note in the plan. */
  readonly elevation: string
  /** The onion path when connected. Fixed, and deliberately never the accent. */
  readonly pathConnected: string
  /**
   * The accent this theme starts on.
   *
   * Recorded because the shipped app applies it when a theme is selected -- picking Ocean Light
   * moves the accent from green to blue on its own -- so theme and accent are not the independent
   * axes the token set treats them as. The four theme thumbnails on the Appearance screen bake it
   * in: green for the Classic pair, blue for the Ocean pair.
   *
   * It changes nothing about the derivation. It exists so that "which accent does this theme come
   * up as" has an answer in the model rather than only in whatever code selects a theme.
   */
  readonly defaultAccent: string
  /**
   * Authored semantic colours, replacing the derived ones.
   *
   * Inputs rather than output overrides, because the colours that depend on them have to follow:
   * overriding `dangerColor` after the fact would leave `onDanger` picked against a red the theme
   * no longer uses.
   *
   * All four presets author their `danger`; none authors a `warning`.
   *
   * The reds are worth pinning: they are recognisable, they predate any rule, and the derivation
   * puts them somewhere visibly different. The ambers are not. Once the pair stopped having to
   * separate from each other, the derived light amber came out at `#ab4f00` against the shipped
   * `#A64B00` -- a hair *more* saturated and one degree of hue away, which is an override earning
   * nothing. The dark one does differ (a more golden `#D6A400` against `#FCB159`), and is left
   * derived deliberately so the comparison shows what the rules actually produce.
   */
  readonly semantic?: { readonly danger?: string; readonly warning?: string }
  /** Deliberate departures from what the rules would produce. */
  readonly overrides?: Readonly<Partial<ThemeTokens>>
}

/** The brand red and amber, authored once. The shipped themes already varied these by polarity
 * only -- two values each, not four -- so the hue is authored and the contrast is computed. */
const DANGER_BASE = '#E12D19'
/**
 * The amber to warn in, per polarity: the two the clients already ship.
 *
 * Two values because the gamut answers differently at the two ends. A warning must clear 4.5:1 on
 * its surfaces, which on a light base forces it dark and on a dark base lets it stay bright -- and
 * at low lightness an orange stays saturated where a yellow turns olive.
 *
 * These are the shipped values rather than anything invented, and on their own themes the rules
 * pass them through untouched: on a dark base `#FCB159` already clears 4.5:1, so nothing adjusts
 * it. Elsewhere -- a custom base, a mid-tone, a saturated one -- the same value is adapted rather
 * than replaced.
 *
 * The dark value sits at the amber people recognise rather than being pushed toward gold. Hue
 * separation from the danger red is not a requirement the rules make, and buying it here costs 19
 * degrees for 0.016 of chroma -- a warning that has to be identified as a warning cannot afford to
 * be a colour nobody names amber.
 */
const WARNING_BASE = { light: '#A64B00', dark: '#FCB159' } as const

/** What a disabled label still has to manage, on every surface. Below AA on purpose. */
const DISABLED_FLOOR = 2

/** How much of the body text's chroma survives being dimmed. Measured off Ocean Light: 0.053/0.080. */
const CHROMA_DECAY = 0.66

/**
 * How far each role sits from the surface behind it, per polarity.
 *
 * Read off the four shipped themes rather than chosen here, and split by polarity because they
 * cluster that way:
 *
 *              light            dark
 *   surface2   1.05, 1.06       1.22, 1.14
 *   surface3   1.14, 1.13       1.25, 1.25
 *   bubble     1.14, 1.28       1.25, 1.88
 *   border     1.33, (2.59)     1.69, 1.88
 *   muted text 5.17, 4.92       6.72, 7.41
 *
 * `bubble` is the one row that does not simply average its column. Three of the four themes give
 * an incoming bubble exactly the same value as the recessed surface, and a bubble that measures
 * the same as a panel does not read as a bubble -- so it sits above the surface row, toward the
 * separation the fourth theme chose. The light figure was set to the fourth theme's 1.28 first and
 * read as too dark against the legacy app, so it sits between the two.
 *
 * `mutedText` is the WCAG AA floor plus a hair *against the base* -- but that is not where it ends
 * up. Muted text has to stay legible on the cards it actually sits on, so the derivation lifts it
 * until the worst surface clears AA too, which lands it at **5.2 against the base**. The shipped
 * light value is 5.17.
 *
 * Worth spelling out, because the number here looks like it contradicts that: 4.6 was chosen after
 * 5.05 "read too dark", and it turned out the shipped value was not arbitrarily dark at all -- it
 * is what working on a card costs. The 4.6 in this table is a floor the all-surfaces pass then
 * raises; it is not the value anything renders.
 *
 * `disabledText` is the only row deliberately *below* the AA floor: a disabled control must read as
 * unavailable, and a value that passes AA does not.
 *
 * `border` is the row that was misread longest. Ocean Light's 2.59 looked like an outlier against
 * the other three at ~1.33 until a capture of the real app showed why: its row dividers measure
 * `#cddce3` at 1.31 from the card, while `#5CAACC` at 2.59 is its *control* edge. The 1.33 here is
 * the divider's value, which is why `separatorColor` is the role that reads it.
 *
 * Ocean Light authors `#5CAACC` rather than deriving it, because its control edge is genuinely
 * louder than the rule produces -- 2.59 against a derived 1.32. That override is a property of the
 * theme, not a patch over this target.
 */
const TARGETS = {
  light: {
    surfaceRaised: 1.055,
    surfaceOverlay: 1.135,
    bubble: 1.2,
    border: 1.33,
    mutedText: 4.6,
    disabledText: 2.4,
  },
  dark: {
    surfaceRaised: 1.18,
    surfaceOverlay: 1.25,
    bubble: 1.6,
    border: 1.785,
    mutedText: 7.05,
    disabledText: 3.4,
  },
} as const

const KNOBS: Record<ThemeState, ThemeKnobs> = {
  'classic-dark': {
    polarity: 'dark',
    // **Pure black, which is the legacy client's `classicDark0`.** The page is the black one and
    // `#1B1B1B` is the colour of the things that sit on it -- cards, and the alert background.
    // Inverted, the whole app reads a shade too light beside the client.
    background: '#000000',
    tint: { hue: 0, surface: 0, emphasis: 0 },
    elevation: '#000000',
    pathConnected: '#31F196',
    defaultAccent: '#31F196',
    semantic: { danger: '#FF3A3A' },
    // The client's `classicDark1`, named rather than derived: the ladder lifts from black by its
    // own step, and this is the specific grey every surface in the client uses.
    overrides: { backgroundSecondary: '#1B1B1B' },
  },
  'classic-light': {
    polarity: 'light',
    background: '#FFFFFF',
    tint: { hue: 0, surface: 0, emphasis: 0 },
    elevation: '#000000',
    pathConnected: '#31F196',
    defaultAccent: '#31F196',
    semantic: { danger: '#E12D19' },
  },
  'ocean-dark': {
    polarity: 'dark',
    background: '#1A1C28',
    tint: { hue: 278, surface: 0.026, emphasis: 0.045 },
    elevation: '#000000',
    pathConnected: '#31F196',
    defaultAccent: '#57C9FA',
    semantic: { danger: '#FF3A3A' },
  },
  'ocean-light': {
    polarity: 'light',
    background: '#FCFFFF',
    tint: { hue: 202, surface: 0.013, emphasis: 0.059 },
    // The one theme whose text is not simply black: its navy is part of the identity, and its own
    // hue rather than the surface hue, which is a cooler cyan.
    textTint: { chroma: 0.09, hue: 265 },
    elevation: '#000000',
    pathConnected: '#31F196',
    defaultAccent: '#57C9FA',
    semantic: { danger: '#E12D19' },
    // Ocean Light draws its edges as a saturated blue rule rather than a tinted hairline -- twice
    // the separation and seven times the chroma of any other theme's border. Like Classic Dark's
    // pure black, a decision rather than a derivation.
    overrides: { bordersColor: '#5CAACC' },
  },
}

/**
 * A whole theme from the two things a person actually chooses: a base and an accent.
 *
 * Polarity is not a third control -- it is a reading of the base, since a base light enough to be
 * a light theme's page is exactly what makes it a light theme. And the tint is not a control
 * either: its hue comes from whichever of the two picks carries hue, preferring the base, because
 * a person who picked a blue-grey page meant the page to be blue-grey. Only when the base is
 * neutral does the accent lend its hue, which is the effect people are reaching for when they pick
 * a colour -- choose purple and the surfaces go faintly purple.
 *
 * Neither pick is altered. The chromas are the values fitted from Ocean per polarity, since Ocean
 * is the only shipped evidence of how much tint reads as tasteful rather than tinted, and the
 * surface chroma is raised to the base's own if the base is more saturated than that -- otherwise
 * deriving surfaces from a strongly tinted base would wash them toward grey.
 *
 * No text tint, so text is contrast-derived. Nothing here can produce illegible text.
 */
export function knobsFor(base: string, accent: string): ThemeKnobs {
  const { l, c, h } = hexToOklch(base)
  const polarity = l >= 0.5 ? 'light' : 'dark'
  const fitted =
    polarity === 'light' ? { surface: 0.013, emphasis: 0.059 } : { surface: 0.026, emphasis: 0.045 }

  return {
    polarity,
    background: base,
    tint: {
      hue: c > 0.005 ? h : hexToOklch(accent).h,
      surface: Math.max(c, fitted.surface),
      emphasis: fitted.emphasis,
    },
    elevation: '#000000',
    pathConnected: '#31F196',
    defaultAccent: accent,
  }
}

/** The tokens a component asks for -- the names the app already uses, unchanged. */
export type ThemeTokens = {
  /** The brand accent, unmodified. Never derived and never adjusted -- see `accentText`. */
  primaryColor: string
  /** Text or a glyph sitting *on* the accent. */
  onAccent: string
  /** Text or a glyph sitting *on* the danger fill. */
  onDanger: string
  /**
   * The accent used *as* text.
   *
   * A pick, not an adjustment: the accent is a brand colour, so where it is not legible on the
   * surface the answer is the body text, not a darker green. That is the convention the light
   * themes already follow -- most of what is accent-coloured in a dark theme is plain text in
   * Classic Light, because Session's green measures under 1.6:1 on white.
   */
  accentText: string
  accentHover: string
  accentPressed: string
  dangerColor: string
  warningColor: string
  backgroundPrimary: string
  backgroundSecondary: string
  backgroundTertiary: string
  /** A surface derived from the one behind it, for a card inside a card. */
  backgroundNested: string
  /**
   * Light in every theme, because its polarity is fixed rather than themed: a switch thumb reads
   * as a physical object and a QR panel has to scan. A dark theme that steps these off its own
   * surface ladder gets a dark thumb, which reads as switched off.
   *
   * Light, but not necessarily white, and not a derived colour either: it is one of two existing
   * roles, chosen by polarity. See `surfaceInk`.
   */
  surfaceInverted: string
  /**
   * The counterpart, and the reason `surfaceInverted` exists at all: what gets *printed* on it.
   *
   * A QR code has to be dark-on-light in every theme, so neither half of it can follow the theme's
   * polarity. What the clients do -- and it is better than deriving a new colour -- is **swap which
   * existing role feeds which slot**:
   *
   *   light theme:  modules = text,                panel = backgroundSecondary
   *   dark theme:   modules = backgroundSecondary, panel = text
   *
   * The panel comes out light and the modules dark either way, and *both* stay themed, so Ocean
   * Light's modules are its navy and Ocean Dark's are its slate rather than a flat black. An
   * earlier version here derived the modules as the darker of the two anchors, which happens to be
   * right on light themes and wrong on both dark ones.
   */
  surfaceInk: string
  textPrimary: string
  textSecondary: string
  textDisabled: string
  /**
   * A control's edge -- an outline button, an input, an illustration frame. Carries the emphasis
   * chroma, so in a tinted theme it is part of the identity.
   */
  bordersColor: string
  /**
   * A hairline dividing rows *inside* a surface. The same distance as a border, but measured from
   * the surface it divides and at surface chroma rather than emphasis.
   *
   * Two roles, and a capture of the real Ocean Light is what measures them apart: its row
   * dividers are `#cddce3`, a pale grey-blue at 1.31 from the card, while its border is `#5CAACC`,
   * a saturated blue at 2.59 from the page. One role serving both draws every divider as a vivid
   * rule, and makes the quieter of the two look like a badly behaved version of the louder.
   */
  separatorColor: string
  messageBubbleIncomingBg: string
  messageBubbleIncomingText: string
}

/**
 * Gone from the shipped seventeen, and why: `messageBubbleOutgoingBg` was always the accent and
 * `messageBubbleOutgoingText` is now `onAccent`; `buttonOutlineBg` was the string `transparent`,
 * which is a component's decision rather than a theme value; and `buttonOutlineBgHover`,
 * `buttonOutlineText`, `buttonOutlineBorder` and `buttonSolidTextHover` were all four the body
 * text in all four themes. They existed because each theme authored every value by hand. Once the
 * values are derived, a token whose rule is "the body text" is the body text, and the variant that
 * wanted it belongs in the button rather than in the palette.
 */

export function getThemeKnobs(theme: ThemeState): ThemeKnobs {
  return KNOBS[theme]
}

export function getThemeTokens(theme: ThemeState, primaryColor: PrimaryColorState): ThemeTokens {
  return deriveTokens(KNOBS[theme], PRIMARY_COLOR_HEX[primaryColor])
}

/**
 * A surface at `ratio` from the one behind it, carrying the tint its kind calls for.
 *
 * Relative to a parent rather than to the page, because a nested card is the case three named
 * levels cannot express: a card inside a card inside a modal runs out of names, and the depth a
 * screen reaches is a property of the screen, not of the theme.
 *
 * An args object rather than four positional parameters, three of which would be numbers.
 */
function above({
  parent,
  ratio,
  chroma,
  hue,
}: {
  parent: string
  ratio: number
  chroma: number
  hue: number
}): string {
  return tintFloor(contrastAdjust(parent, parent, ratio), chroma, hue)
}

/**
 * Text dimmed toward the surface, losing chroma as it goes.
 *
 * Chroma decays rather than holding: Ocean Light's navy text is C 0.080 and its real muted text
 * C 0.053, two thirds of it. Preserving the full chroma while dropping only lightness gave a muted
 * text noticeably bluer than the shipped one. When the text is achromatic the emphasis chroma acts
 * as a floor instead, which is what keeps a white-on-tinted-dark theme's captions from reading as
 * dead grey.
 */
function dim({
  text,
  background,
  ratio,
  hue,
  emphasis,
}: {
  text: string
  background: string
  ratio: number
  hue: number
  emphasis: number
}): string {
  const own = hexToOklch(text)
  const dimmed = contrastTo(text, background, ratio)
  // The text's own hue where it has one, the theme's only where the text is achromatic. Setting the
  // surface hue outright is what turned a navy muted text teal -- twice now, so it is worth stating
  // plainly: a colour that carries hue keeps its hue.
  const ownHue = own.c > 0.005 ? own.h : hue
  return tint(dimmed, Math.max(emphasis, own.c * CHROMA_DECAY), ownHue)
}

/** The roles that depend on the accent. Every other role is derived from the knobs alone. */
type AccentRole = 'primaryColor' | 'onAccent' | 'accentText' | 'accentHover' | 'accentPressed'

/** A theme's accent-independent half, and the anchors its accent roles are measured against. */
interface ThemeBase {
  tokens: Omit<ThemeTokens, AccentRole>
  text: string
  background: string
  surfaces: string[]
}

/**
 * Each set of knobs' accent-independent half, derived once.
 *
 * All but five roles are the same for every accent, so the surfaces, text and semantic colours are
 * derived once per knobs object rather than once per accent. Keyed by the object, so a preset is
 * derived once and a custom set is let go with it -- which is why `ThemeKnobs` is read-only: a set
 * changed in place would be answered from the cache as it was first derived.
 */
const BASES = new WeakMap<ThemeKnobs, ThemeBase>()

function themeBase(knobs: ThemeKnobs): ThemeBase {
  const held = BASES.get(knobs)
  if (held !== undefined) return held
  const { polarity, background, tint: t, textTint, semantic, overrides } = knobs
  const target = TARGETS[polarity]

  /**
   * Surface overrides are resolved *here*, not on the way out.
   *
   * Four roles are derived from the recessed surface -- the nested surface, the incoming bubble,
   * the separator and, in a dark theme, the QR modules -- so an override applied to the returned
   * object arrives too late for any of them. Classic Dark's pure-black surface was overridden on
   * the way out and its QR modules still came from the unoverridden `#292929`.
   *
   * Same shape as the `semantic` knob, and for the same reason: a value other values depend on has
   * to be settled before they are computed, which makes it an input rather than a patch.
   */
  const backgroundSecondary =
    overrides?.backgroundSecondary ??
    above({ parent: background, ratio: target.surfaceRaised, chroma: t.surface, hue: t.hue })
  const backgroundTertiary =
    overrides?.backgroundTertiary ??
    above({ parent: background, ratio: target.surfaceOverlay, chroma: t.surface, hue: t.hue })
  const backgroundNested =
    overrides?.backgroundNested ??
    above({
      parent: backgroundSecondary,
      ratio: target.surfaceRaised,
      chroma: t.surface,
      hue: t.hue,
    })

  /** Every surface a role might be drawn on, since a role is not owned by the page. */
  const surfaces = [background, backgroundSecondary, backgroundTertiary, backgroundNested]

  /**
   * Black or white, whichever works on *every* surface -- not just on the base.
   *
   * The last text role I had left measured against the base alone, and it showed: forcing dark
   * polarity onto a light base sent the surfaces darker while the base still picked black, so body
   * text came out black and muted text came out light, on opposite sides of the same surface. They
   * disagreed because they were answering different questions.
   */
  const pole = contrastPickAll(['#000000', '#FFFFFF'], surfaces)
  const text = textTint
    ? tintedPole(pole, textTint.chroma, textTint.hue ?? t.hue, background)
    : pole

  /** The two QR slots, fed by the same pair of roles with the assignment swapped by polarity. */
  const ink = polarity === 'light' ? text : backgroundSecondary
  const panel = polarity === 'light' ? backgroundSecondary : text
  // Neither yields to the other any more, so both are simply the most saturated version of
  // themselves that clears text contrast on every surface.
  const danger = semantic?.danger ?? contrastAdjustAll(DANGER_BASE, surfaces, CONTRAST.normal)
  const warning =
    semantic?.warning ?? contrastAdjustAll(WARNING_BASE[polarity], surfaces, CONTRAST.normal)
  // A bubble is a surface, but it is one of the things a theme is recognised by, so it carries the
  // emphasis chroma. That is the difference between Ocean's blue bubbles and a tinted grey.
  //
  // Measured from the recessed surface rather than the page because that is what a thread is drawn
  // on, and the whole system's invariant is that a value is relative to what it sits on. Deriving
  // it from the page instead cost it a third of its separation, which is what made it read as a
  // background. If the thread ever moves onto the page, this parent moves with it.
  const incomingBg = above({
    parent: backgroundSecondary,
    ratio: target.bubble,
    chroma: t.emphasis,
    hue: t.hue,
  })

  const base: ThemeBase = {
    tokens: {
      // Both are nearly always labels, which is normal-size text and owes 4.5:1 -- not the 3:1 a
      // graphic boundary gets. Picking against the fill rather than preferring one anchor is what
      // keeps that true in every theme: white clears 3:1 on a mid red and loses to black on 4.5.
      dangerColor: danger,
      onDanger: contrastPickAll([text, background], [danger]),
      warningColor: warning,
      backgroundPrimary: background,
      backgroundSecondary,
      backgroundTertiary,
      backgroundNested,
      surfaceInverted: panel,
      surfaceInk: ink,
      textPrimary: text,
      // Muted text is the body text dimmed, not the page lifted: deriving it from the background
      // discards the hue the theme chose for its text, which is how a navy secondary became teal.
      //
      // Dimmed as far as the *worst* surface allows, not as far as the base allows. A caption sits
      // on a card far more often than on the page -- feature rows, stat cards, settings values --
      // and targeting the base alone put it at 3.9:1 there while measuring 4.6 where nothing was
      // drawn. This is also what explains the shipped light value of 5.17 that had looked merely
      // dark: 5.14 against white is exactly what 4.5 against the nested surface costs.
      textSecondary: contrastAdjustAll(
        dim({ text, background, ratio: target.mutedText, hue: t.hue, emphasis: t.emphasis }),
        surfaces,
        CONTRAST.normal,
      ),
      // Deliberately below the AA floor -- a disabled control has to read as unavailable -- but
      // still present on every surface, which is a lower bar rather than no bar.
      textDisabled: contrastAdjustAll(
        dim({ text, background, ratio: target.disabledText, hue: t.hue, emphasis: t.emphasis }),
        surfaces,
        DISABLED_FLOOR,
      ),
      // A border is a line, not a surface: read as an edge, and in a tinted theme deliberately part
      // of the identity, so it takes the emphasis chroma.
      bordersColor: above({
        parent: background,
        ratio: target.border,
        chroma: t.emphasis,
        hue: t.hue,
      }),
      separatorColor: above({
        parent: backgroundSecondary,
        ratio: target.border,
        chroma: t.surface,
        hue: t.hue,
      }),
      messageBubbleIncomingBg: incomingBg,
      messageBubbleIncomingText: contrastPrefer(
        [text, '#000000', '#FFFFFF'],
        incomingBg,
        CONTRAST.normal,
      ),
    },
    text,
    background,
    surfaces,
  }
  BASES.set(knobs, base)
  return base
}

/**
 * The whole theme from its knobs and an accent.
 *
 * Public, and not only for the four presets: an accent the *user* picks has to go through exactly
 * the same derivation as one we shipped, or a custom accent is a second code path that nobody
 * tests. A preset is then just a stored set of knobs.
 */
export function deriveTokens(knobs: ThemeKnobs, accent: string): ThemeTokens {
  const { tokens, text, background, surfaces } = themeBase(knobs)

  // Text on the accent is one of the theme's own two anchors rather than flat black or white: on a
  // bright accent every theme reaches for its darkest anchor, which is the text in a light theme
  // and the page itself in a dark one.
  // **Which of the two reads best, not which is preferred.** An on-fill colour has no brand to
  // protect -- both candidates are theme anchors already -- so there is no preference to express
  // and nothing to gain from stopping at the first that clears a floor. `contrastPrefer` is for
  // `accentText`, where the point is to leave a chosen accent alone if it can carry the text.
  const onAccent = contrastPickAll([text, background], [accent])

  return {
    primaryColor: accent,
    onAccent,
    // 4.5:1 because it is text. On a light ground Session's green cannot clear it at any size, so
    // this resolves to the body text there -- which is why a light theme looks less accented.
    accentText: contrastPreferAll([accent, text], surfaces, CONTRAST.normal),
    accentHover: step(accent, 1, background),
    accentPressed: step(accent, 2, background),
    ...tokens,
    ...knobs.overrides,
  }
}
