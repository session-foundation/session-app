import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTimeout } from '#src/useTimeout'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('a timeout owned by a component', () => {
  it('runs after the delay', () => {
    const run = vi.fn()
    const { result } = renderHook(() => useTimeout())
    result.current(run, 1000)
    vi.advanceTimersByTime(999)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledOnce()
  })

  it('replaces a pending one when scheduled again', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { result } = renderHook(() => useTimeout())
    result.current(first, 1000)
    result.current(second, 1000)
    vi.advanceTimersByTime(1000)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })

  it('never runs once the component has unmounted', () => {
    const run = vi.fn()
    const { result, unmount } = renderHook(() => useTimeout())
    result.current(run, 1000)
    unmount()
    vi.advanceTimersByTime(1000)
    expect(run).not.toHaveBeenCalled()
  })
})
