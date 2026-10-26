import { isWeb } from 'tamagui'

/**
 * Says what a press does, after the control's name. ARIA's only hint is `aria-description`, which
 * react-native does not read; tamagui hands each its own.
 */
export function pressHint(label: string | undefined) {
  if (label === undefined) return {}
  return isWeb ? { 'aria-description': label } : { accessibilityHint: label }
}
