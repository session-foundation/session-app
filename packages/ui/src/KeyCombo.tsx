import { XStack, YStack } from 'tamagui'

import { Icon } from './Icon'
import type { IconName } from './Icon.types'
import { SIZE_SCALE } from './scales'
import { Text } from './Text'

/** Whether keys are named as a Mac's keyboard prints them, or as a PC's. */
export type KeyNames = 'mac' | 'pc'

/**
 * A key, by what it does rather than what it is called. `mod` is the key a shortcut is held with:
 * Command on a Mac, Control elsewhere. `ctrl` is Control on both.
 */
export type KeyName =
  | 'mod'
  | 'ctrl'
  | 'shift'
  | 'alt'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'enter'
  | 'space'
  | 'f'
  | 'f11'
  | 'plus'
  | 'minus'
  | 'zero'
  | 'slash'

/**
 * The arrows as icons: as characters they are a hairline at caption size. The cap is named with
 * the character, which screen readers read as the arrow's name.
 */
const ICONS: Partial<Record<KeyName, IconName>> = {
  up: 'arrowUp',
  down: 'arrowDown',
  left: 'arrowLeft',
  right: 'arrowRight',
}

/** Legends as the keyboards print them, which no locale translates; the catalogue has none. */
const SHARED: Record<
  Exclude<KeyName, 'mod' | 'ctrl' | 'shift' | 'alt' | 'enter' | 'space'>,
  string
> = {
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  f: 'F',
  f11: 'F11',
  plus: '+',
  minus: '-',
  zero: '0',
  slash: '/',
}

const LEGENDS: Record<KeyNames, Record<KeyName, string>> = {
  mac: { ...SHARED, mod: '⌘', ctrl: '⌃', shift: '⇧', alt: '⌥', enter: 'Return', space: 'Space' },
  pc: {
    ...SHARED,
    mod: 'Ctrl',
    ctrl: 'Ctrl',
    shift: 'Shift',
    alt: 'Alt',
    enter: 'Enter',
    space: 'Space',
  },
}

export interface KeyComboProps {
  /** Held together, in the order they are pressed. */
  keys: readonly KeyName[]
  names: KeyNames
  testID: string
}

/**
 * One key combination, a cap per key.
 *
 * In reading order, so right to left in a right-to-left language. Caps with no `+` between them:
 * `Ctrl` `+` `+` would make the separator a key.
 */
export function KeyCombo({ keys, names, testID }: KeyComboProps) {
  return (
    <XStack gap="$2xs" testID={testID}>
      {keys.map((key) => {
        const icon = ICONS[key]
        return (
          <YStack
            key={key}
            minWidth={SIZE_SCALE.lg}
            minHeight={SIZE_SCALE.lg}
            paddingHorizontal="$xs"
            alignItems="center"
            justifyContent="center"
            {...(icon === undefined ? {} : { role: 'img', 'aria-label': LEGENDS[names][key] })}
            borderRadius="$sm"
            borderWidth={1}
            borderColor="$bordersColor"
            backgroundColor="$backgroundNested"
          >
            {icon === undefined ? (
              <Text size="$caption" weight="semibold">
                {LEGENDS[names][key]}
              </Text>
            ) : (
              <Icon name={icon} size="sm" color="$textPrimary" />
            )}
          </YStack>
        )
      })}
    </XStack>
  )
}
