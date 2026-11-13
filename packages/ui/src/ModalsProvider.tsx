import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { backAction, dismissFrom, popFrom, type StackedModal } from './modalStack'
import type { PanelWidth } from './modalPanelMetrics'

/** One page inside a modal. A modal always has at least one. */
export interface ModalScreen {
  /** Names the screen, for a caller that has to know whether it is the one showing. */
  id?: string | undefined
  /** Drawn in the modal's own header, so a screen does not draw a title of its own. */
  title: string
  render: () => ReactNode
  /** Actions along the bottom, outside the scrolling body. */
  footer?: () => ReactNode
}

export interface ModalPresentation {
  /**
   * A panel of screens, or a single alert. Defaults to `panel`. An alert is drawn as `Modal`'s
   * `AlertBox`, with its one screen's footer as the actions.
   */
  kind?: 'panel' | 'alert'
  /** Which of the three panel widths it draws at. Defaults to `normal`. */
  width?: PanelWidth
  /** An alert's own test ids. */
  testID?: string
  closeTestID?: string
  /**
   * Whether the scrim, Escape and the hardware back button may close it. Defaults to true. Its own
   * screens can still be walked back either way.
   */
  dismissible?: boolean
  /**
   * Whether an alert draws the cross in its corner. Defaults to `dismissible`. Turn it off when the
   * actions include a Cancel; the scrim still closes it, as Clear All Data's does.
   */
  showClose?: boolean
  /**
   * A wide window's panel as tall as its content, centred, up to the usual panel's height. For a
   * modal nothing is pushed onto: a push would move its edges. Defaults to false, the fixed height.
   */
  fit?: boolean
  /** The screen it opens on. Further screens arrive through `push`. */
  initial: ModalScreen
}

/**
 * A screen with a key of its own: every screen stays mounted, so one pushed in place of a popped
 * one must remount rather than inherit the old one's state.
 */
interface HeldScreen extends ModalScreen {
  key: string
}

/** A presented modal, with the screens it has been walked through. */
export interface OpenModal extends StackedModal {
  kind: 'panel' | 'alert'
  width: PanelWidth
  showClose: boolean
  fit: boolean
  testID?: string
  closeTestID?: string
  stack: HeldScreen[]
}

export interface Modals {
  /** Opens a modal over anything already open, and returns the id that closes it. */
  present: (presentation: ModalPresentation) => string
  /** Closes the named modal **and anything opened from it**. Unknown ids are ignored. */
  dismiss: (id: string) => void
  /** Pushes a screen onto the frontmost modal. */
  push: (screen: ModalScreen) => void
  /** Pops the frontmost modal's own screen stack, stopping at its first screen. */
  pop: () => void
  /**
   * Follows the platform: removes the named screen and those above it from the named modal, as a
   * native back gesture did. A screen already gone is ignored, so a dismissal the platform reports
   * for a pop that started here does not pop a second one.
   */
  popScreen: (modalId: string, screenKey: string) => void
  /** One level back: a screen if there is one to go back to, otherwise the modal. */
  back: () => void
  /** Closes everything, for a navigation that leaves the surface the modals belong to. */
  dismissAll: () => void
  /**
   * Makes the named modal non-dismissible, for a confirm whose action is running: leaving it then
   * implies a cancel that did not happen. Unknown ids are ignored.
   */
  lock: (id: string) => void
  /**
   * Draws the host's native modal afresh once, for a page that has just made the window secure,
   * and keeps it that way until every modal has closed.
   *
   * Android's secure flag is copied from the activity into react-native's `Modal` dialog when the
   * dialog is made, and not after. A tablet draws Settings in that dialog, so a page that turns
   * the flag on once Settings is open has to have the dialog made again to be covered by it.
   * A switch rather than a counter: the page is inside that dialog, so redrawing it mounts the page
   * again, and its second call must change nothing.
   */
  secureHost: () => void
}

const ModalsContext = createContext<Modals | null>(null)

/** Set by `secureHost`; the host keys its native modal by it. */
const HostSecuredContext = createContext(false)

/** Separate from `ModalsContext` so `useModals` callers do not re-render on every stack change. */
const EntriesContext = createContext<readonly OpenModal[]>([])

/**
 * Holds what is open over the page. Mount once at the app root, inside the store and the
 * navigator, since the screens it draws read both.
 */
export function ModalStackProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<readonly OpenModal[]>([])
  const [hostSecured, setHostSecured] = useState(false)
  // Back to an ordinary dialog once nothing is open, so the next one is made without the flag.
  if (hostSecured && entries.length === 0) setHostSecured(false)

  // Monotonic, so a stale close handler can never match a later modal.
  const nextId = useRef(0)

  const modals = useMemo<Modals>(() => {
    // Applies `change` to the frontmost modal; `null` leaves the stack unchanged.
    function mapTop(change: (entry: OpenModal) => OpenModal | null): void {
      setEntries((current) => {
        const top = current.at(-1)
        if (top === undefined) return current
        const replacement = change(top)
        return replacement === null ? current : [...current.slice(0, -1), replacement]
      })
    }

    return {
      present: ({
        initial,
        dismissible = true,
        width = 'normal',
        kind = 'panel',
        showClose = dismissible,
        fit = false,
        testID,
        closeTestID,
      }) => {
        const id = `modal-${String(nextId.current++)}`
        setEntries((current) => [
          ...current,
          {
            id,
            dismissible,
            width,
            kind,
            showClose,
            fit,
            ...(testID === undefined ? {} : { testID }),
            ...(closeTestID === undefined ? {} : { closeTestID }),
            screens: 1,
            stack: [{ ...initial, key: `screen-${String(nextId.current++)}` }],
          },
        ])
        return id
      },

      dismiss: (id) => {
        setEntries((current) => dismissFrom(current, id))
      },

      push: (screen) => {
        const key = `screen-${String(nextId.current++)}`
        mapTop((top) => ({
          ...top,
          screens: top.screens + 1,
          stack: [...top.stack, { ...screen, key }],
        }))
      },

      pop: () => {
        mapTop((top) =>
          top.stack.length <= 1
            ? null
            : { ...top, screens: top.screens - 1, stack: top.stack.slice(0, -1) },
        )
      },

      popScreen: (modalId, screenKey) => {
        setEntries((current) =>
          current.map((entry) => {
            if (entry.id !== modalId) return entry
            const stack = popFrom(entry.stack, screenKey)
            return stack.length === entry.stack.length
              ? entry
              : { ...entry, screens: stack.length, stack }
          }),
        )
      },

      back: () => {
        setEntries((current) => {
          const action = backAction(current)
          if (action.kind === 'none') return current
          if (action.kind === 'modal') return current.slice(0, -1)
          const top = current.at(-1)
          if (top === undefined || top.stack.length <= 1) return current
          return [
            ...current.slice(0, -1),
            { ...top, screens: top.screens - 1, stack: top.stack.slice(0, -1) },
          ]
        })
      },

      dismissAll: () => {
        setEntries([])
      },

      lock: (id) => {
        setEntries((current) =>
          current.map((entry) => (entry.id === id ? { ...entry, dismissible: false } : entry)),
        )
      },

      secureHost: () => {
        setHostSecured(true)
      },
    }
  }, [])

  return (
    <ModalsContext.Provider value={modals}>
      <HostSecuredContext.Provider value={hostSecured}>
        <EntriesContext.Provider value={entries}>{children}</EntriesContext.Provider>
      </HostSecuredContext.Provider>
    </ModalsContext.Provider>
  )
}

/** Opening and closing modals. Throws outside a `ModalStackProvider`, which is a wiring fault. */
export function useModals(): Modals {
  const modals = useContext(ModalsContext)
  if (modals === null)
    throw new Error('No ModalStackProvider. Wrap the app in <ModalStackProvider>.')
  return modals
}

/** Whether the host's native modal was drawn for a secure window. See `secureHost`. */
export function useHostSecured(): boolean {
  return useContext(HostSecuredContext)
}

/** What the host has to draw: every open modal, frontmost last. */
export function useModalEntries(): readonly OpenModal[] {
  return useContext(EntriesContext)
}

/** The frontmost modal's title and navigation, for a screen deep inside it. */
export function useModalNavigation(): {
  title: string
  canGoBack: boolean
  push: (screen: ModalScreen) => void
  back: () => void
} {
  const entries = useModalEntries()
  const modals = useModals()
  const top = entries.at(-1)
  const { push, back } = modals
  const stableBack = useCallback(() => {
    back()
  }, [back])
  return {
    title: top?.stack.at(-1)?.title ?? '',
    canGoBack: (top?.stack.length ?? 0) > 1,
    push,
    back: stableBack,
  }
}
