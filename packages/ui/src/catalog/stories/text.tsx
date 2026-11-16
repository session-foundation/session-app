import { Text } from '../../Text'
import { defineStory } from '../story'

export const textScale = defineStory<{
  size: '$caption' | '$label' | '$body' | '$title' | '$heading'
}>({
  component: 'text',
  story: 'scale',
  width: 320,
  sensitive: { rtl: true },
  variants: {
    caption: { size: '$caption' },
    label: { size: '$label' },
    body: { size: '$body' },
    title: { size: '$title' },
    heading: { size: '$heading' },
  },
  render: ({ size }) => <Text size={size}>The quick brown fox jumps over the sleeping dog</Text>,
})
