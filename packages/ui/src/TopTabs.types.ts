export interface TopTab {
  /** Identifies the tab to whoever is holding the state. Never shown. */
  key: string
  label: string
  testID?: string
  /**
   * Shown but not selectable, for a way in this device cannot offer: the label stays so that the
   * screen reads the same everywhere and says what is missing, rather than a tab that appears on
   * one phone and not another.
   */
  disabled?: boolean | undefined
}

export interface TopTabsProps {
  tabs: TopTab[]
  active: string
  onChange: (key: string) => void
  /** Move the indicator rather than sliding it. See the `disableAnimations` flag. */
  instant?: boolean
}
