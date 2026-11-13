import { useCallback, useEffect, useRef } from 'react'

/**
 * A `setTimeout` owned by the component: scheduling again replaces the pending one, and it is
 * cleared when the component unmounts, so nothing runs against a component that has gone.
 */
export function useTimeout(): (run: () => void, delayMs: number) => void {
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (pending.current !== null) clearTimeout(pending.current)
    },
    [],
  )
  return useCallback((run, delayMs) => {
    if (pending.current !== null) clearTimeout(pending.current)
    pending.current = setTimeout(() => {
      pending.current = null
      run()
    }, delayMs)
  }, [])
}
