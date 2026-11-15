import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { pressArea } from '@session/expectations'
import { ELEMENT } from '@session/test-ids'

import { ComposerReply, type ComposerReplyProps } from '#src/ComposerReply'
import type { QuoteLabels } from '#src/quotePreview'

import { byId, nodeOf } from '@session/render-tier'
import { renderInUI } from './support/render'

const LABELS: QuoteLabels = {
  image: 'Image',
  gif: 'GIF',
  video: 'Video',
  audio: 'Audio',
  voice: 'Voice Message',
  file: 'Document',
  andMore: (count) => `+${String(count)}`,
  notFound: 'Original message not found',
}

const IDS = {
  bar: ELEMENT.conversation.composerReply,
  close: ELEMENT.conversation.composerReplyClose,
}

function bar(over: Partial<ComposerReplyProps> = {}): ComposerReplyProps {
  return {
    heading: 'Replying to Bob',
    message: { id: 3, outgoing: false, body: 'Are we still on?', attachments: [] },
    labels: LABELS,
    onClose: () => {},
    closeLabel: 'Close',
    testID: IDS.bar,
    closeTestID: IDS.close,
    ...over,
  }
}

describe('the composer’s reply bar', () => {
  it('says who is being answered and what they said', () => {
    renderInUI(<ComposerReply {...bar()} />)
    expect(byId(IDS.bar).textContent).toContain('Replying to Bob')
    expect(byId(IDS.bar).textContent).toContain('Are we still on?')
  })

  it('goes once the message it answers is gone', () => {
    renderInUI(<ComposerReply {...bar({ message: undefined })} />)
    expect(nodeOf(IDS.bar)).toBeNull()
  })

  it('stops replying from its close button, by the pointer or by the keyboard', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderInUI(<ComposerReply {...bar({ onClose })} />)
    expect(nodeOf(IDS.close)).toMatchObject(pressArea({ name: 'Close' }).desktop!)
    await user.click(byId(IDS.close))
    byId(IDS.close).focus()
    await user.keyboard('{Enter}')
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
