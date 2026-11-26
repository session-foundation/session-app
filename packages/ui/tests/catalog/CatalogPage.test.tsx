import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CatalogPage } from '#src/catalog/CatalogPage'
import { catalogPages } from '#src/catalog/pages'
import { defineStory } from '#src/catalog/story'
import { Text } from '#src/Text'

import { declared } from '@session/render-tier'
import { renderInUI } from '../support/render'

const LONG = 'Failed before any file was up'

const story = defineStory<{ word: string }>({
  component: 'label',
  story: 'long',
  width: 120,
  variants: { [LONG]: { word: 'cell' }, phoneScreenshotNarrowWidest: { word: 'cell' } },
  render: ({ word }) => <Text>{word}</Text>,
})

describe('a catalog row’s label', () => {
  // The page waits on its fonts and pictures before it says it is ready; this DOM has neither.
  Object.defineProperty(document, 'fonts', {
    value: { ready: Promise.resolve() },
    configurable: true,
  })
  Object.defineProperty(document, 'images', { value: [], configurable: true })

  it('wraps rather than being cut to one line, inside a long key too', () => {
    const [page] = catalogPages('pr', [story])
    renderInUI(<CatalogPage page={page!} />)
    for (const row of [LONG, 'phoneScreenshotNarrowWidest']) {
      const label = declared(screen.getAllByText(row)[0]!)
      expect(label['text-overflow']).not.toBe('ellipsis')
      expect(label['white-space']).not.toBe('nowrap')
      expect(label['overflow-wrap']).toBe('anywhere')
    }
  })
})

describe('a catalog page that unmounts before its pictures load', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    Object.defineProperty(document, 'images', { value: [], configurable: true })
  })

  it('stops looking at the document', async () => {
    vi.useFakeTimers()
    // A picture whose source never answers: `decode` stays pending and it never completes.
    const stuck = { complete: false, src: 'stuck.png', decode: () => new Promise<void>(() => {}) }
    let readsAfterUnmount = 0
    let unmounted = false
    Object.defineProperty(document, 'images', {
      get: () => {
        if (unmounted) readsAfterUnmount++
        return [stuck]
      },
      configurable: true,
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const [page] = catalogPages('pr', [story])
    const { unmount } = renderInUI(<CatalogPage page={page!} />)
    await vi.advanceTimersByTimeAsync(500)
    unmount()
    unmounted = true
    await vi.advanceTimersByTimeAsync(20_000)
    expect(readsAfterUnmount).toBe(0)
    expect(warn).not.toHaveBeenCalled()
  })
})
