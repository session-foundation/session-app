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
