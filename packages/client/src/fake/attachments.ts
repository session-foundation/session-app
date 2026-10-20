import { isViewableContentType, type MediaKind } from '@session/basic-types'
import type { Attachment } from '@session/bridge-types'

import { friends, type FakeSetup, type FixtureName } from './fixtures'

/**
 * Pictures only, so the message is gallery-viewable and draws as pictures.
 *
 * Dimensions are the sender's and are what the placeholder is laid out from, so they are set:
 * without them a transcript jumps as each one lands.
 *
 * `hasPreview` is set so the placeholder is drawn. The fake's preview door answers these with a
 * flat colour: what it exercises is the route, not the decoder.
 */
const SEEDED_PICTURES: Attachment[] = [
  {
    index: 0,
    contentType: 'image/jpeg',
    filename: 'harbour.jpg',
    hasPreview: true,
    sizeBytes: 2_411_724,
    voiceMessage: false,
    width: 1600,
    height: 1200,
    uploaded: true,
    availability: 'absent',
    fetchDoneBytes: 0,
    fetchTotalBytes: 0,
  },
  {
    index: 1,
    contentType: 'image/png',
    filename: 'ferry.png',
    hasPreview: true,
    sizeBytes: 812_004,
    voiceMessage: false,
    width: 1200,
    height: 1600,
    uploaded: true,
    availability: 'absent',
    fetchDoneBytes: 0,
    fetchTotalBytes: 0,
  },
]

/**
 * One picture and two files, which libsession's rule makes *not* gallery-viewable: a message is
 * only shown as pictures when every attachment is one. This is what draws the file form.
 */
const SEEDED_FILES: Attachment[] = [
  {
    index: 0,
    contentType: 'image/jpeg',
    filename: 'receipt.jpg',
    hasPreview: true,
    sizeBytes: 96_500,
    voiceMessage: false,
    width: 900,
    height: 1200,
    uploaded: true,
    availability: 'absent',
    fetchDoneBytes: 0,
    fetchTotalBytes: 0,
  },
  {
    index: 1,
    contentType: 'application/pdf',
    filename: 'itinerary.pdf',
    sizeBytes: 184_320,
    voiceMessage: false,
    hasPreview: false,
    uploaded: true,
    availability: 'absent',
    fetchDoneBytes: 0,
    fetchTotalBytes: 0,
  }, // Named in Arabic, so a right-to-left name is on screen in every locale.
  {
    index: 2,
    contentType: 'application/pdf',
    filename: 'تقرير-الرحلة.pdf',
    sizeBytes: 52_480,
    voiceMessage: false,
    hasPreview: false,
    uploaded: true,
    availability: 'absent',
    fetchDoneBytes: 0,
    fetchTotalBytes: 0,
  },
]

/**
 * More attachments than a message draws in the transcript, so the list caps and "Show All" opens
 * the rest. A mixed set, because the rule that sends a message to the list is one plain file -
 * and the case worth having a fixture for is the one no composer can produce.
 */
const SEEDED_MANY: Attachment[] = Array.from({ length: 13 }, (_, at) => ({
  index: at,
  ...(at === 12
    ? { contentType: 'application/pdf', filename: 'contact-sheet.pdf' }
    : {
        contentType: 'image/jpeg',
        filename: `roll-${String(at + 1).padStart(2, '0')}.jpg`,
        width: 1200,
        height: 900,
      }),
  hasPreview: at !== 12,
  sizeBytes: 120_000 + at * 4_000,
  voiceMessage: false,
  uploaded: true,
  availability: 'absent',
  fetchDoneBytes: 0,
  fetchTotalBytes: 0,
}))

/**
 * The average colour of each photo the dev media folder holds, as a real ThumbHash.
 *
 * Encoded from the files by libsession's own encoder rather than invented, so what the fake draws
 * before a photograph arrives is what a recipient would actually be sent -- including the format's
 * limits, which a downscaled thumbnail would flatter.
 *
 * Index N here is `unsplash-NN.jpg` there, and `photoNumber` is what keeps the two in step.
 */
export const PHOTO_THUMBHASHES: readonly string[] = [
  'd5280a3d8a8577777f76778286e7888c8775705807', // 01
  '18f81105807978776f86887a777788847780c9eaf5', // 02
  '1af81d0d827677877f77778a77887887556062b5f6', // 03
  '96f8050d8405a7877e8678869935a977047f32d405', // 04
  'e2f7151d828877877f87888a877888887b409d07d5', // 05
  '15080a0d820657b79488897487aa86900688766068', // 06
  '15290a258477367673888880878a8877b776704a08', // 07
  '1f081a05808777887f877786877887880000000000', // 08
  '2718161d868778889f877875787787878c79c07707', // 09
  'a8e71525848787778f87877678888877887f8888f7', // 10
  '18290e1d82049a587979965c98868697079bfbd09e', // 11
  '1ff80905800aac873f9877548897798790b02904a5', // 12
  'aa390e2d869b88777f88777776a78783686f548405', // 13
  'af081625847788778f7887748778788977807b07b8', // 14
  '0c080a05809c7877bf798799779778780000000000', // 15
  'e2f7050d822396984f54897f56b895566770750557', // 16
  '1af9091d806988768f88788d87a87776776026bb04', // 17
  'd9281215848776877f86776a8888888890890c0baa', // 18
  '5fd7091d821a79787f8b87767c398789b670552d06', // 19
  'e0e7051584368877687776908a9994727770740757', // 20
  '28081615827578788f8878877877877769508a05d4', // 21
  'a1e71505807978878f8777678878887863fc15f64b', // 22
  '1f18060d82706486818b79897688a884666fe4a107', // 23
  '60e7090d82d14e606faa579a99e899963d8ecfd4f8', // 24
  '1808060580975998687aa6782978777f0000000000', // 25
  '5844111d965887788f7788798897778888808e0868', // 26
  '6a080a0d827667988f87777087988878d77f6205c7', // 27
  '0d080a0580069888789876817b776889805b05c103', // 28
  '61491a15846579787f878889788888777692700709', // 29
  '90e7050d82488745976a77508a5767994795600309', // 30
]
export type Kind = MediaKind | 'pdf' | 'zip' | 'sheet' | 'audio'

const TYPES: Record<Kind, { contentType: string; extension: string }> = {
  image: { contentType: 'image/jpeg', extension: 'jpg' },
  video: { contentType: 'video/mp4', extension: 'mp4' },
  pdf: { contentType: 'application/pdf', extension: 'pdf' },
  zip: { contentType: 'application/zip', extension: 'zip' },
  sheet: { contentType: 'application/vnd.ms-excel', extension: 'xlsx' },
  audio: { contentType: 'audio/mpeg', extension: 'mp3' },
}

/**
 * One attachment of a showcase message.
 *
 * `hashed: false` is a sender that supplied no ThumbHash, whose flat surface and glyph has to be
 * as easy to look at as the coloured placeholder.
 */
function showpiece(
  index: number,
  kind: Kind,
  photo: number,
  options: { hashed?: boolean; expired?: boolean } = {},
): Attachment {
  const { contentType, extension } = TYPES[kind]
  const picture = isViewableContentType(contentType)
  // Past the last photo the numbers repeat, and a round suffix keeps the filenames distinct.
  const number = String(((photo - 1) % PHOTO_THUMBHASHES.length) + 1).padStart(2, '0')
  const round = Math.floor((photo - 1) / PHOTO_THUMBHASHES.length)
  return {
    index,
    contentType,
    // The number is load-bearing on a picture: the dev bridge reads it back out to decide which
    // file to serve, which is what makes the hash below describe the photo that arrives.
    filename: picture
      ? `unsplash-${number}${round === 0 ? '' : `-${String(round + 1)}`}.${extension}`
      : `${kind}-${String(index + 1).padStart(2, '0')}.${extension}`,
    // Spread so a set does not report one bar's worth of progress four times over.
    sizeBytes: 180_000 + index * 420_000,
    voiceMessage: false,
    ...(picture ? { width: 1600, height: 1200 } : {}),
    hasPreview: picture && options.hashed !== false,
    uploaded: true,
    availability: options.expired === true ? 'notFound' : 'absent',
    fetchDoneBytes: 0,
    fetchTotalBytes: 0,
  }
}

/**
 * A running number over the whole showcase, so pictures repeat as rarely as the photos allow.
 *
 * Reset with the fixture rather than per message: there are more pictures than photos, so it
 * wraps, and a wrap between messages is much less noticeable than two identical tiles side by
 * side. Only a message with more pictures than there are photos repeats one within itself.
 */
let nextPhoto = 0

export function resetPhotos(): void {
  nextPhoto = 0
}

/** `expired` as a function picks which entries the file server no longer holds. */
export function set(
  kinds: Kind[],
  options: { hashed?: boolean; expired?: boolean | ((index: number) => boolean) } = {},
): Attachment[] {
  const { expired, ...rest } = options
  return kinds.map((kind, index) => {
    if (isViewableContentType(TYPES[kind].contentType)) nextPhoto += 1
    return showpiece(index, kind, nextPhoto, {
      ...rest,
      expired: typeof expired === 'function' ? expired(index) : expired === true,
    })
  })
}

export const image = (n: number): Kind[] => Array.from({ length: n }, () => 'image' as const)

/** A file the server no longer holds, so a download of it fails and it reads `notFound`. */
const SEEDED_EXPIRED: Attachment[] = [
  {
    index: 0,
    contentType: 'application/pdf',
    filename: 'boarding-pass.pdf',
    sizeBytes: 64_000,
    voiceMessage: false,
    hasPreview: false,
    uploaded: true,
    availability: 'notFound',
    fetchDoneBytes: 0,
    fetchTotalBytes: 0,
  },
]

const SEEDED_SETS = {
  pictures: ['Here are the photos', SEEDED_PICTURES],
  files: ['And the paperwork', SEEDED_FILES],
  roll: ['The whole roll', SEEDED_MANY],
  expired: ['This one has expired', SEEDED_EXPIRED],
} as const satisfies Record<string, readonly [string, Attachment[]]>

type SeededSet = keyof typeof SEEDED_SETS

/**
 * `friends`, then Bob's attachment messages arriving at Alice. By default an album, a mixed set
 * the list draws, and one longer than the transcript list holds - the fewest that reach each code
 * path; `expired` adds a file the server no longer holds.
 *
 * Nothing is fetched: the conversation has not been asked what to download.
 */
export function friendsWithAttachments(
  names: readonly [FixtureName, FixtureName] = ['Alice', 'Bob'],
  options: { history?: number; sets?: readonly SeededSet[] } = {},
): FakeSetup {
  const setup = friends(names, { history: options.history ?? 0 })
  const { world } = setup
  const recipient = world.account(names[0])
  const sender = world.account(names[1])
  for (const name of options.sets ?? ['pictures', 'files', 'roll']) {
    const [body, attachments] = SEEDED_SETS[name]
    recipient.deliverFrom(sender, body, world.now(), attachments)
    world.settle()
  }
  return setup
}
