import { expect, test } from '@playwright/test'
import {
  ALBUM_TILE_ID,
  ATTACHMENT_ROW_IDS,
  fileRow,
  type FileRowState,
  verbName,
} from '@session/expectations'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'

import { openFirstConversation } from '../harness/attachments'
import { SEEDED_LIST, SEEDED_RECEIPT } from '../harness/fixtures'
import { MobileApp, type MobilePlatform } from '../harness/MobileApp'

/** Export has no catalogue word yet; see `attachmentFooterAction`. */
const EXPORT = verbName('export')

/** The album above carries the row's id, so the receipt's row is the second node carrying it. */
const RECEIPT_ROW = 1

/**
 * The showcase's tiles count across its albums, oldest first: one picture, two halves, then the
 * three-up's big tile and the two stacked beside it. This is the upper of those two.
 */
const BESIDE_THREE_UP_CLOUD = 4

/** How far apart the progress a phone says and the bytes its caption counts may be read. */
const PROGRESS_SLACK = 10

const MOBILE_PLATFORMS: readonly MobilePlatform[] = ['android', 'ios']

function receipt(state: Extract<FileRowState, 'idle' | 'fetching' | 'ready'>) {
  const verb =
    state === 'idle' ? verbName('download') : state === 'ready' ? verbName('open') : undefined
  return fileRow({
    filename: SEEDED_LIST[0],
    format: SEEDED_RECEIPT.format,
    caption: SEEDED_RECEIPT.size,
    state,
    rowVerb: verb,
    leadOpens: true,
    leadVerb: verb,
    controlName: state === 'ready' ? EXPORT : state === 'idle' ? verbName('download') : undefined,
  })
}

/**
 * A row's custom actions are its verbs after the activation, then its message's Reply, named
 * where the phone names them.
 */
async function expectCustomActions(app: MobileApp, verbs: readonly string[]): Promise<void> {
  const rest = [...verbs.slice(1), tr('reply')]
  const found = await app.customActions(ATTACHMENT_ROW_IDS.row, RECEIPT_ROW)
  expect(found).toHaveLength(rest.length)
  found.forEach((label, at) => {
    if (label !== null) expect(label).toBe(rest[at])
  })
}

/** The percentage the row's value says, and the one its caption's bytes come to. */
async function progress(app: MobileApp): Promise<{ said: number; counted: number } | null> {
  const value = await app.accessibilityValue(ATTACHMENT_ROW_IDS.row, RECEIPT_ROW)
  // Without the marks that order the caption's parts, which have no glyph.
  const name = ((await app.describe(ATTACHMENT_ROW_IDS.row, RECEIPT_ROW))?.name ?? '').replace(
    /[‎‏⁨⁩]/g,
    '',
  )
  const said = /(\d+)%/.exec(value ?? '')?.[1]
  const bytes = /([\d.]+) kB \/ ([\d.]+) kB/.exec(name)
  if (said === undefined || bytes === null) return null
  return { said: Number(said), counted: (100 * Number(bytes[1])) / Number(bytes[2]) }
}

/**
 * What only a phone's own accessibility tree holds of a file row: the verbs its parts offer, which
 * a screen reader lists as the row's actions because the row is the one element; and how far a
 * fetch has come, which VoiceOver reads as the row's value. Four hundred times slower, so the
 * fetch is still running when a slow driver reads the row.
 */
for (const platform of MOBILE_PLATFORMS) {
  test(`offers a file row’s verbs as its actions, and says how far its fetch has come @${platform} @medium-risk`, async () => {
    const app = await MobileApp.launch(platform, 'alice', {
      env: { EXPO_PUBLIC_SESSION_FAKE_SLOWDOWN: '400' },
    })

    try {
      await openFirstConversation(app)
      await expectCustomActions(app, receipt('idle').verbs)

      await app.tap(ATTACHMENT_ROW_IDS.download)
      await app.waitForVisible(ELEMENT.conversation.autoDownloadPrompt)
      await app.tap(ELEMENT.conversation.autoDownloadNo)

      await expect(async () => {
        expect((await app.describe(ATTACHMENT_ROW_IDS.row, RECEIPT_ROW))?.busy).toBe(true)
        await expectCustomActions(app, receipt('fetching').verbs)
      }).toPass({ timeout: 15_000 })
      // Android's tree has no range, so only VoiceOver's value says it.
      if (platform === 'ios') {
        const read = await progress(app)
        expect(read, 'the value says a percentage and the caption counts bytes').not.toBeNull()
        expect(Math.abs((read?.said ?? -1) - (read?.counted ?? 0))).toBeLessThanOrEqual(
          PROGRESS_SLACK,
        )
      }

      await expect(async () => {
        await expectCustomActions(app, receipt('ready').verbs)
      }).toPass({ timeout: 180_000 })
    } finally {
      await app.close()
    }
  })

  /**
   * A downloaded picture's row opens it, while its control exports it: the control's press must
   * stop at the control, or the export would open the viewer under it as well.
   */
  test(`exports a downloaded picture from its control without opening it @${platform} @medium-risk`, async () => {
    const app = await MobileApp.launch(platform, 'alice')

    try {
      await openFirstConversation(app)
      await app.tap(ATTACHMENT_ROW_IDS.download)
      await app.waitForVisible(ELEMENT.conversation.autoDownloadPrompt)
      await app.tap(ELEMENT.conversation.autoDownloadNo)
      await app.waitForVisible(ATTACHMENT_ROW_IDS.export, { timeoutMs: 30_000 })

      await app.tap(ATTACHMENT_ROW_IDS.export)
      // The export opens the picture in the phone's own gallery, over this app.
      await expect.poll(async () => app.isVisible(ATTACHMENT_ROW_IDS.export)).toBe(false)
      await app.activate()
      await app.waitForVisible(ATTACHMENT_ROW_IDS.export)
      expect(await app.isVisible(ELEMENT.conversation.mediaViewer)).toBe(false)
    } finally {
      await app.close()
    }
  })

  /**
   * The three-up's cloud sits in a box laid over the whole album, which lets a touch through
   * everywhere but on the cloud: a tile beside it keeps its own press.
   */
  test(`fetches a picture from a tile beside the three-up’s cloud @${platform} @medium-risk`, async () => {
    const app = await MobileApp.launch(platform, 'alice', {
      env: { EXPO_PUBLIC_SESSION_FAKE_FIXTURE: 'showcase' },
    })

    try {
      await openFirstConversation(app)
      await app.waitForVisible(ALBUM_TILE_ID)
      await app.scroll(ELEMENT.conversation.screen, 1)
      await app.tapAt(ALBUM_TILE_ID, BESIDE_THREE_UP_CLOUD)
      await app.waitForVisible(ELEMENT.conversation.autoDownloadPrompt)
    } finally {
      await app.close()
    }
  })
}
