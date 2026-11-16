import { useEffect, useRef } from 'react'

/**
 * The ref of a field that takes focus each time `focusSerial` changes to a new number; unset, or
 * on mount, it does not. See `InputProps.focusSerial`.
 */
export function useFocusSerial(focusSerial: number | undefined) {
  const field = useRef<{ focus: () => void } | null>(null)
  const focusedFor = useRef(focusSerial)
  useEffect(() => {
    if (focusSerial === focusedFor.current) return
    focusedFor.current = focusSerial
    if (focusSerial !== undefined) field.current?.focus()
  }, [focusSerial])
  return field
}
