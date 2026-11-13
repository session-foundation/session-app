import type { PickedFile } from '@session/app'
import { MAX_ATTACHMENTS_PER_MESSAGE } from '@session/basic-types'
import { DetachedComposer, replyingToHeading, type ComposerSeed } from '@session/screens'
import { CatalogPictures, defineStory, type AnyStory } from '@session/ui/catalog'
import { useContext } from 'react'

/** A composer's staging, by how many files it holds; the files themselves are drawn here. */
interface ComposerRow {
  count: number
  refused?: ComposerSeed['refused']
}

/** Mostly pictures, with a document every fourth file, as a real pick tends to be. */
function stagedFile(at: number, pictures: readonly string[]): PickedFile {
  const number = String(at + 1).padStart(2, '0')
  if (at % 4 === 2)
    return {
      path: `/catalog/notes-${number}.pdf`,
      name: `notes-${number}.pdf`,
      contentType: 'application/pdf',
      size: 184_320,
    }
  return {
    path: `/catalog/photo-${number}.jpg`,
    name: `photo-${number}.jpg`,
    contentType: 'image/jpeg',
    size: 2_411_724,
    previewUrl: pictures.length === 0 ? undefined : pictures[at % pictures.length],
  }
}

function ScenarioComposer({ count, refused }: ComposerRow) {
  const pictures = useContext(CatalogPictures)
  const files = Array.from({ length: count }, (_, at) => stagedFile(at, pictures))
  return <DetachedComposer seed={{ files, refused }} />
}

const TOO_LARGE: PickedFile = {
  path: '/catalog/field-recording.wav',
  name: 'field-recording.wav',
  size: 48_000_000,
}

/** Its Send button is the accent, and its tray has a leading and a trailing end. */
const composer = defineStory<ComposerRow>({
  component: 'composer',
  story: 'staging',
  width: 640,
  sensitive: { accent: true, rtl: true },
  variants: {
    empty: { count: 0 },
    threeStaged: { count: 3 },
    withNotices: { count: 3, refused: { tooLarge: [TOO_LARGE], overLimit: 3 } },
    full: { count: MAX_ATTACHMENTS_PER_MESSAGE },
  },
  render: (row) => <ScenarioComposer {...row} />,
})

/** What a composer is answering, and how many files it has staged under the bar. */
interface ReplyingRow {
  count: number
  quoted: string
  /** Whether the answered message carries a picture, drawn in the bar's square. */
  picture?: boolean
}

function ReplyingComposer({ count, quoted, picture = false }: ReplyingRow) {
  const pictures = useContext(CatalogPictures)
  const files = Array.from({ length: count }, (_, at) => stagedFile(at, pictures))
  return (
    <DetachedComposer
      seed={{
        files,
        reply: {
          heading: replyingToHeading('Bob'),
          message: {
            id: 1,
            outgoing: false,
            body: quoted,
            attachments: picture
              ? [{ contentType: 'image/jpeg', voiceMessage: false, uri: pictures[0] }]
              : [],
          },
        },
      }}
    />
  )
}

/** The bar above the input while replying: its stripe or square leads, its X trails. */
const replying = defineStory<ReplyingRow>({
  component: 'composer',
  story: 'replying',
  width: 640,
  sensitive: { accent: true, rtl: true },
  variants: {
    toText: { count: 0, quoted: 'Are we still on for Thursday?' },
    toLongText: {
      count: 0,
      quoted:
        'Are we still on for Thursday? I might bring Sam along if that is all right with you, ' +
        'and we could eat first.',
    },
    toPicture: { count: 0, quoted: '', picture: true },
    withFilesStaged: { count: 3, quoted: 'Send me the photos', picture: false },
  },
  render: (row) => <ReplyingComposer {...row} />,
})

export const COMPOSER_SCENARIOS: readonly AnyStory[] = [composer, replying]
