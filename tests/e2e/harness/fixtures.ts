/**
 * The filenames of the attachment messages `friendsWithAttachments` seeds into Alice's
 * conversation with Bob, which is what the desktop dev fake boots.
 *
 * Copied rather than imported: the lint zone forbids `@session/client/fake` outside spec files,
 * so this must be kept in step with `packages/client/src/fake/attachments.ts` by hand.
 */

/** A document named in Arabic, in `SEEDED_LIST`. */
export const SEEDED_RTL_NAME = 'تقرير-الرحلة.pdf'

/** Two photographs, drawn as an album, where a tile shows no filename. */
export const SEEDED_ALBUM = ['harbour.jpg', 'ferry.png'] as const

/**
 * A picture, two documents and an AVIF the viewer cannot open, which libsession's rule sends to the
 * list.
 */
export const SEEDED_LIST = [
  'receipt.jpg',
  'itinerary.pdf',
  SEEDED_RTL_NAME,
  'boarding-gate.avif',
] as const

/** Twelve pictures and a document: more than the transcript's list draws before "show all". */
export const SEEDED_ROLL = [
  ...Array.from({ length: 12 }, (_, at) => `roll-${String(at + 1).padStart(2, '0')}.jpg`),
  'contact-sheet.pdf',
]

/** `receipt.jpg`'s format and size line, as every client formats the fake's 96 500 bytes. */
export const SEEDED_RECEIPT = { format: 'JPG', size: '96.5 kB' } as const

/**
 * What the `replies` fixture says, oldest first: `REPLIES` in
 * `packages/client/src/fake/replies.ts`, kept in step by hand as the names above are. The chain
 * reads `meet` <- `station` <- `seeYou`, with more than a page of history between each pair.
 */
export const SEEDED_REPLIES = {
  meet: 'Where shall we meet on Saturday?',
  station: 'At the station, by the clock',
  /** `repliesNearEnd` only, as `homeNow`. */
  homeAsk: 'Text me when you get home',
  view: 'The view from the top',
  whereIsThis: 'Where is this?',
  seeYou: 'See you there',
  neverReceived: 'What did it say?',
  deletedSince: 'Too late, I read it',
  homeNow: 'Home now',
  newest: 'Good night',
} as const
