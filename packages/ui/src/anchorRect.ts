import { currentPageZoom } from './pageZoom'

/** Where an element sits in the window, in the coordinates a full-screen overlay is laid out in. */
export interface AnchorRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * What the two platforms offer for measuring an element, neither of which the other has.
 *
 * Feature-detected rather than split into `.native.ts` and `.ts`, because the question is which API
 * the object in hand actually has. Tamagui renders a real DOM node on the web and a react-native
 * host component on a device, and this is the one place that difference shows.
 */
interface MeasurableNode {
  measureInWindow?: (
    callback: (x: number, y: number, width: number, height: number) => void,
  ) => void
  getBoundingClientRect?: () => { left: number; top: number; width: number; height: number }
}

/**
 * Measures an element and hands back where it is, or null when it cannot be measured.
 *
 * Asynchronous because the native half is: `measureInWindow` goes to the UI thread and answers in
 * a callback. Null rather than a guess when there is nothing to measure -- a control positioned
 * against a made-up rectangle lands somewhere arbitrary, which is worse than not moving at all.
 */
export function measureAnchor(node: unknown, onMeasured: (rect: AnchorRect | null) => void): void {
  const measurable = node as MeasurableNode | null
  // Both measurements answer in the window's pixels, and the panel is placed inside the page,
  // whose pixels the desktop zoom has scaled: unscaled, a panel at 200% would open twice as far
  // from the corner as its trigger.
  const zoom = currentPageZoom()
  const unzoomed = (x: number, y: number, width: number, height: number): AnchorRect => ({
    x: x / zoom,
    y: y / zoom,
    width: width / zoom,
    height: height / zoom,
  })
  if (measurable === null || measurable === undefined) {
    onMeasured(null)
    return
  }

  if (typeof measurable.measureInWindow === 'function') {
    measurable.measureInWindow((x, y, width, height) => {
      onMeasured(unzoomed(x, y, width, height))
    })
    return
  }

  if (typeof measurable.getBoundingClientRect === 'function') {
    const rect = measurable.getBoundingClientRect()
    onMeasured(unzoomed(rect.left, rect.top, rect.width, rect.height))
    return
  }

  onMeasured(null)
}

/**
 * How far in from the leading edge to put a panel of `panelWidth` hanging off `anchor`.
 *
 * **Aligned to the trigger's trailing edge**, because the panel is wider than the trigger and the
 * trigger sits near the trailing edge: hanging their leading edges together would push the panel
 * off the window. Which edge that is mirrors, so the panel grows back toward the middle either way.
 *
 * **The rectangle coming in is physical and the offset going out is not**, which is the whole job
 * of the arithmetic between. `measureInWindow` and `getBoundingClientRect` both answer in window
 * coordinates whichever way the page reads; the caller applies the result through `logical`, and
 * both platforms resolve a leading inset from the right once mirrored. Yoga positions an absolute
 * child by leading and trailing rather than left and right, so a `left` written straight from a
 * measurement opens the panel off the wrong corner in Arabic.
 *
 * Clamped to the window on both sides, so the panel is always whole.
 */
export function panelInset(
  anchor: AnchorRect,
  panelWidth: number,
  windowWidth: number,
  margin: number,
  rtl = false,
): number {
  const left = rtl ? anchor.x : anchor.x + anchor.width - panelWidth
  const clamped = Math.max(margin, Math.min(left, windowWidth - panelWidth - margin))
  return rtl ? windowWidth - panelWidth - clamped : clamped
}

export interface PanelPlacement {
  /** Which side of the anchor the panel hangs off. */
  side: 'below' | 'above'
  /** Distance from the window's top edge when below, from its bottom edge when above. */
  offset: number
  /** How tall the panel may grow on that side. */
  available: number
  /** Whether it covers the window, trigger included, because neither side could hold it. */
  covers: boolean
}

/**
 * Which side of the trigger the panel opens on, and how much room it has there.
 *
 * Below by default, because that is what a chevron pointing down promises. It flips above only
 * when below genuinely cannot hold the panel and above can hold more of it -- not merely when
 * above is roomier, since a flip that buys nothing is just a control that moves unpredictably.
 *
 * **Over the trigger when neither side can hold it.** A short window -- desktop zoomed in, a phone
 * in landscape -- left the panel a strip on either side with room for a row or two of the list.
 * There it takes the whole window inside the margins instead, covering the trigger; its own close
 * control and a press outside still dismiss it.
 *
 * `available` is what the caller caps the list at, so a panel near an edge scrolls internally
 * rather than running off the screen. The trigger's own position is the thing that varies here:
 * it is beside the buttons mid-screen on a desktop window and in the top corner on a phone.
 */
export function panelPlacement(
  anchor: AnchorRect,
  windowHeight: number,
  gap: number,
  margin: number,
  minHeight: number,
  /** The margin when covering, smaller than `margin`: a window this short needs every row. */
  coverMargin: number = margin,
): PanelPlacement {
  const below = windowHeight - anchor.y - anchor.height - gap - margin
  const above = anchor.y - gap - margin
  if (below < minHeight && above < minHeight) {
    return {
      side: 'below',
      offset: coverMargin,
      available: windowHeight - 2 * coverMargin,
      covers: true,
    }
  }
  if (below >= minHeight || below >= above) {
    return {
      side: 'below',
      offset: anchor.y + anchor.height + gap,
      available: below,
      covers: false,
    }
  }
  return { side: 'above', offset: windowHeight - anchor.y + gap, available: above, covers: false }
}
