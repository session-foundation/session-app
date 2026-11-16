import { YStack } from 'tamagui'

import { InteractionOverride } from '../../interactionOverride'
import { MessageFrame } from '../../MessageFrame'
import { MessageQuote } from '../../MessageQuote'
import { Text } from '../../Text'
import { defineStory } from '../story'
import { QUOTE_LABELS } from '../quoteLabels'
import { LONG } from './shared'

interface FrameRow {
  outgoing: boolean
  body: string
  /** Focused on every page, the right-to-left one included, which draws no forced states. */
  focused?: boolean
}

const FOCUSED = { hovered: false, pressed: false, focused: true } as const

function Frame({ outgoing, body }: FrameRow) {
  return (
    <MessageFrame
      outgoing={outgoing}
      focusable
      alignSelf={outgoing ? 'flex-end' : 'flex-start'}
      maxWidth="80%"
    >
      <Text size="$body" color={outgoing ? '$onAccent' : '$messageBubbleIncomingText'}>
        {body}
      </Text>
    </MessageFrame>
  )
}

/** A message the keyboard has reached: the ring sits outside the bubble, clear of its accent. */
export const messageFrameFocus = defineStory<FrameRow>({
  component: 'messageFrame',
  story: 'focus',
  width: 320,
  forced: ['focus'],
  sensitive: { accent: true, rtl: true },
  variants: {
    incoming: { outgoing: false, body: 'Are we still on for Thursday?' },
    outgoing: { outgoing: true, body: 'Yes, 7pm' },
    incomingLong: { outgoing: false, body: LONG },
    outgoingLong: { outgoing: true, body: LONG },
    incomingFocused: { outgoing: false, body: 'Are we still on for Thursday?', focused: true },
    outgoingFocused: { outgoing: true, body: 'Yes, 7pm', focused: true },
  },
  render: ({ focused = false, ...row }) => (
    // Room for the ring, which is drawn outside the frame.
    <YStack padding="$xs">
      {focused ? (
        <InteractionOverride.Provider value={FOCUSED}>
          <Frame {...row} />
        </InteractionOverride.Provider>
      ) : (
        <Frame {...row} />
      )}
    </YStack>
  ),
})

interface LandedRow {
  outgoing: boolean
  body: string
  /** Drawn with a quote above the body, as a reply that was landed on when walking back. */
  quoted?: string | undefined
}

function Landed({ outgoing, body, quoted }: LandedRow) {
  return (
    // Room round the frame, which the ring and its glow draw into.
    <YStack padding="$lg">
      <MessageFrame
        outgoing={outgoing}
        alignSelf={outgoing ? 'flex-end' : 'flex-start'}
        maxWidth="90%"
        highlightHeld
      >
        {quoted === undefined ? null : (
          <MessageQuote
            author="Bob"
            message={{ id: 1, outgoing: false, body: quoted, attachments: [] }}
            labels={QUOTE_LABELS}
            onAccent={outgoing}
          />
        )}
        <Text size="$body" color={outgoing ? '$onAccent' : '$messageBubbleIncomingText'}>
          {body}
        </Text>
      </MessageFrame>
    </YStack>
  )
}

/** A jump's landing, at the strength it starts from before it fades. */
export const messageFrameHighlight = defineStory<LandedRow>({
  component: 'messageFrame',
  story: 'highlight',
  width: 340,
  sensitive: { accent: true },
  variants: {
    incoming: { outgoing: false, body: 'Are we still on for Thursday?' },
    outgoing: { outgoing: true, body: 'Yes, 7pm' },
    reply: { outgoing: true, body: 'Agreed', quoted: 'Skip that one' },
    long: {
      outgoing: false,
      body:
        'I looked at the three flats on Saturday. The one near the station is the best value but ' +
        'the kitchen is tiny and the landlord wants six months up front.',
    },
  },
  render: (row) => <Landed {...row} />,
})
