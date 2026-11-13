import { requirePorts } from '@session/app'
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import type { Attachment, Message } from '@session/client'
import { PENDING_COPY, tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import { AttachmentAlbum, type AlbumItem } from '@session/ui'

import type { Fetch, FetchState } from './attachmentFetch'
import type { AttachmentSetState } from './attachmentSet'
import { rowVerb, verbLabel } from './attachmentPress'
import { albumAspect } from './albumAspect'
import { albumTileName } from './albumTileName'
import { useLocale } from './useLocale'
import { isViewable, leadUri, viewerFit } from './viewableAttachments'

/**
 * One message's pictures, as an album.
 *
 * Everything that has to ask something is here: the urls come from the media port, the overflow
 * count from the catalogue, and `@session/ui` takes both already answered.
 */
export function MessageAlbum({
  message,
  width,
  loneMaxHeightPx,
  onOpen,
  fetchFor,
  setState,
  onAccent,
  onReply,
}: {
  message: Message
  /** The message's attachments' width, which the album fills. */
  width: number
  /** How tall a picture sent alone may be drawn: its layout's cap. */
  loneMaxHeightPx?: number | undefined
  /** Takes the attachment's index in the message. */
  onOpen: (index: number) => void
  fetchFor: (attachment: Attachment) => Fetch
  /** The whole set's state, whose verb the cloud says, as the footer does. */
  setState: AttachmentSetState
  /** Drawn on a bubble you sent. */
  onAccent: boolean
  /** Starts a reply to the message, from a tile's screen-reader action; absent where it cannot. */
  onReply?: (() => void) | undefined
}) {
  // Every picture, those sent as original files included: they draw a tile and export on a tap.
  const viewable = useMemo(() => message.attachments.filter(isViewable), [message])
  // The labels are the catalogue's, which a memo would otherwise hold in the last language.
  const locale = useLocale()
  const statesKey = viewable.map((attachment) => fetchFor(attachment).state).join()
  // Memoised so the album's memoised tiles keep their items until the message or a state changes.
  const items = useMemo((): AlbumItem[] => {
    const states = statesKey.split(',') as FetchState[]
    return viewable.map((attachment, at) => {
      const state = states[at] ?? 'idle'
      // A tile does what its row would: see `MessageAttachments`' `onOpen`.
      const verb = rowVerb(state, viewerFit(attachment))
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
        aspect: albumAspect(attachment),
        hint: verb === null ? undefined : verbLabel(verb),
        transferring: state === 'fetching',
      }
    })
  }, [viewable, message.id, statesKey, locale])

  // The caller's `onOpen` is new on every transfer report; read through a ref, the album's memoised
  // tiles get one callback until the message changes.
  const latestOnOpen = useRef(onOpen)
  const latestOnReply = useRef(onReply)
  useLayoutEffect(() => {
    latestOnOpen.current = onOpen
    latestOnReply.current = onReply
  })
  const replies = onReply !== undefined
  const reply = useMemo(
    () =>
      replies
        ? {
            label: tr('reply'),
            run: () => {
              latestOnReply.current?.()
            },
          }
        : undefined,
    // The label is the catalogue's, read again when the language changes.
    [replies, locale],
  )
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
      width={width}
      loneMaxHeightPx={loneMaxHeightPx}
      overflowLabel={(count) => tr('andMore', { count })}
      overflowName={PENDING_COPY.attachmentNameAndMore}
      onOpen={openAt}
      fetchLabel={setState === 'failed' ? tr('retry') : tr('download')}
      fetchTestID={ELEMENT.conversation.attachmentFetch}
      tileTestID={ELEMENT.conversation.attachmentTile}
      onAccent={onAccent}
      reply={reply}
      testID={ELEMENT.conversation.attachment}
    />
  )
}
