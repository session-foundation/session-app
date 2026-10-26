import { ConversationListScreen, NoSelectionPane, useLocale } from '@session/screens'
import { useMedia } from '@session/ui'

/**
 * The list on a phone, where it is the whole screen. On a tablet the shell keeps the list beside
 * the routes (see `src/shell.tsx`), so this pane is the one beside it, with nothing open yet.
 *
 * The launch screen, onboarding and a failed start are the shell's, ahead of every route.
 */
export default function IndexRoute() {
  useLocale()
  const media = useMedia()
  return media.gtSm ? <NoSelectionPane /> : <ConversationListScreen />
}
