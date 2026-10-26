/**
 * The panes `AdaptiveShell` draws, apart from the hooks that read them so that a test can import
 * them without the UI package.
 */

/** Where a screen is being drawn, as `AdaptiveShell` laid it out. */
export interface Pane {
  /** Drawn beside the conversation list, which is then the way back. */
  besideList: boolean
  /**
   * Which of the window's top corners the pane's top bar runs into, by reading direction: a
   * resizable iPad window draws its controls in one of them.
   */
  corners: 'start' | 'end' | 'both'
}

export const SOLE_PANE: Pane = { besideList: false, corners: 'both' }
export const LIST_PANE: Pane = { besideList: false, corners: 'start' }
export const DETAIL_PANE: Pane = { besideList: true, corners: 'end' }
