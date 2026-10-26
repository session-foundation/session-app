import { requirePorts } from '@session/app'
import { ALBUM_WIDTH } from '@session/basic-types'
import { useCallback, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import type { Attachment, Message } from '@session/client'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import { AttachmentAlbum, type AlbumItem } from '@session/ui'

import type { Fetch, FetchState } from './attachmentFetch'
import type { AttachmentSetState } from './attachmentSet'
import { rowVerb, verbLabel } from './attachmentPress'
import { albumTileName } from './albumTileName'
import { PENDING_COPY } from './pendingCopy'
import { useLocale } from './useLocale'
import { leadUri, viewableAttachments } from './viewableAttachments'

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
  fetchFor,
  setState,
  onAccent,
}: {
  message: Message
  /** Takes the attachment's index in the message. */
  onOpen: (index: number) => void
  /** The set's own control, drawn over the box the layout names. */
  control?: ReactNode | undefined
  fetchFor: (attachment: Attachment) => Fetch
  /** The whole set's state, whose verb the cloud says, as the footer does. */
  setState: AttachmentSetState
  /** Drawn on a bubble you sent. */
  onAccent: boolean
}) {
  const viewable = useMemo(() => viewableAttachments(message), [message])
  // The labels are the catalogue's, which a memo would otherwise hold in the last language.
  const locale = useLocale()
  const statesKey = viewable.map((attachment) => fetchFor(attachment).state).join()
  // Memoised so the album's memoised tiles keep their items until the message or a state changes.
  const items = useMemo((): AlbumItem[] => {
    const states = statesKey.split(',') as FetchState[]
    return viewable.map((attachment, at) => {
      const state = states[at] ?? 'idle'
      // A tile is always a picture the viewer shows, and does what such a row does: see
      // `MessageAttachments`' `onOpen`.
      const verb = rowVerb(state, true)
      return {
        uri: leadUri(message.id, attachment, state),
        // Its own URL rather than pixels on the frame stream, so a placeholder reaches the
        // screen by the route a picture does. Null where the platform has no resolver.
        thumbhash: attachment.hasThumbhash
          ? requirePorts().media.thumbhashUrlFor({ messageId: message.id, index: attachment.index })
          : undefined,
        fetchesOnOpen: state === 'idle' || state === 'failed',
        testID: ELEMENT.conversation.attachmentImage,
        label: albumTileName(attachment.filename, at, viewable.length),
        hint: verb === null ? undefined : verbLabel(verb),
        transferring: state === 'fetching',
      }
    })
  }, [viewable, message.id, statesKey, locale])

  // The caller's `onOpen` is new on every transfer report; read through a ref, the album's memoised
  // tiles get one callback until the message changes.
  const latestOnOpen = useRef(onOpen)
  useLayoutEffect(() => {
    latestOnOpen.current = onOpen
  })
  const openAt = useCallback(
    (at: number) => {
      const attachment = viewable[at]
      if (attachment !== undefined) latestOnOpen.current(attachment.index)
    },
    [viewable],
  )

  return (
    <AttachmentAlbum
      items={items}
      width={ALBUM_WIDTH}
      overflowLabel={(count) => tr('andMore', { count })}
      overflowName={PENDING_COPY.attachmentNameAndMore}
      onOpen={openAt}
      control={control}
      fetchLabel={setState === 'failed' ? tr('retry') : tr('download')}
      fetchTestID={ELEMENT.conversation.attachmentFetch}
      tileTestID={ELEMENT.conversation.attachmentTile}
      onAccent={onAccent}
      testID={ELEMENT.conversation.attachment}
    />
  )
}
