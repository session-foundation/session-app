import { ALBUM_WIDTH } from '@session/basic-types'
import { act } from '@testing-library/react'
import { createElement } from 'react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { memoryPorts, resetPorts, setPorts } from '@session/app'
import type { Attachment, Message } from '@session/client'
import {
  ALBUM_PICTURE_ID,
  ALBUM_TILE_ID,
  albumTile,
  FETCH_HINT_ID,
  fetchHint,
  pictureVerb,
  setFetchName,
  verbName,
} from '@session/expectations'
import { resetLocale, setLocale, tr, PENDING_COPY } from '@session/localization'
import { byId, nodeOf } from '@session/render-tier'
import { ALBUM_MAX_TILES, type AttachmentAlbumProps } from '@session/ui'
import type * as Ui from '@session/ui'

import type { FetchState } from '#src/attachmentFetch'
import type { AttachmentSetState } from '#src/attachmentSet'
import { MessageAlbum } from '#src/MessageAlbum'

import { renderScreen } from './support/render'

/** What `AttachmentAlbum` was handed on each render, to see which props kept their identity. */
const albumProps = vi.hoisted((): AttachmentAlbumProps[] => [])

vi.mock('@session/ui', async (original) => {
  const ui = await original<typeof Ui>()
  return {
    ...ui,
    AttachmentAlbum: (props: AttachmentAlbumProps) => {
      albumProps.push(props)
      return createElement(ui.AttachmentAlbum, props)
    },
  }
})

function picture(index: number, filename?: string): Attachment {
  return {
    index,
    contentType: 'image/jpeg',
    ...(filename === undefined ? {} : { filename }),
    voiceMessage: false,
    hasThumbhash: false,
    hasThumbnail: false,
    thumbnailWidthPx: 0,
    thumbnailHeightPx: 0,
    hasRendition: false,
    renditionRefused: false,
    originalFile: false,
    uploaded: true,
    availability: 'absent',
    fetchDoneBytes: 0,
    fetchTotalBytes: 0,
  }
}

function message(attachments: Attachment[]): Message {
  return { id: 7, attachments } as unknown as Message
}

function album(
  shown: Message,
  states: FetchState[],
  {
    onOpen = () => {},
    setState = 'idle',
    onReply,
  }: {
    onOpen?: (index: number) => void
    setState?: AttachmentSetState
    onReply?: () => void
  } = {},
) {
  return (
    <MessageAlbum
      message={shown}
      width={ALBUM_WIDTH}
      onOpen={onOpen}
      fetchFor={(attachment) => ({
        state: states[attachment.index] ?? 'idle',
        doneBytes: 0,
        totalBytes: 0,
      })}
      setState={setState}
      onAccent={false}
      onReply={onReply}
    />
  )
}

afterEach(() => {
  act(() => {
    resetLocale()
  })
  resetPorts()
})

describe('an album’s tiles', () => {
  it('are named by their picture and hint what a press does in each one’s own state', () => {
    const states: FetchState[] = ['idle', 'fetching', 'ready', 'failed', 'unavailable']
    const shown = message(states.map((_, at) => picture(at, `p${String(at)}.jpg`)))
    renderScreen(album(shown, states))
    states.forEach((state, at) => {
      const verb = pictureVerb(state)
      expect(nodeOf(ALBUM_TILE_ID, at)).toMatchObject(
        albumTile({
          name: `p${String(at)}.jpg`,
          hint: verb === null ? undefined : verbName(verb),
          transferring: state === 'fetching',
        }).desktop!,
      )
    })
  })

  it('are named by their place among every picture the album stands for, where unnamed', () => {
    const shown = message([picture(0), picture(1, 'harbour.jpg'), picture(2)])
    renderScreen(album(shown, []))
    expect(nodeOf(ALBUM_TILE_ID, 0)?.name).toBe(PENDING_COPY.attachmentImagePosition(1, 3))
    expect(nodeOf(ALBUM_TILE_ID, 2)?.name).toBe(PENDING_COPY.attachmentImagePosition(3, 3))
  })

  it('name the tile under "+N" by the overflow too', () => {
    const count = ALBUM_MAX_TILES + 3
    const shown = message(
      Array.from({ length: count }, (_, at) => picture(at, `p${String(at)}.jpg`)),
    )
    renderScreen(album(shown, []))
    const last = ALBUM_MAX_TILES - 1
    expect(nodeOf(ALBUM_TILE_ID, last)?.name).toBe(
      PENDING_COPY.attachmentNameAndMore(`p${String(last)}.jpg`, count - ALBUM_MAX_TILES),
    )
  })

  it('are hinted again in the new language when it changes', () => {
    renderScreen(album(message([picture(0, 'a.jpg'), picture(1, 'b.jpg')]), []))
    act(() => {
      setLocale('fr')
    })
    expect(tr('download')).not.toBe('Download')
    expect(nodeOf(ALBUM_TILE_ID, 0)?.hint).toBe(tr('download'))
  })

  it('open the attachment at their place in the message, from the latest callback', async () => {
    const user = userEvent.setup()
    const first = vi.fn()
    const latest = vi.fn()
    const shown = message([picture(0, 'a.jpg'), picture(1, 'b.jpg')])
    const { rerender } = renderScreen(album(shown, ['ready', 'ready'], { onOpen: first }))
    rerender(album(shown, ['ready', 'ready'], { onOpen: latest }))
    await user.click(byId(ALBUM_TILE_ID, 1))
    expect(first).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledWith(1)
  })

  it('keep their props while a transfer reports, so the memoised tiles do not redraw', () => {
    const shown = message([picture(0, 'a.jpg'), picture(1, 'b.jpg')])
    const { rerender } = renderScreen(album(shown, ['fetching', 'ready'], { onOpen: vi.fn() }))
    const before = albumProps.at(-1)
    // A progress report: a new caller callback, and no tile's state changed.
    rerender(album(shown, ['fetching', 'ready'], { onOpen: vi.fn() }))
    const after = albumProps.at(-1)
    expect(after).not.toBe(before)
    expect(after?.onOpen).toBe(before?.onOpen)
    expect(after?.items).toBe(before?.items)
  })

  it('carry the tile id, with the picture id on the picture inside', () => {
    setPorts(
      memoryPorts({
        media: {
          urlFor: () => null,
          thumbhashUrlFor: () => null,
          renditionUrlFor: () => null,
          thumbnailUrlFor: ({ index }) => `file:///thumbnail-${String(index)}.jpg`,
        },
      }),
    )
    const thumbnailed = (index: number) => ({ ...picture(index, 'a.jpg'), hasThumbnail: true })
    renderScreen(album(message([thumbnailed(0), thumbnailed(1)]), ['ready', 'ready']))
    for (const at of [0, 1]) {
      const tile = byId(ALBUM_TILE_ID, at)
      expect(tile.querySelector(`[data-testid="${ALBUM_PICTURE_ID}"]`)).not.toBeNull()
    }
  })
})

describe('an album’s cloud', () => {
  it.each<AttachmentSetState>(['idle', 'failed'])(
    'says the set’s verb while the set is %s',
    (setState) => {
      const shown = message([picture(0, 'a.jpg'), picture(1, 'b.jpg')])
      renderScreen(album(shown, [setState === 'failed' ? 'failed' : 'idle', 'idle'], { setState }))
      expect(nodeOf(FETCH_HINT_ID)).toMatchObject(
        fetchHint({ name: setFetchName(setState === 'failed') }).desktop!,
      )
    },
  )
})

describe('Reply on an album, for a screen reader', () => {
  const shown = message([picture(0), picture(1)])

  it('is handed to the tiles already worded, and runs the latest handler', () => {
    const first = vi.fn()
    const latest = vi.fn()
    const { rerender } = renderScreen(album(shown, ['ready', 'ready'], { onReply: first }))
    const before = albumProps.at(-1)?.reply
    expect(before?.label).toBe(tr('reply'))

    rerender(album(shown, ['ready', 'ready'], { onReply: latest }))
    // The same object, so the memoised tiles are not drawn again for it.
    expect(albumProps.at(-1)?.reply).toBe(before)
    before?.run()
    expect(first).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledTimes(1)
  })

  it('is absent for a message that cannot be answered', () => {
    renderScreen(album(shown, ['ready', 'ready']))
    expect(albumProps.at(-1)?.reply).toBeUndefined()
  })
})
