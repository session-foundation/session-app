import { ELEMENT } from '@session/test-ids'
import { fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MediaViewer, type MediaViewerItem } from '#src/MediaViewer'

import { renderInUI } from './support/render'

function viewer(items: readonly MediaViewerItem[], open = true) {
  return renderInUI(viewerElement(items, open))
}

function viewerElement(
  items: readonly MediaViewerItem[],
  open: boolean,
  { index = 0, onIndex = () => {} }: { index?: number; onIndex?: (index: number) => void } = {},
) {
  return (
    <MediaViewer
      open={open}
      items={items}
      index={index}
      onIndex={onIndex}
      onClose={() => {}}
      onExport={() => {}}
      positionLabel="1 / 1"
      unavailableLabel="Not supported"
      failedLabel="Unable to open"
      preparingLabel="Loading..."
      closeLabel="Close"
      exportLabel="Export"
      previousLabel="Previous"
      nextLabel="Next"
      testID={ELEMENT.conversation.mediaViewer}
      closeTestID={ELEMENT.conversation.mediaViewerClose}
      exportTestID={ELEMENT.conversation.mediaViewerExport}
      previousTestID={ELEMENT.conversation.mediaViewerPrevious}
      nextTestID={ELEMENT.conversation.mediaViewerNext}
      imageTestID={ELEMENT.conversation.mediaViewerImage}
    />
  )
}

describe('the viewer on a picture still being made', () => {
  it('says it is loading and loads the url that asks for it, out of sight', () => {
    const { getByText, baseElement } = viewer([{ uri: null, preparing: 'rendition://7/2' }])
    expect(getByText('Loading...')).toBeTruthy()
    expect(baseElement.querySelector('img[src="rendition://7/2"]')).not.toBeNull()
  })

  it('says it cannot open a picture that will never be made, rather than loading', () => {
    const { getByText, queryByText } = viewer([{ uri: null, failed: true }])
    expect(getByText('Unable to open')).toBeTruthy()
    expect(queryByText('Loading...')).toBeNull()
  })

  it('says a picture with no resolver is not supported, rather than loading', () => {
    const { getByText } = viewer([{ uri: null }])
    expect(getByText('Not supported')).toBeTruthy()
  })
})

describe('the viewer opening and closing', () => {
  const picture: MediaViewerItem = { uri: 'file:///harbour.jpg' }
  const image = (base: HTMLElement) => base.querySelector('img[src="file:///harbour.jpg"]')

  it('still draws its picture as it closes, so the fade has something to fade', () => {
    const { baseElement, rerender } = viewer([picture])
    rerender(viewerElement([picture], false))
    expect(image(baseElement)).not.toBeNull()
  })
})

describe('the viewer paged from the keyboard', () => {
  const pictures: readonly MediaViewerItem[] = [
    { uri: 'file:///one.jpg' },
    { uri: 'file:///two.jpg' },
    { uri: 'file:///three.jpg' },
  ]

  it('pages forward and back with the arrow keys', () => {
    const onIndex = vi.fn()
    renderInUI(viewerElement(pictures, true, { index: 1, onIndex }))
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    expect(onIndex.mock.calls).toEqual([[2], [0]])
  })

  it('leaves an arrow held with a modifier to the system', () => {
    const onIndex = vi.fn()
    renderInUI(viewerElement(pictures, true, { index: 1, onIndex }))
    fireEvent.keyDown(document, { key: 'ArrowRight', altKey: true })
    fireEvent.keyDown(document, { key: 'ArrowRight', metaKey: true })
    expect(onIndex).not.toHaveBeenCalled()
  })

  it('stops listening once closed', () => {
    const onIndex = vi.fn()
    const { rerender } = renderInUI(viewerElement(pictures, true, { index: 1, onIndex }))
    rerender(viewerElement(pictures, false, { index: 1, onIndex }))
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(onIndex).not.toHaveBeenCalled()
  })
})
