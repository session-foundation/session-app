import { MessageRow, TranscriptWidth } from '@session/screens'
import { defineStory, type AnyStory } from '@session/ui/catalog'

import { useScenario } from './ScenarioProvider'

/** A row is a message of the `showcase` fixture, found by its body. */
interface ScenarioRow {
  body: string
}

function ScenarioMessage({ body }: ScenarioRow) {
  const scenario = useScenario()
  const messageId = scenario?.messageIds.get(body)
  if (scenario === null || messageId === undefined) return null
  // Measured as the conversation measures its transcript, so an album shrinks to fit a narrow cell
  // rather than drawing at its narrowest wherever it is.
  return (
    <TranscriptWidth>
      <MessageRow conversationId={scenario.conversationId} messageId={messageId} index={0} />
    </TranscriptWidth>
  )
}

const MESSAGE_WIDTH = 420

const message = (story: string, bodies: readonly string[], sensitive: AnyStory['sensitive']) =>
  defineStory<ScenarioRow>({
    component: 'message',
    story,
    width: MESSAGE_WIDTH,
    sensitive,
    variants: Object.fromEntries(bodies.map((body) => [body, { body }])),
    render: (row) => <ScenarioMessage {...row} />,
  })

export const MESSAGE_SCENARIOS: readonly AnyStory[] = [
  message(
    'albumShapes',
    [
      'One picture',
      'Three: one above two',
      'Twelve, so seven are behind the count',
      'Three with no hash to draw',
      'Five with no hash to draw',
    ],
    { responsive: true },
  ),
  message(
    'albumStates',
    ['Two, one above the other', 'Four in two rows', 'Five: two above three', 'Thirty-two'],
    {},
  ),
  // The footer's ring in the verb's place, at each reading, on a bubble received and on ours. The
  // capture asks for reduced motion, so the 0 of 0 ring's arc is held at the top of its closed
  // track.
  message(
    'albumDownloading',
    [
      'A pair for the ring at 0 of 0',
      'A pair for the ring at 40%',
      'A pair for the ring at 95%',
      'Ours from another device, for the ring at 0 of 0',
      'Ours from another device, for the ring at 40%',
      'Ours from another device, for the ring at 95%',
    ],
    { rtl: true },
  ),
  // The ring in every accent, on one received pair and one of ours: all six in every accent is a
  // page past the capture's height.
  message(
    'albumDownloadingAccent',
    ['A pair for the ring at 40%', 'Ours from another device, for the ring at 40%'],
    { accent: true },
  ),
  // A message's one attachment as a list: no control on the row, the footer's verb or ring alone,
  // ours uploading included.
  message(
    'loneFile',
    [
      'One file',
      'One file, caught downloading',
      'One picture as a list',
      'One picture as a list, caught downloading',
      'One file, caught uploading',
    ],
    { rtl: true },
  ),
  message(
    'files',
    [
      'A clip on its own',
      'Pictures and a clip',
      'Paperwork only',
      'A recording',
      'The whole roll',
      'One of these is gone',
      'Four of these five are gone',
    ],
    { rtl: true },
  ),
  // Ours, so drawn on the accent. Uploading, the moving file's row fills its ring; the footer's
  // ring waits while a file after it has not begun, since only then is the set's size known.
  message(
    'sending',
    [
      'Still uploading, one at a time',
      'File 31 of 32 failed',
      'Gallery whose 31st failed',
      'A file of this one went missing',
    ],
    { accent: true, rtl: true },
  ),
  // The footer's ring at a reading, once the last file is moving: a list and an album. Apart from
  // `sending`, which in every accent already fills the capture's height.
  message('uploading', ['The last of three uploading', 'A pair, the second uploading'], {
    rtl: true,
  }),
  message(
    'sendStops',
    [
      'Nothing up yet, the first uploading',
      'Failed before any file was up',
      'Interrupted with one file up',
      'Only text, and it failed',
      'Pictures only, and one cannot be sent',
    ],
    { accent: true },
  ),
  message(
    'fileForms',
    [
      'An animated PNG, as a file',
      'Shown as a list by its reader',
      'Two photos sent as the originals',
      'A photo sent as the original, and the paperwork',
    ],
    {},
  ),
  // A reply to each kind of message a quote draws, through the fake: the author's wording, the
  // thumbnail or the ThumbHash, and an original deleted or never received.
  message(
    'replies',
    [
      'Yes, 7pm',
      'No worries',
      'Skip that one',
      'Where is this?',
      'Lovely',
      'Send me the third one',
      'Jealous',
      'Signed',
      'Both signed',
      'Listening now',
      'Watching now',
      'Can you resend?',
      'Here it is',
      'What did it say?',
      'Too late, I read it',
    ],
    { rtl: true },
  ),
  // A quote on our accent and on a received bubble, in every accent: all fifteen replies in
  // every accent is a page past the capture's height.
  message('repliesAccent', ['Yes, 7pm', 'No worries', 'Where is this?', 'What did it say?'], {
    accent: true,
  }),
  // A reply carrying files of its own, drawn whole as the transcript draws it: the quote, the
  // words, the album or the file, and the footer under them. Ours and theirs.
  message(
    'repliesWithFiles',
    [
      'Here are the three',
      'Reply to Any pictures?',
      'Signed and attached',
      'Reply to Pictures please',
      'The lease, signed',
    ],
    { rtl: true },
  ),
]
