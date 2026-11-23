import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SHOW_LOADING_AFTER_MS, useShowAfter } from '#src/useShowAfter'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('loading is said only once it has taken a while', () => {
  it('says nothing for a load that finishes before the delay', () => {
    const { result, rerender } = renderHook(({ active }) => useShowAfter(active), {
      initialProps: { active: true },
    })
    expect(result.current).toBe(false)
    act(() => {
      vi.advanceTimersByTime(SHOW_LOADING_AFTER_MS - 1)
    })
    expect(result.current).toBe(false)
    rerender({ active: false })
    act(() => {
      vi.advanceTimersByTime(SHOW_LOADING_AFTER_MS)
    })
    expect(result.current).toBe(false)
  })

  it('says so once the delay passes, and stops the moment it is done', () => {
    const { result, rerender } = renderHook(({ active }) => useShowAfter(active), {
      initialProps: { active: true },
    })
    act(() => {
      vi.advanceTimersByTime(SHOW_LOADING_AFTER_MS)
    })
    expect(result.current).toBe(true)
    rerender({ active: false })
    expect(result.current).toBe(false)
  })

  it('starts the delay again for the next load', () => {
    const { result, rerender } = renderHook(({ active }) => useShowAfter(active), {
      initialProps: { active: true },
    })
    act(() => {
      vi.advanceTimersByTime(SHOW_LOADING_AFTER_MS)
    })
    rerender({ active: false })
    rerender({ active: true })
    expect(result.current).toBe(false)
  })

  it('keeps saying so as a wait said at once becomes a load that is not', () => {
    const { result, rerender } = renderHook(
      ({ active, delayMs }) => useShowAfter(active, delayMs),
      { initialProps: { active: true, delayMs: 0 } },
    )
    act(() => {
      vi.advanceTimersByTime(0)
    })
    expect(result.current).toBe(true)
    rerender({ active: true, delayMs: SHOW_LOADING_AFTER_MS })
    expect(result.current).toBe(true)
  })
})
