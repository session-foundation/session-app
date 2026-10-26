export interface FileRowAction {
  name: 'activate' | 'lead' | 'control'
  label: string
  run: () => void
}

interface FileRowVerbs {
  onPress?: (() => void) | undefined
  pressLabel?: string | undefined
  onOpen?: (() => void) | undefined
  openLabel?: string | undefined
  onAction?: (() => void) | undefined
  actionLabel?: string | undefined
}

/** What the row is announced as on native, where it is the one element: `a.pdf, PDF, 2 MB`. */
export function fileRowAccessibleName(filename: string, format: string, caption: string): string {
  return [filename, format, caption].filter((part) => part !== '').join(', ')
}

/**
 * The row's verbs as native accessibility actions: its own press as `activate`, then the lead
 * square's and the control's where they say something the row's press does not. A row with no
 * press of its own takes its first verb as `activate`, so a double-tap still does something.
 */
export function fileRowActions(verbs: FileRowVerbs): FileRowAction[] {
  const actions: FileRowAction[] = []
  const said = new Set<string>()
  function offer(
    name: FileRowAction['name'],
    label: string | undefined,
    run: (() => void) | undefined,
  ): void {
    if (label === undefined || run === undefined || said.has(label)) return
    said.add(label)
    actions.push({ name, label, run })
  }
  offer('activate', verbs.pressLabel, verbs.onPress)
  offer('lead', verbs.openLabel, verbs.onOpen)
  offer('control', verbs.actionLabel, verbs.onAction)
  const [first] = actions
  if (verbs.onPress === undefined && first !== undefined)
    actions[0] = { ...first, name: 'activate' }
  return actions
}

/**
 * The actions to list as custom ones. A VoiceOver double-tap reaches `onAccessibilityTap` and never
 * `activate`, so on iOS listing it only repeats the hint; TalkBack maps `activate` to its click.
 */
export function listedFileRowActions(actions: FileRowAction[], os: string): FileRowAction[] {
  return os === 'ios' ? actions.filter(({ name }) => name !== 'activate') : actions
}
