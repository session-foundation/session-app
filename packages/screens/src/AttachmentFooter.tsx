import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import { Text, XStack } from '@session/ui'

import type { AttachmentSet } from './attachmentSet'
import { formatBytes } from './formatBytes'

/**
 * The one line a message's attachments get, whatever they are doing.
 *
 * **Always drawn, and always the same height.** A footer that appeared when a download finished
 * would change the message's height at the moment somebody is reading it, and in a transcript
 * that moves everything below. Only the words and the verb change between states.
 *
 * Its scope is the message rather than the gallery: the count is every attachment, including the
 * ones behind "+N" that are never drawn.
 */
export function AttachmentFooter({
  set,
  onAction,
}: {
  set: AttachmentSet
  onAction: () => void
}) {
  const action = verb(set)
  return (
    <XStack
      height={FOOTER_HEIGHT}
      alignItems="center"
      gap="$xs"
      testID={ELEMENT.conversation.attachmentFooter}
    >
      <Text
        size="$caption"
        color="$textSecondary"
        flex={1}
        numberOfLines={1}
        testID={ELEMENT.conversation.attachmentState}
      >
        {caption(set)}
      </Text>
      {action === null ? null : (
        <Text
          size="$caption"
          weight="semibold"
          color={set.state === 'failed' ? '$dangerColor' : '$accentText'}
          testID={ELEMENT.conversation.attachmentAction}
          onPress={onAction}
        >
          {action}
        </Text>
      )}
    </XStack>
  )
}

/**
 * Tall enough for a caption and its touch target, and fixed.
 *
 * A number rather than letting the text set it: the whole point is that the height does not
 * change between states, and a line of copy that wraps in one locale would change it.
 */
const FOOTER_HEIGHT = 30

function caption(set: AttachmentSet): string {
  if (set.state === 'fetching') {
    // Indeterminate until the server says how big it is, which is what a total of 0 means - the
    // first report of any transfer is 0 of 0.
    if (set.total === 0) return tr('downloading')
    return `${formatBytes(set.done)} / ${formatBytes(set.total)}`
  }
  if (set.state === 'failed') return tr('failedToDownload')
  return set.size === undefined ? '' : formatBytes(set.size)
}

/**
 * The one thing this state offers, or null where it offers nothing.
 *
 * Null rather than a disabled word, and the height does not move either way. There is no verb
 * while a transfer runs because nothing can stop one yet - the bridge has no cancel - and none on
 * a set of several that has arrived, because saving them needs a directory to put them in and
 * offering one Save that quietly writes the first is worse than offering none.
 */
function verb(set: AttachmentSet): string | null {
  if (set.state === 'fetching') return null
  if (set.state === 'failed') return tr('retry')
  // `save` until the catalogue has a key for exporting; the two verbs are their own piece of work.
  if (set.state === 'ready') return set.count === 1 ? tr('save') : null
  return tr('download')
}
