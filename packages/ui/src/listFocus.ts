import { createContext, useCallback, useContext, useSyncExternalStore } from 'react'
import { isWeb } from 'tamagui'

/** Which row Tab enters a list on before any row has been focused. */
export type ListFocusEntry = 'first' | 'last'

/**
 * The row that is the list's one tab stop: the row last focused while it is drawn, otherwise the
 * drawn row nearest to it, or to the entry end when none was focused or it has gone.
 *
 * Nearest rather than exact because a long list draws only a window of its rows, and a stop that
 * is not drawn is no stop at all: Tab would skip the list.
 */
export function stopKey(
  keys: readonly string[],
  drawn: ReadonlySet<string>,
  active: string | null,
  entry: ListFocusEntry,
): string | null {
  if (active !== null && drawn.has(active)) return active
  const activeAt = active === null ? -1 : keys.indexOf(active)
  const target = activeAt !== -1 ? activeAt : entry === 'last' ? keys.length - 1 : 0
  let best: string | null = null
  let bestDistance = Infinity
  keys.forEach((key, index) => {
    if (!drawn.has(key)) return
    const distance = Math.abs(index - target)
    if (distance < bestDistance) {
      best = key
      bestDistance = distance
    }
  })
  return best
}

/** The key `delta` rows from `from`, or null past either end: the list does not wrap. */
export function stepKey(keys: readonly string[], from: string, delta: 1 | -1): string | null {
  const at = keys.indexOf(from)
  if (at === -1) return null
  return keys[at + delta] ?? null
}

interface WebScrollable {
  getScrollableNode?: () => HTMLElement | null
}

const TAB_MODIFIERS = ['altKey', 'ctrlKey', 'metaKey'] as const

/** Opens a row's menu, against the element that is the row's stop. */
export type ListRowMenu = (key: string, row: unknown) => void

function plain(event: KeyboardEvent): boolean {
  return !(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
}

/**
 * The keys that open a row's menu, pressed rather than held. Enter or Space as legacy Session
 * Desktop had them, on the row itself only: inside it they press the control that has focus. The
 * Menu key and Shift+F10 are the platform's, from anywhere in the row.
 */
function opensMenu(event: KeyboardEvent, row: HTMLElement): boolean {
  if (event.repeat) return false
  if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) return true
  return plain(event) && (event.key === 'Enter' || event.key === ' ') && event.target === row
}

/**
 * One list's roving tab stop, outside React's state so that moving it re-renders only the two
 * rows whose stop changes rather than every row the list holds.
 *
 * While focus is outside the list, the stop is chosen among the rows on screen, so Tab never
 * scrolls the list away from what is being read. A click in the list, on a row or between rows,
 * makes the row there (or the nearest) the one the next Tab lands on.
 *
 * Focus and keys are listened to on the list's scroller, once, and traced back to their row, so a
 * row carries no handlers of its own: only its tab index and the element that is its stop.
 */
export class ListFocus {
  private keys: readonly string[] = []
  private readonly drawn = new Map<string, HTMLElement>()
  private readonly onScreen = new Set<string>()
  private active: string | null = null
  private stop: string | null = null
  private holdsFocus = false
  /** The row a click in the list chose, until the next key or click. */
  private pointed: string | null = null
  private scroller: HTMLElement | null = null
  private observer: IntersectionObserver | null = null
  private readonly listeners = new Set<() => void>()
  /** Set by the list each render, so the latest is the one called. */
  rowMenu: ListRowMenu | null = null

  constructor(
    private readonly entry: ListFocusEntry,
    /** Up and Down step backwards through the data in an inverted list. */
    private readonly inverted: boolean,
  ) {}

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  readonly currentStop = () => this.stop

  /** The list's FlatList, or null when it goes. */
  readonly attach = (list: unknown) => {
    this.detach()
    const scroller = (list as WebScrollable | null)?.getScrollableNode?.() ?? null
    if (scroller === null) return
    this.scroller = scroller
    scroller.addEventListener('focusin', this.onFocusIn)
    scroller.addEventListener('focusout', this.onFocusOut)
    scroller.addEventListener('keydown', this.onRowKeyDown)
    const page = scroller.ownerDocument
    page.addEventListener('pointerdown', this.onPointerDown, true)
    page.addEventListener('keydown', this.onKeyDown, true)
    if (typeof IntersectionObserver === 'function') {
      this.observer = new IntersectionObserver(this.onIntersect, { root: scroller })
      this.drawn.forEach((node) => {
        this.observer?.observe(node)
      })
    }
  }

  private detach() {
    const scroller = this.scroller
    if (scroller === null) return
    scroller.removeEventListener('focusin', this.onFocusIn)
    scroller.removeEventListener('focusout', this.onFocusOut)
    scroller.removeEventListener('keydown', this.onRowKeyDown)
    scroller.ownerDocument.removeEventListener('pointerdown', this.onPointerDown, true)
    scroller.ownerDocument.removeEventListener('keydown', this.onKeyDown, true)
    this.observer?.disconnect()
    this.observer = null
    this.onScreen.clear()
    this.scroller = null
  }

  setKeys(keys: readonly string[]) {
    this.keys = keys
    this.update()
  }

  draw(key: string, node: HTMLElement | null) {
    const was = this.drawn.get(key)
    if (was !== undefined) this.observer?.unobserve(was)
    if (node === null) {
      this.drawn.delete(key)
      this.onScreen.delete(key)
    } else {
      this.drawn.set(key, node)
      this.observer?.observe(node)
    }
    this.update()
  }

  focused(key: string) {
    this.active = key
    this.update()
  }

  /** Moves focus to the row a step away in the direction drawn. False at either end. */
  move(from: string, step: 'up' | 'down'): boolean {
    const down = step === 'down' ? !this.inverted : this.inverted
    const next = stepKey(this.keys, from, down ? 1 : -1)
    // A neighbour of a focused row is drawn: the window is many screens around what is in view.
    const node = next === null ? undefined : this.drawn.get(next)
    if (node === undefined) return false
    node.focus({ preventScroll: true })
    node.scrollIntoView({ block: 'nearest' })
    return true
  }

  /** Moves keyboard focus to a row's stop, where it is; false while the row is not drawn. */
  focusRow(key: string): boolean {
    const node = this.drawn.get(key)
    if (node === undefined) return false
    node.focus({ preventScroll: true })
    return true
  }

  private keyOf(node: HTMLElement): string | null {
    for (const [key, drawn] of this.drawn) if (drawn === node) return key
    return null
  }

  /** The row whose stop holds `target`: the row a control inside it belongs to. */
  private rowOf(target: EventTarget | null): string | null {
    if (!(target instanceof Node)) return null
    for (const [key, node] of this.drawn) if (node.contains(target)) return key
    return null
  }

  private readonly onIntersect = (entries: IntersectionObserverEntry[]) => {
    for (const entry of entries) {
      const key = this.keyOf(entry.target as HTMLElement)
      if (key === null) continue
      if (entry.isIntersecting) this.onScreen.add(key)
      else this.onScreen.delete(key)
    }
    this.update()
  }

  private readonly onFocusIn = (event: FocusEvent) => {
    this.holdsFocus = true
    const key = this.rowOf(event.target)
    if (key !== null) this.focused(key)
  }

  /**
   * Up and Down from a row or anything in it, and the keys that open its menu. A key added here
   * goes in the list of shortcuts too, `keyboardShortcuts.ts` in the screens package.
   */
  private readonly onRowKeyDown = (event: KeyboardEvent) => {
    const key = this.rowOf(event.target)
    const row = key === null ? undefined : this.drawn.get(key)
    if (key === null || row === undefined) return
    if (this.rowMenu !== null && opensMenu(event, row)) {
      // Also keeps the Menu key's own context menu from opening.
      event.preventDefault()
      this.rowMenu(key, row)
      return
    }
    if (!plain(event) || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
    // At either end too: the scroller would otherwise move away from the focused row.
    event.preventDefault()
    this.move(key, event.key === 'ArrowUp' ? 'up' : 'down')
  }

  private readonly onFocusOut = (event: FocusEvent) => {
    const next = event.relatedTarget
    this.holdsFocus = next instanceof Node && this.scroller?.contains(next) === true
    this.update()
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    const target = event.target
    if (!(target instanceof Node) || this.scroller?.contains(target) !== true) {
      this.pointed = null
      return
    }
    this.pointed = this.rowAt(target, event.clientY)
    if (this.pointed === null) return
    this.active = this.pointed
    this.update()
  }

  /** The row holding `target`, or the row on screen nearest to `y` when it is between rows. */
  private rowAt(target: Node, y: number): string | null {
    let nearest: string | null = null
    let nearestDistance = Infinity
    for (const [key, node] of this.drawn) {
      if (node.contains(target)) return key
      if (!this.onScreen.has(key)) continue
      const { top, bottom } = node.getBoundingClientRect()
      const distance = y < top ? top - y : y > bottom ? y - bottom : 0
      if (distance < nearestDistance) {
        nearest = key
        nearestDistance = distance
      }
    }
    return nearest
  }

  /**
   * Tab as the first key after a click in the list goes to the row the click chose. The browser
   * would otherwise start from the click: past the row when the click focused it, or from wherever
   * between rows it landed.
   */
  private readonly onKeyDown = (event: KeyboardEvent) => {
    const pointed = this.pointed
    this.pointed = null
    if (event.key !== 'Tab' || pointed === null) return
    if (TAB_MODIFIERS.some((modifier) => event[modifier])) return
    const node = this.drawn.get(pointed)
    const page = this.scroller?.ownerDocument
    const at = page?.activeElement ?? null
    if (node === undefined || !(at === null || at === page?.body || at === node)) return
    event.preventDefault()
    // Focused again so that this focus counts as the keyboard's and draws the ring.
    if (at === node) node.blur()
    node.focus()
  }

  private update() {
    const among =
      this.holdsFocus || this.onScreen.size === 0 ? new Set(this.drawn.keys()) : this.onScreen
    const stop = stopKey(this.keys, among, this.active, this.entry)
    if (stop === this.stop) return
    this.stop = stop
    this.listeners.forEach((listener) => {
      listener()
    })
  }
}

export const ListFocusContext = createContext<ListFocus | null>(null)

/** The key of the list row being drawn, for whatever inside it is that row's stop. */
export const ListRowKey = createContext<string | null>(null)

const noSubscription = () => () => {}

/** Whether the row drawing this is its list's tab stop; null outside a list with roving focus. */
function useIsStop(): boolean | null {
  const focus = useContext(ListFocusContext)
  const key = useContext(ListRowKey)
  // Per row, so only the two rows whose answer flips re-render when the stop moves.
  const isStopNow = useCallback(
    () => (focus === null || key === null ? null : focus.currentStop() === key),
    [focus, key],
  )
  const isStop = useSyncExternalStore(focus?.subscribe ?? noSubscription, isStopNow, isStopNow)
  return isWeb ? isStop : null
}

/**
 * The tab index for a control inside a list row: a stop only in the row that is the list's stop,
 * so Tab goes from that row into its own controls and then out of the list.
 */
export function useListTabIndex(): 0 | -1 {
  return useIsStop() === false ? -1 : 0
}

/**
 * What makes an element its row's stop in a list with roving focus: the tab index, and the ref the
 * list traces focus and keys back to the row by. Empty outside one, and on native, where a screen
 * reader moves between rows by its own gestures.
 */
export function useListStop() {
  const focus = useContext(ListFocusContext)
  const key = useContext(ListRowKey)
  const isStop = useIsStop()
  const ref = useCallback(
    (node: unknown) => {
      if (focus === null || key === null) return
      focus.draw(key, node as HTMLElement | null)
    },
    [focus, key],
  )
  if (isStop === null || focus === null || key === null) return null
  return { ref, tabIndex: isStop ? 0 : -1 } as const
}
