import { mediaKindOf } from '@session/basic-types'
import { requirePorts } from '@session/app'
import { useMemo, type ReactNode } from 'react'
import type { Attachment, AutoDownload, Message } from '@session/client'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import { AttachmentAlbum, type AlbumItem } from '@session/ui'

import type { Fetch } from './attachmentFetch'
import { mayResolve } from './autoDownload'
import { viewableAttachments } from './viewableAttachments'

/**
 * As wide as a bubble is allowed to be.
 *
 * A number here and not a constant shared with the bubble, because the bubble's own width is a
 * percentage of the pane and nothing measures it yet. When something does, this takes it as a
 * prop - the album has never been the thing that decides how wide a message is.
 */
export const ALBUM_WIDTH = 240

/**
 * One message's pictures, as an album.
 *
 * Everything that has to ask something is here: the urls come from the media port, the overflow
 * count from the catalogue, and `@session/ui` takes both already answered.
 */
export function MessageAlbum({
  message,
  onOpen,
  control,
  autoDownload,
  fetchFor,
}: {
  message: Message
  /** Takes the attachment's index in the message. */
  onOpen: (index: number) => void
  /** The set's own control, drawn over the box the layout names. */
  control?: ReactNode | undefined
  /** What this conversation fetches unasked. Undefined means nobody has been asked. */
  autoDownload?: AutoDownload | undefined
  fetchFor: (attachment: Attachment) => Fetch
}) {
  const viewable = useMemo(() => viewableAttachments(message), [message])
  // A url is withheld while its last fetch has failed: an image that errored does not load again
  // under the same url, so a retry has to hand it over afresh. Joined into a string so the memo
  // below sees a change only when which ones failed does.
  const failedKey = viewable
    .filter((attachment) => fetchFor(attachment).state === 'failed')
    .map((attachment) => String(attachment.index))
    .join()
  // Which a press would download rather than open: see `MessageAttachments`' `onOpen`.
  const fetchableKey = viewable
    .filter((attachment) => ['idle', 'failed'].includes(fetchFor(attachment).state))
    .map((attachment) => String(attachment.index))
    .join()
  // Memoised so the album's memoised tiles keep their items until the message or setting changes.
  const items = useMemo((): AlbumItem[] => {
    const failed = new Set(failedKey.split(','))
    const fetchable = new Set(fetchableKey.split(','))
    return viewable.map((attachment) => ({
      // Undefined rather than null where this is not ours to fetch: null says the platform has
      // no resolver, and this says the person has not agreed to spend the data. Both draw the
      // placeholder, and the set's control is what offers to change it.
      uri:
        mayResolve(attachment, autoDownload) && !failed.has(String(attachment.index))
          ? requirePorts().media.urlFor({ messageId: message.id, index: attachment.index })
          : undefined,
      kind: mediaKindOf(attachment.contentType),
      // Its own URL rather than pixels on the frame stream, so a placeholder reaches the
      // screen by the route a picture does. Null where the platform has no resolver.
      preview: attachment.hasPreview
        ? requirePorts().media.previewUrlFor({ messageId: message.id, index: attachment.index })
        : undefined,
      fetchesOnOpen: fetchable.has(String(attachment.index)),
      testID: ELEMENT.conversation.attachmentImage,
    }))
  }, [viewable, message.id, autoDownload, failedKey, fetchableKey])

  return (
    <AttachmentAlbum
      items={items}
      width={ALBUM_WIDTH}
      overflowLabel={(count) => tr('andMore', { count })}
      onOpen={(at) => {
        const attachment = viewable[at]
        if (attachment !== undefined) onOpen(attachment.index)
      }}
      control={control}
      fetchLabel={tr('download')}
      fetchTestID={ELEMENT.conversation.attachmentFetch}
      testID={ELEMENT.conversation.attachment}
    />
  )
}
