import { KeyCombo, type KeyComboProps } from '../../KeyCombo'
import { defineStory } from '../story'

/**
 * A Mac's glyphs and a PC's words, the longest of each, and arrows. Right to left too, where the
 * caps keep their order.
 */
export const keyCombo = defineStory<KeyComboProps>({
  component: 'keyCombo',
  story: 'variants',
  // Room for the longest, so a cell never wraps a combination.
  width: 200,
  sensitive: { rtl: true },
  variants: {
    mac: { keys: ['mod', 'slash'], names: 'mac', testID: 'catalog-key-combo-mac' },
    macLongest: {
      keys: ['ctrl', 'mod', 'f'],
      names: 'mac',
      testID: 'catalog-key-combo-mac-longest',
    },
    pc: { keys: ['mod', 'slash'], names: 'pc', testID: 'catalog-key-combo-pc' },
    pcLongest: {
      keys: ['ctrl', 'shift', 'f'],
      names: 'pc',
      testID: 'catalog-key-combo-pc-longest',
    },
    arrow: { keys: ['up'], names: 'pc', testID: 'catalog-key-combo-arrow' },
    word: { keys: ['enter'], names: 'mac', testID: 'catalog-key-combo-word' },
  },
  render: (props) => <KeyCombo {...props} />,
})
