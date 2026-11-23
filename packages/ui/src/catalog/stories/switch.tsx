import { Switch } from '../../Switch'
import { defineStory } from '../story'
import { noop } from './shared'

/**
 * Off and on, each enabled and disabled. Its colours are the accent, the unfilled track and a
 * light thumb, so it is drawn in every theme and accent: the off track has to read as off against
 * the card in each. Right to left, on sits at the leading edge.
 */
export const switchStates = defineStory<{ value: boolean; disabled?: boolean }>({
  component: 'switch',
  story: 'states',
  width: 80,
  sensitive: { theme: true, accent: true, rtl: true },
  variants: {
    off: { value: false },
    on: { value: true },
    offDisabled: { value: false, disabled: true },
    onDisabled: { value: true, disabled: true },
  },
  render: ({ value, disabled }) => (
    <Switch
      value={value}
      disabled={disabled}
      onValueChange={noop}
      accessibilityLabel="Switch"
      testID="catalog-switch"
    />
  ),
})
