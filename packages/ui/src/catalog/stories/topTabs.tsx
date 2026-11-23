import { TopTabs } from '../../TopTabs'
import { defineStory } from '../story'
import { noop } from './shared'

/**
 * Either tab selected, and a tab the device cannot offer, as the restore screen draws the scanner's
 * on a phone with no camera. The indicator is the accent and a disabled label is the one tone
 * meant to sit below AA, so both are drawn in every theme and accent; right to left, the first tab
 * and the indicator under it sit at the leading edge.
 */
export const topTabs = defineStory<{ active: string; disabled?: boolean }>({
  component: 'topTabs',
  story: 'states',
  width: 360,
  sensitive: { theme: true, accent: true, rtl: true },
  variants: {
    first: { active: 'phrase' },
    second: { active: 'qr' },
    secondDisabled: { active: 'phrase', disabled: true },
  },
  render: ({ active, disabled }) => (
    <TopTabs
      active={active}
      instant
      onChange={noop}
      tabs={[
        { key: 'phrase', label: 'Recovery Password', testID: 'catalog-top-tab-phrase' },
        { key: 'qr', label: 'Scan QR Code', testID: 'catalog-top-tab-qr', disabled },
      ]}
    />
  ),
})
