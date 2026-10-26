import { useNav } from '@session/app'
import { tr } from '@session/localization'
import type { ElementId } from '@session/test-ids'
import { backChevron, Button, Icon } from '@session/ui'

import { useShowsBack } from './shell/pane'

/**
 * The way back, drawn the same way everywhere.
 *
 * Three screens grew one of these independently and two of them said "Back" in a language the
 * third would not have. A chevron says it in none, which is the point: it is the affordance every
 * platform already uses for this, and it does not have to be translated, wrapped or measured
 * against a title beside it.
 *
 * `tr('back')` has not gone away, it has moved to the accessibility label - the word is still what
 * a screen reader should say, and an icon-only control that announces nothing is a control some
 * people cannot use.
 */
export function BackButton({ testID }: { testID: ElementId }) {
  const nav = useNav()
  const showsBack = useShowsBack()

  if (!showsBack) return null
  return (
    <Button
      variant="ghost"
      size="sm"
      onPress={() => nav.back()}
      testID={testID}
      accessibilityLabel={tr('back')}
      icon={<Icon name={backChevron()} size="md" color="$textPrimary" />}
    />
  )
}
