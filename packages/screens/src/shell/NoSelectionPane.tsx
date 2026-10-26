import { YStack } from '@session/ui'

/**
 * The detail pane beside the list, with nothing open in it. One for every platform, so a tablet
 * and the desktop window can never show different empty states.
 *
 * TODO: draw legacy Desktop's no-selection state here. Until then the pane is left empty: the
 * catalogue has no words for it yet, and screens take every word from the catalogue.
 */
export function NoSelectionPane() {
  return <YStack flex={1} backgroundColor="$backgroundPrimary" />
}
