import type { Attachment, SendState } from '@session/bridge-types'

import { image, resetPhotos, set } from './attachments'
import { ensureDm, type FakeSetup, type FixtureName } from './fixtures'
import { FakeSessionClient } from './FakeSessionClient'
import { FakeWorld, resetFakeIds, type FakeAccount } from './world'

/** As long as a body gets before a quote of it is cut: more than its two lines hold. */
const LONG_ORIGINAL =
  'I looked at the three flats on Saturday. The one near the station is the best value but the ' +
  'kitchen is tiny and the landlord wants six months up front, which is more than I have.'

/**
 * A reply to each kind of message a quote draws, last in the conversation so nothing above moves.
 * Each original gets a time of its own first: a reply names what it answers by author and time.
 */
function seedReplies(world: FakeWorld, self: FakeAccount, peer: FakeAccount): void {
  const received = (body: string, attachments: Attachment[] = []): number => {
    world.advance()
    return self.deliverFrom(peer, body, world.now(), attachments).id
  }
  const sent = (body: string, replyTo?: number): number => {
    world.advance()
    const id = self.send(peer.sessionId, body, replyTo)
    world.settle()
    return id
  }
  const answeredBy = (body: string, ours: number, attachments: Attachment[] = []): void => {
    const original = self.messages(peer.sessionId).find((m) => m.id === ours)
    if (!original) throw new Error(`nothing to answer with "${body}"`)
    world.advance()
    self.deliverFrom(peer, body, world.now(), attachments, original)
  }

  sent('Yes, 7pm', received('Are we still on for Thursday?'))
  answeredBy('No worries', sent('Running 10 minutes late'))
  sent('Skip that one', received(LONG_ORIGINAL))

  // A picture as the sender's ThumbHash, then one the catalog downloads so its thumbnail draws.
  sent('Where is this?', received('A view, not downloaded', set(image(1))))
  sent('Lovely', received('A view, downloaded', set(image(1))))
  sent('Send me the third one', received('Beach day', set(image(5))))
  sent('Jealous', received('', set(image(1), { hashed: false })))

  sent('Signed', received('', set(['pdf'])))
  sent('Both signed', received('', set(['pdf', 'sheet'])))
  sent('Listening now', received('', set(['audio'])))
  sent('Watching now', received('', set(['video'])))
  sent('Can you resend?', received('', set(['pdf'], { expired: true })))

  // A reply that carries pictures of its own under its quote.
  answeredBy('Here it is', sent('Send me a picture of it'), set(image(2)))

  world.advance()
  self.deliverFrom(peer, 'What did it say?', world.now(), [], {
    author: self.sessionId,
    timestamp: 1,
  })
  const regretted = sent('Wrong chat, ignore that')
  answeredBy('Too late, I read it', regretted)
  self.deleteMessage(regretted, 'here')

  // Replies that carry files of their own under their quote, ours and theirs: an album with words
  // and without, and a document. One with no words is found by what it answers.
  const sentWith = (body: string, answering: number, attachments: Attachment[]): void => {
    const original = self.messages(peer.sessionId).find((m) => m.id === answering)
    if (!original) throw new Error(`nothing to answer with "${body}"`)
    world.advance()
    self.seedSending(peer.sessionId, body, attachments, 'sent', attachments.length, original)
    world.settle()
  }
  sentWith('Here are the three', received('Send them over'), set(image(3)))
  sentWith('', received('Any pictures?'), set(image(2)))
  sentWith('Signed and attached', received('The lease?'), set(['pdf']))
  answeredBy('', sent('Pictures please'), set(image(2)))
  answeredBy('The lease, signed', sent('Can you send the lease?'), set(['pdf']))
}

/**
 * Every shape a message's attachments can take, in one conversation.
 *
 * For looking at rather than for asserting on: the e2e suite runs against `friends`, whose three
 * messages are chosen to be the fewest that reach each code path. This is the opposite - one
 * message per case, so a pass over the transcript is a pass over the design.
 *
 * The order is the album's counts first, then the mixes that force a list, then the states a
 * message can be in that have nothing to do with what is attached, then downloads caught running.
 */
export function showcase(names: readonly [FixtureName, FixtureName] = ['Alice', 'Bob']): FakeSetup {
  resetFakeIds()
  resetPhotos()
  const world = new FakeWorld()
  const [firstName, secondName] = names
  const first = world.account(firstName)
  const second = world.account(secondName)

  ensureDm(first, second, world)
  ensureDm(second, first, world)

  const messages: Array<[string, Attachment[]]> = [
    // The album at every count up to its cap, and past it. Every dev photograph is 4:3, so the
    // names say how rows of those fall; the catalog's album stories draw other shapes.
    ['One picture', set(image(1))],
    ['Two, one above the other', set(image(2))],
    ['Three: one above two', set(image(3))],
    ['Four in two rows', set(image(4))],
    ['Five: two above three', set(image(5))],
    ['Twelve, so seven are behind the count', set(image(12))],
    ['Thirty-two', set(image(32))],

    // The same shapes from a sender that supplied no ThumbHash, so nothing draws before the bytes.
    ['Three with no hash to draw', set(image(3), { hashed: false })],
    ['Five with no hash to draw', set(image(5), { hashed: false })],

    // A video is a file row until libsession has a still for it, so each of these is a list.
    ['A clip on its own', set(['video'])],
    ['Pictures and a clip', set(['image', 'image', 'video'])],
    ['Clips only', set(['video', 'video'])],

    // One plain file puts the whole set in a list, pictures included.
    ['A clip and its notes', set(['video', 'pdf'])],
    ['Pictures, a clip and the paperwork', set(['image', 'image', 'video', 'pdf'])],
    ['Paperwork only', set(['pdf', 'zip', 'sheet'])],
    ['One file', set(['pdf'])],
    ['A recording', set(['audio'])],

    // Longer than the transcript holds, so the list caps and the rest moves into a sheet.
    ['The whole roll', set([...image(13), 'pdf'])],

    // Sent as the sender's files, metadata and all: a thumbnail to look at, a file to export.
    ['Two photos sent as the originals', set(image(2), { original: true })],
    ['A photo sent as the original, and the paperwork', set(['image', 'pdf'], { original: true })],

    // Nothing to do with the count: a file the server will not hand out again.
    ['One of these is gone', set(['pdf'], { expired: true })],
    [
      'Four of these five are gone',
      set(['pdf', 'zip', 'sheet', 'audio', 'pdf'], { expired: (index) => index < 4 }),
    ],
  ]

  for (const [body, attachments] of messages) {
    // Nothing is fetched: the conversation has not been asked what to download.
    first.deliverFrom(second, body, world.now(), attachments)
    world.settle()
  }

  // Each section starts again from the first photograph, so a message added to one moves no picture
  // in any other, and no catalog page changes for a message it does not draw.
  resetPhotos()

  // A running download at each reading the footer's ring draws, received and ours alike: the
  // catalog's scenarios give each a transfer of its own.
  const readings = ['for the ring at 0 of 0', 'for the ring at 40%', 'for the ring at 95%']
  for (const reading of readings) {
    first.deliverFrom(second, `A pair ${reading}`, world.now(), set(image(2)))
    world.settle()
  }
  for (const reading of readings) {
    first.seedFromOtherDevice(
      second.sessionId,
      `Ours from another device, ${reading}`,
      set(image(2)),
    )
    world.settle()
  }

  resetPhotos()

  // A message's one attachment as a list, whose footer carries its only control: a document, and
  // a picture its reader switched to the list. The catalog catches one of each downloading.
  const lone: Array<[string, Attachment[], boolean]> = [
    ['One file, caught downloading', set(['pdf']), true],
    ['One picture as a list', set(image(1)), false],
    ['One picture as a list, caught downloading', set(image(1)), false],
  ]
  for (const [body, attachments, gallery] of lone) {
    const message = first.deliverFrom(second, body, world.now(), attachments)
    if (!gallery) first.setGallery(message.id, false)
    world.settle()
  }

  resetPhotos()

  // Ours, caught sending: what the composer's files become once the bridge can carry them.
  const sending: Array<[string, Attachment[], SendState, number]> = [
    [
      'Still uploading, one at a time',
      set(['image', 'pdf', 'video', 'image', 'zip']),
      'uploading',
      2,
    ],
    ['File 31 of 32 failed', set([...image(30), 'video', 'image']), 'failed', 30],
    ['Gallery whose 31st failed', set(image(32)), 'failed', 30],
    ['A file of this one went missing', set(['pdf', 'image']), 'unsendable', 1],
    // libsession has a message of files uploading from the start, so none is ever only queued.
    ['Nothing up yet, the first uploading', set(['image', 'pdf', 'image']), 'uploading', 0],
    ['Failed before any file was up', set(['pdf', 'image', 'zip']), 'failed', 0],
    ['Interrupted with one file up', set(['image', 'pdf', 'zip']), 'interrupted', 1],
    ['Only text, and it failed', [], 'failed', 0],
    ['Pictures only, and one cannot be sent', set(image(2)), 'unsendable', 0],
  ]
  for (const [body, attachments, sendState, uploaded] of sending) {
    first.seedSending(second.sessionId, body, attachments, sendState, uploaded)
    world.settle()
  }

  resetPhotos()

  // After the sends, so the rows above keep their place.
  first.deliverFrom(second, 'An animated PNG, as a file', world.now(), set(['apng']))
  world.settle()
  const listed = first.deliverFrom(
    second,
    'Shown as a list by its reader',
    world.now(),
    set(image(3)),
  )
  // The reader's choice, which libsession stores per message.
  first.setGallery(listed.id, false)
  world.settle()

  resetPhotos()

  // Ours, caught uploading where the footer's ring has a total to read: a message's one file, and
  // sets whose last file is the one moving. The catalog's scenarios give each running file a
  // reading.
  const lastUploading: Array<[string, Attachment[], number]> = [
    ['One file, caught uploading', set(['pdf']), 0],
    ['The last of three uploading', set(['image', 'pdf', 'zip']), 2],
    ['A pair, the second uploading', set(image(2)), 1],
  ]
  for (const [body, attachments, uploaded] of lastUploading) {
    first.seedSending(second.sessionId, body, attachments, 'uploading', uploaded)
    world.settle()
  }

  resetPhotos()
  seedReplies(world, first, second)

  return {
    world,
    clients: {
      [firstName]: new FakeSessionClient(first, world),
      [secondName]: new FakeSessionClient(second, world),
    },
  }
}
