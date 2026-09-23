import { requirePorts } from '@session/app'
import type { Message } from '@session/client'
import { tr } from '@session/localization'
import { useSessionActions } from '@session/state'
import { ELEMENT } from '@session/test-ids'
import { MediaViewer, type MediaViewerItem } from '@session/ui'

import { exportOne } from './exportAttachment'
import { PENDING_COPY } from './pendingCopy'
import { viewableAttachments } from './viewableAttachments'

/**
 * The viewer, wired to one message.
 *
 * `MediaViewer` knows nothing about messages or ports: it takes resolved urls and worded labels,
 * because `@session/ui` reaches neither the catalogue nor `requirePorts`. Everything that has to
 * ask something is here.
 */
export function MessageMediaViewer({
  message,
  index,
  onIndex,
  onClose,
}: {
  message: Message
  /** Null when nothing is open, so the caller holds one piece of state rather than two. */
  index: number | null
  onIndex: (index: number) => void
  onClose: () => void
}) {
  const actions = useSessionActions()
  const viewable = viewableAttachments(message)

  const items: MediaViewerItem[] = viewable.map((attachment) => ({
    // Null where the platform has no resolver. The viewer says so rather than drawing a broken
    // picture, which is the one thing it must not do with somebody's photograph.
    uri: requirePorts().media.urlFor(message.id, attachment.index),
    kind: attachment.contentType?.startsWith('video/') === true ? 'video' : 'image',
  }))

  const at = index ?? 0
  const attachment = viewable[at]

  return (
    <MediaViewer
      open={index !== null}
      items={items}
      index={at}
      onIndex={onIndex}
      onClose={onClose}
      onExport={() => {
        if (attachment !== undefined) void exportOne(message, attachment.index, actions)
      }}
      // Nothing behind it yet: the row's own menu is where these live, and a second copy of it
      // belongs with that work rather than ahead of it.
      onMore={() => undefined}
      positionLabel={`${String(at + 1)} / ${String(items.length)}`}
      unavailableLabel={tr('attachmentsErrorNotSupported')}
      closeLabel={tr('close')}
      exportLabel={PENDING_COPY.export}
      moreLabel={tr('openMessageContextMenu')}
      // `back` rather than a `previous` the catalogue does not have. The pair reads as one
      // thing anyway: this steps back through the set and `next` steps forward through it.
      previousLabel={tr('back')}
      nextLabel={tr('next')}
      testID={ELEMENT.conversation.mediaViewer}
      closeTestID={ELEMENT.conversation.mediaViewerClose}
    />
  )
}
