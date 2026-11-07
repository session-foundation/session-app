# Theming

A theme is a handful of authored numbers. Everything else is computed from them, so a colour a
_user_ picks goes through the same derivation as one we shipped — a custom accent is not a second
code path.

`packages/theme-tokens` owns it and has **zero runtime dependencies**, so the OKLCh conversions and
the WCAG maths are implemented there rather than pulled in.

## What you author, and what you get

```
polarity ─┐
base ─────┼──▶ 19 roles
tint ─────┤     surfaces · text · borders · semantic · accent variants
accent ───┘
```

| knob            | what it is                                                                                                                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `polarity`      | `light` or `dark`. Sets the step direction _and_ which contrast targets apply.                                                                                                                                                                                            |
| `background`    | The base. Where the ladder starts.                                                                                                                                                                                                                                        |
| `tint`          | `{ hue, surface, emphasis }`. Two chromas, because surfaces and identity need different amounts.                                                                                                                                                                          |
| `textTint?`     | Optional `{ chroma, hue? }`, if the theme's text carries its identity. Ocean Light's navy. Hue defaults to the theme's.                                                                                                                                                   |
| `semantic?`     | Optional authored `danger` / `warning`, for a preset whose reds are recognisable.                                                                                                                                                                                         |
| `defaultAccent` | The accent the theme comes up as. Changes nothing derived.                                                                                                                                                                                                                |
| `overrides?`    | Last resort. A stated departure from the rules. Two presets use it, one role each. Surface overrides are resolved _before_ anything derives from them — four roles hang off the recessed surface, so an override applied on the way out arrives too late for all of them. |

Every one of these is settable in the playground's Advanced mode, including turning `textTint` off —
which is what makes Ocean Light constructible rather than special.

There is **no authored text colour.** Text is `contrastPickAll(['#000000', '#FFFFFF'], surfaces)`.
This is not a simplification, it is a correctness property: an authored text anchor cannot be
trusted, and a mid-tone base with an authored white text measured 2.5:1 on every text role at once.
Against every surface rather than against the base, for the reason listed below as the fifth bug
this fixed -- a pick against the base alone put black body text above light muted text on one card.

`knobsFor(base, accent)` builds the whole thing from the two picks a person actually makes. Polarity
is read from the base's lightness; the tint hue comes from whichever pick carries hue, base first.

## Which role do I reach for?

Ask what the thing _is_, not what colour you want.

| you are drawing                                               | use                                |
| ------------------------------------------------------------- | ---------------------------------- |
| the page                                                      | `backgroundPrimary`                |
| a card, a list panel, a recessed pane                         | `backgroundSecondary`              |
| a selected row, a filled input                                | `backgroundTertiary`               |
| a card **inside** a card                                      | `backgroundNested`                 |
| body text                                                     | `textPrimary`                      |
| a caption, a timestamp, a section label, a snippet            | `textSecondary`                    |
| a disabled label                                              | `textDisabled`                     |
| an input's edge, an illustration frame, a divider rail        | `bordersColor`                     |
| an outline button's edge                                      | `textPrimary`                      |
| a divider inside a card, a pane edge                          | `separatorColor`                   |
| a filled accent button, a badge, an avatar, a bubble you sent | `primaryColor`                     |
| text or a glyph sitting **on** that fill                      | `onAccent`                         |
| a caption on that fill                                        | `onAccentSecondary`                |
| a link, an inline emphasis, a large numeral                   | `accentText`                       |
| an accent button's hover / pressed                            | `accentHover` / `accentPressed`    |
| destructive text, a destructive outline                       | `dangerColor`                      |
| text on a danger fill                                         | `onDanger`                         |
| a caution line                                                | `warningColor`                     |
| a switch thumb, a QR panel                                    | `surfaceInverted`                  |
| the modules printed on that panel                             | `surfaceInk`                       |
| an incoming bubble, and its text                              | `messageBubbleIncomingBg` / `Text` |
| the page dimmed behind a dialog or panel                      | `scrim`                            |
| a raised element's shadow                                     | `shadow`                           |
| a control hovered / held, laid over whatever it sits on       | `hoverOverlay` / `pressedOverlay`  |

No hex outside `@session/theme-tokens`. `pnpm --filter @session/ui test` fails on a token name that
does not exist, because tamagui resolves a missing token to `0` silently.

## The rules that came from bugs

Each of these is here because something shipped wrong or nearly did.

**A colour is relative to what it sits on.** Not to the page. This has bitten the system four
times: the incoming bubble derived from the base while drawn on the thread surface, losing a third
of its separation; the warning derived from the base while drawn inside a card, vanishing entirely
on a mid-tone base; the ghost button with no headroom on white; and `textSecondary` — the most-used
role of the lot — measuring 4.6:1 against a page nothing is drawn on while sitting at 3.9:1 on a
feature-row description.

**Five times now**, counting body text picked against the base while the surfaces stepped the other
way — which produced black body text above light muted text on the same card.

**Six**, counting hover and press drawn as the tertiary and nested surfaces. A ghost button in a
dialog on the recessed surface hovered one shade from it, and in the light themes its press was
lighter than its hover. A state is not a surface: it is `hoverOverlay` / `pressedOverlay`, laid
over the control's own ground, so the step is from whatever that ground is. One limit: body text
clears AA on every surface with a state over it, and muted text clears only the 3:1 a glyph needs,
so a row that carries muted text and sits on the page steps to the next surface instead.

If you add a role, derive it from its parent (`above()`, not `at()`) and clear its floor against
_every_ surface it can appear on (`contrastAdjustAll`, `contrastPreferAll`, `contrastPickAll`).
Assume it will be drawn on a card until proven otherwise. Unit tests over the four shipped themes
all passed while muted text was broken; the sweep caught it.

Worth knowing what the fix explained: dimming muted text only as far as the _worst_ surface allows
puts light-theme muted text at 5.14:1 against white. The shipped value is 5.17. What had looked
like an arbitrarily dark grey turns out to be exactly what working on a card costs.

**Accent-as-fill and accent-as-text are two roles.** Session's accents are chosen to be vivid on a
bubble. The green accent as link text on white measures under 1.6:1, and the accent is a brand
colour, so it is not ours to darken. `accentText` therefore _picks_ between the accent and the body
text. On a light ground it resolves to the body text — which is why a light theme looks less
accented, and that is correct rather than a bug.

**Text on a fill takes the fill's on-colour.** Not `textPrimary`. Both filled button variants used
the body text, which is white in the dark themes: white on the accent green is about 1.6:1.

**Off and disabled states come from the surface ladder, never the border role.** In a theme whose
border is a saturated identity colour, a border-coloured switch track reads as switched _on_.

**Fixed polarity is a role swap, not a pinned colour.** A QR code has to be dark-on-light in every
theme, and the clients get that by swapping which existing role feeds which slot rather than by
hardcoding anything:

|             | modules (`surfaceInk`) | panel (`surfaceInverted`) |
| ----------- | ---------------------- | ------------------------- |
| light theme | `textPrimary`          | `backgroundSecondary`     |
| dark theme  | `backgroundSecondary`  | `textPrimary`             |

Both values stay themed, so Ocean Light's modules are its navy and Ocean Dark's are its slate — not
a flat black. Deriving the modules as "the darker of the two anchors" is right on light themes and
wrong on both dark ones, which is what an earlier version of this did.

The switch thumb takes `surfaceInverted` for the same reason: light in every theme, because a dark
thumb reads as switched off.

**A darkening is black, not a role borrowed from the palette.** `scrim` and `shadow` are the two
roles not derived from a theme's colours: translucent black, with only the alpha keyed on polarity,
the way the desktop client keys them. Anything that dims or shades takes one of them. A dimming
built from a theme's own surfaces lightens a dark theme instead — every dark surface is lighter than
its page. Neither role carries a contrast obligation: nothing is read on them.

**Illustrations are exempt. Text and controls are not.** The Session mark and the network diagram
keep the brand green even on white.

**A semantic colour must be distinct from text, not from its sibling.** Danger and warning are
allowed to resemble each other — both light presets already ship a pair that a red-green
colour-blind viewer cannot separate, and the derivation does the same deliberately. What
neither may be is a colour dull enough to read as a paragraph, and since text is achromatic that is
a question about chroma: `MIN_SEMANTIC_CHROMA`.

Requiring the pair to separate was tried and cost more than it bought. On a light base 4.5:1 pins
both into a narrow band of lightness, so separating them means driving one of them dark, and
whichever yields loses its colour — the warning became a brown at chroma 0.074 that read as body
text. Dropping the requirement raised knob-space coverage from 36% to 47%.

This is also what the standard asks. WCAG 1.4.1 forbids colour as the _sole_ carrier of meaning, and
these are sentences — "Do not share your recovery password", "Delete account" — which say what they
mean in words. A bare status dot would be a different question, and should not rely on the pair.

**The amber is per-polarity**, because the gamut answers differently at the two ends: a warning has
to clear 4.5:1 on its surfaces, which on a light base forces it dark, and at low lightness an orange
stays saturated where a yellow turns olive. The two values are the ones the clients already ship —
`#A64B00` light, `#FCB159` dark — and on their own themes the rules pass them through untouched,
because they already clear the floor. Elsewhere the same value is adapted rather than replaced.

No preset overrides `warning` any more. All four author only their `danger`, whose reds are
recognisable and which the derivation would otherwise place visibly elsewhere.

**A divider is not a border.** These were one role until a capture of the real app settled it:
Ocean Light's row dividers measure `#cddce3` (1.31 from the card, surface chroma) while its authored
border is `#5CAACC` (2.59 from the page, emphasis chroma). Conflating them made every divider a
vivid blue rule, and it manufactured a phantom outlier — the 1.33 target fitted to "borders" was the
separator's value all along. Note what this did _not_ do: Ocean Light still authors its control
edge, because 2.59 really is louder than the rule's 1.32. The contradiction went; the departure
stayed.

**A surface takes the theme's hue unconditionally; text keeps its own.** These are different
questions and answering them the same way breaks something either direction. `tintFloor` raises a
_surface's_ chroma to the floor at the theme hue always — because the tint knob exists to say what
colour the surfaces are, and a base with chroma of its own must not be able to veto it. `dim` does
the opposite for text, where a colour that carries hue keeps it, which is what stops a navy muted
text turning teal.

Gating the hue on whether the chroma needed lifting is what put a 238° discontinuity on a knife
edge: a vivid red base sitting a ten-thousandth under the floor failed the comparison by that hair
and had its hue replaced, so the page was red and every surface on it was blue. Applying it always
is continuous, and a knob has to be continuous.

**Chroma is not negotiable for a semantic colour; contrast and separation are.** Both lightness
searches were given targets that white and black satisfy perfectly, and both duly returned one:
raising the danger/warning separation produced a `#ffffff` warning on one base and `#000000` on
another, and squeezing the last contrast out of an amber on a saturated base gave `#fdfdfd` — 4.56:1
and invisible. `contrastAdjustAll` applies a `CHROMA_KEEP` floor. On a base too
hostile to carry a full palette the guarantee downgrades to _recognisable_, not to _high contrast_,
because a warning that no longer looks like a warning is worse than one with less contrast.

**Ask the gamut, do not assume it.** Requesting a chroma sRGB cannot hold at some lightness does not
fail, it clamps — and clamping RGB moves the hue. Darkening the warning amber walked it from 57° to
the danger red's 29° and then to black. `inGamut()` reduces chroma until the hue survives the round
trip, and every lightness search goes through it.

**A vivid base is not a base either.** `baseFits` caps chroma at 0.12 as well as bounding lightness.
Validity falls off steadily with base saturation, and 0.12 is the knee — capping there lifts the
pass rate among admitted bases from 90% to 93% while still admitting three quarters of them. Above
it the returns flatten and the colour stops being a background: a page at chroma 0.23 is a brand
colour someone has typed into the wrong box.

**A chroma knob cannot have a fixed maximum.** sRGB holds wildly different amounts at different
lightnesses and hues — about 0.28 for a magenta at mid lightness, 0.055 for a yellow on a dark base,
and essentially nothing at either end of the range. Asking past the ceiling does not fail, it
quietly gives you less. Anything offering a chroma control should clamp it to `maxChroma(l, h)` for
the current base and hue, which is what the playground does.

**A mid-tone base is not a base.** The ladder needs the base near one end of the lightness range:
surfaces step away one direction, text the other. `baseFits(base, polarity)` is the precondition,
and its limits are measured rather than chosen — walking neutral greys, the dark end stops working
between L 0.26 and L 0.28, so the limit is **L ≤ 0.27** for dark and **L ≥ 0.82** for light. The two
are not symmetric: a light base leaves semantic colours the whole dark half of the range to work in,
where a dark base pushes them into a ceiling. A picker should say a base does not fit rather than
emit a palette that cannot work.

## Type

One monotonic ramp, named by role in four groups. Never pin an absolute root font size — that is
what keeps OS text scaling reachable, and it is asserted by a contract test.

| group   | tokens                                                          |
| ------- | --------------------------------------------------------------- |
| label   | `caption` 11 · `label` 12                                       |
| body    | `body` 14 · `bodyLarge` 16                                      |
| header  | `title` 18 · `titleLarge` 20 · `heading` 23 · `headingLarge` 26 |
| display | `display` 29 · `displayMedium` 32 · `displayLarge` 36           |

Line height is derived at `LINE_HEIGHT_RATIO` (1.2), not declared, so a size added to the ramp
cannot arrive without one.

`size="$body"` on `Text` is the font ramp. `size="$6"` on `Icon` is the _size_ scale — component
heights. They are different scales that both accept `size`.

Scaling is split by platform: **mobile follows system dynamic text scaling**, **desktop uses zoom**
(Chromium's `setZoomFactor`). Whether desktop should also honour system text scaling where the OS
offers it is open.

## Porting a screen

The newest designs are the authority, in this order: **Session Pro → Session Network → the
Collapsible Footer Action spec**. Several older designs have not been touched in a long time, so
where the rules and an old screen disagree, do not assume the screen is right.

Conventions read off the newest designs, which contradict the older ones:

- **Cards have no edges.** Fill alone separates a card from the page. The border role does dividers,
  outline controls and illustration frames.
- **Section labels are body-size sentence case, muted.** Not uppercase letter-spaced micro-labels.
- **Two input styles**: an outlined pill for a field you fill in, a filled pill for search.
- **The conversation list keeps the base; the thread is the recessed surface**, and a thread's
  header and composer take the base too, because they are chrome rather than content. Mobile and
  desktop genuinely disagree here — on desktop both panes are visible at once. Treat it as a
  breakpoint question.
- **A destructive button is danger-coloured text on a transparent background**, not a red fill.
- **Inline links have two conventions in the newest designs and it is unresolved**: the Pro card
  sets one as bold body text with an external glyph and no colour; the Network screen uses the
  accent. Pick deliberately and say which.

Layout cases to check on arrival are in the porting checklist. The one number worth carrying: iOS
declares a fixed height 189 times against 9 flexible ones, where Android's Compose layer is 18:20 —
so where a screen came from predicts its layout risk, and Android is the safer porting source.

## Checking your work

- **Coverage.** `coverage.test.ts` samples the knob space — base lightness, chroma and hue, tint hue
  and both chromas, and every accent — and asserts a floor on the share that produces a working
  palette. Measured at the time of writing: **90% of bases `baseFits` admits**, and **95% once the
  base is also near-neutral** (light 87%, dark 98%). It runs in CI with everything else, in a couple
  of seconds, and exists so that a change which quietly shrinks the range of workable themes shows
  up as a number moving rather than as a bug months later. The thresholds are a ratchet, not a
  target.
- `pnpm --filter @session/theme-tokens test` — the rules, the invariants above, and a sweep of
  **112 combinations**: four themes and twelve plausible custom bases against all seven accents,
  every role with a floor, on every surface it can be drawn on. Zero shortfalls is the assertion.
  The confusable red-green pair is pinned by a **lower bound on a count**, so it records that the
  collision exists rather than which bases have it -- a new collision makes that assertion pass
  more easily, not fail. Tightening it to name the bases is worth doing when the authored reds are.
- `pnpm --filter @session/ui test` — every `'$token'` literal in `ui` and `screens` must name a
  token that exists. It matches any such literal, not just `prop="$x"`, because a token named inside
  a conditional was exactly where a missing one hid.
- A new role needs its contrast asserted against **every surface it can be drawn on**, not just the
  base.

## Adding a theme

Author as little as possible. A new theme should set `polarity`, `background`, `tint` and nothing
else — `semantic` and `overrides` exist for the four presets, whose reds and borders predate any
rule and are recognisable. If a new theme needs an override, the rule is probably wrong.

## Open decisions

Marked so nobody implements one by accident:

1. **The brand red is not a 4.5:1 text colour on Session's surfaces.** `#E12D19` measures 2.6–4.0
   on the raised and nested surfaces of all four themes. Holding danger to text contrast moves it
   visibly. Accessibility or brand exactness — the presets currently author the shipped reds.
2. **The dark warning amber is also a selectable accent.** `#FCB159` is `primaryOrange`, so a dark
   theme with the Orange accent renders warning and accent as the same colour. Nothing holds the
   two apart, since separating a semantic pair is deliberately not a rule here (see above), and the
   accent is user-chosen where the warning is not -- so this cannot be answered by yielding the
   warning.
3. **Both light presets ship a confusable red and amber.** Authored `#E12D19` and `#A64B00` are 18°
   of hue apart at a similar lightness, and the derived pair is not held apart either. A red-green
   colour-blind viewer would struggle to separate them. Pinned by a test rather than changed,
   because they are the shipped colours — see the note on that test's shape above.
4. **Whether desktop should honour system text scaling** as well as zoom, and what that costs.

## Nesting a rounded box inside a rounded box

**Inner radius = outer radius − the gap between them.** Two rounded rectangles read as belonging to
one another only when their corner arcs share a centre; given the same radius, the inner corners
bulge and the gap looks thicker at the corners than along the edges.

Two boundary cases, because both occur here:

- **gap ≥ outer radius** — no concentric inner radius exists, the inner corners sit clear of the
  outer arc, and the radius is a free choice. The Open URL dialog is this: radius 11, inset 20.
- **gap = 0** — the inner radius equals the outer, or the inner element squares its corners and
  lets the parent clip. A dialog's action buttons are this, which is why they set `$none`.

**Corners are circular, deliberately.** React Native's `borderCurve` defaults to `circular` and
nothing here sets it, so iOS, Android and desktop draw the same quarter-circle. Apple's continuous
curvature is available on two of the three — `borderCurve: 'continuous'` and CSS `corner-shape` —
and Compose has no equivalent at all, so opting in would _create_ a platform difference rather than
resolve one. All three legacy clients are circular too.

**A sheet rounds its top two corners only**, at `$xl`. Both clients that have bottom sheets round
only the top, which is the part they agree on — the radius itself they disagree about. So this is
`borderTopLeftRadius` and `borderTopRightRadius`, never `borderRadius`.

**An opacity on an on-colour spends the ratio that token guarantees.** `$onAccent` and `$onDanger`
are derived to clear 4.5:1 against their fill, and how much is left to spend depends on the accent:
Ocean Light's navy starts at 5.5:1 on purple. A caption on the accent is `onAccentSecondary`, which
the theme fades only as far as 4.5:1 allows; never put an opacity on an on-colour.

**The incoming bubble is a surface muted text is measured on.** A received file's captions sit on
it, and it is the furthest surface from the page in every theme. A failed file says so in that
caption, at the muted text's contrast. Its retry glyph is red on the page only; on a bubble it is
the bubble's ink, like the row's other glyphs, since the red falls to 2.4:1 on Ocean Dark's.

## Where the two ladders come from

Both are on a 4 grid, and neither is an average of the three clients.

**Spacing is Android's `Dimensions.kt`, rung for rung** — 2 · 4 · 8 · 12 · 16 · 20 · 24 · 36 · 64 —
and all but two are values iOS declares as well. Weighted by use it covers 99% of the two mobile
clients' spacing. Three of their values are deliberately not rungs, so that reaching for one is a
decision rather than a lookup: **32** is iOS's iPad-only `iPadButtonSpacing`, whose own iPhone
branch is a literal 20; **48** appears nowhere as spacing; **50** is one Android component's
icon-to-label gap.

**Radius is read off Android too, because it is the only client with a shape scale to read.** iOS
declares no radius tokens at all — it has two conventions split by code layer, the newer SwiftUI
screens at 7 for a button and 11 for a container, the older app code at 6 and 30 — and Desktop has
two variables and a spread of literals. `$sm` · `$md` · `$lg` are Android's `shapeExtraSmall` ·
`shapeSmall` · `shapeMedium`, 90% of its shape references between them; `$2xl` is Material's
extra-large, which Android ships without declaring, since `sessionShapes()` overrides only the first
three and `extraLarge` falls through. Not rungs: **6**, whose only radius uses are message-bubble
inner geometry; **24**, which no client draws; **30**, which is `$full` on a 60pt control.

**Where a current design exists, it sets the value** and the clients are corroboration. An input is
11 in the designs, so it takes `$md`; a sheet's top corners are 20, so `$xl`.

**A container is `$md`.** The clients disagree and cluster inside 2px of it — iOS 11 across its
modal family, Android 12 in both its dialog generations, Desktop 13 in the one wrapper every dialog
composes — each internally consistent. 12 is the median and the only one of the three that is a
declared token.

## Porting a spacing value from a legacy client

**Unlike the type ramp, the clients do not share a spacing ladder.** On type all three converge, the
same values under the same names. On spacing there are two ladders on two different bases and the
three-way intersection is empty: iOS and Android are 4-based and agree on 4 · 8 · 12 · 16 · 24 · 64,
while Desktop is 5-based. Do not infer one from the other because they sit in the same document.

**The two mobile clients' spacing tokens have inverted names, and the values are nearly equal.**

| value   | iOS name           | Android name    |
| ------- | ------------------ | --------------- |
| 35 / 36 | `veryLargeSpacing` | `mediumSpacing` |
| 64      | `massiveSpacing`   | `xlargeSpacing` |

So iOS's _very large_ is Android's _medium_, and iOS's _massive_ is Android's _extra large_. Reading
a number out of one client and then looking up "the same" token in the other picks the wrong value,
in the wrong direction, and the result is close enough to look deliberate.

Port the **number and the role** — "the reading column's inset", "the action's inset" — and cite the
client and symbol it came from, as the onboarding constants do. Never port a token by its name.
