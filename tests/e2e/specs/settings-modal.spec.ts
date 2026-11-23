import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

import { _electron, expect, test } from '@playwright/test'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'

import { FAKE_LAUNCH_ENV } from '../harness/fakeEnv'

const repoRoot = join(import.meta.dirname, '../../..')

/**
 * The DOM the renderer-side bodies touch, declared here because harness code runs in Node and
 * this package's lib has no `dom`.
 */
interface PageNode {
  scrollTop: number
  parentElement: PageNode | null
  scrollIntoView: (options: { block: 'end' }) => void
}
interface PageGlobals {
  document: { querySelector: (selector: string) => PageNode | null }
}

/**
 * The two stacks interacting inside the platform's modal, which only an e2e run can see. One pass
 * rather than four specs because each step needs the state the last one left.
 */
test('settings opens over the list, pushes Help, exports logs from it, and asks on top of itself @desktop', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'session-settings-modal-'))
  const app = await _electron.launch({
    args: [
      join(repoRoot, 'apps/desktop/out/main/index.js'),
      `--user-data-dir=${dataDir}`,
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
    ],
    env: {
      ...process.env,
      ...FAKE_LAUNCH_ENV,
      SESSION_IDENTITY: 'alice',
      SESSION_DATA_DIR: dataDir,
    },
  })
  try {
    const page = await app.firstWindow()

    await page.getByTestId(ELEMENT.conversationList.screen).first().waitFor({ timeout: 25_000 })
    // The window opens wide enough for two panes, where the rail's settings button is the way
    // in.
    await page.getByTestId(ELEMENT.rail.settings).first().click()

    // The account ID, not the modal frame, is what says the screen arrived.
    await expect(page.getByTestId(ELEMENT.settings.accountId).first()).toBeVisible()
    await expect(page.getByTestId(ELEMENT.settings.modalBack)).toHaveCount(0)

    // A scroll position for going back to preserve.
    const scrolledTo = await page.evaluate((helpId) => {
      const { document } = globalThis as unknown as PageGlobals
      const help = document.querySelector(`[data-testid="${helpId}"]`)
      if (help === null) return -1
      help.scrollIntoView({ block: 'end' })
      let at: PageNode | null = help
      while (at !== null && at.scrollTop === 0) at = at.parentElement
      return at?.scrollTop ?? 0
    }, ELEMENT.settings.row('help'))
    expect(scrolledTo).toBeGreaterThan(0)

    await page.getByTestId(ELEMENT.settings.row('help')).first().click()
    await expect(page.getByTestId(ELEMENT.help.link('faq')).first()).toBeVisible()

    // Help's Export Logs writes the same export the startup-failure screen does, from a running
    // app. The save dialog is answered here, as a person would.
    const exported = join(dataDir, 'exported.log.gz')
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path })
    }, exported)
    await page.getByTestId(ELEMENT.help.exportLogs).first().click()
    await expect.poll(() => existsSync(exported), { timeout: 10_000 }).toBe(true)
    await expect(page.getByTestId(ELEMENT.help.exportLogs).first()).toBeEnabled()
    const text = gunzipSync(readFileSync(exported)).toString('utf8')
    expect(text).toMatch(/^=+\nSession logs exported /)
    expect(text).toContain('>>> export')
    // The root stays mounted but hidden: out of sight, out of the Tab order (`visibility`, which
    // Playwright reads as hidden where it would count `opacity: 0` as visible), and out of the
    // accessibility tree (`aria-hidden`).
    await expect(page.getByTestId(ELEMENT.settings.modalBack).first()).toBeVisible()
    await expect(page.getByTestId(ELEMENT.settings.accountId).first()).toBeHidden()
    const hiddenRoot = page.locator(
      `[aria-hidden="true"] [data-testid="${ELEMENT.settings.accountId}"]`,
    )
    await expect(hiddenRoot).toHaveCount(1)

    await page.getByTestId(ELEMENT.settings.modalBack).first().click()
    await expect(hiddenRoot).toHaveCount(0)
    await expect(page.getByTestId(ELEMENT.settings.modalBack)).toHaveCount(0)
    // Back to the same scroll position, not the top.
    const scrolledBack = await page.evaluate((helpId) => {
      const { document } = globalThis as unknown as PageGlobals
      let at = document.querySelector(`[data-testid="${helpId}"]`)
      while (at !== null && at.scrollTop === 0) at = at.parentElement
      return at?.scrollTop ?? 0
    }, ELEMENT.settings.row('help'))
    expect(scrolledBack).toBe(scrolledTo)

    // Conversations holds the attachment cache, the old settings route's one live section.
    await page.getByTestId(ELEMENT.settings.row('conversations')).first().click()
    await expect(page.getByTestId(ELEMENT.settings.cacheUsage).first()).toBeVisible()
    await page.getByTestId(ELEMENT.settings.modalBack).first().click()
    await expect(page.getByTestId(ELEMENT.settings.modalBack)).toHaveCount(0)

    // A press on the panel's empty space is not a press outside it.
    const panel = await page.getByTestId(ELEMENT.settings.modal).first().boundingBox()
    if (panel === null) throw new Error('no settings panel')
    await page.mouse.click(panel.x + 12, panel.y + panel.height / 2)
    await expect(page.getByTestId(ELEMENT.settings.accountId).first()).toBeVisible()

    // **Copying says so over the panel**: a toast raised from inside settings has to be drawn above
    // the modal layer.
    await page.getByTestId(ELEMENT.settings.copyAccountId).first().click()
    const toast = page.getByTestId(ELEMENT.toast.item).first()
    await expect(toast).toBeVisible()
    // The catalogue's `copied`, in the English the suite runs in.
    await expect(toast).toHaveText(tr('copied'))
    // Its own close, so nothing after this waits out the toast's timer.
    await page.getByTestId(ELEMENT.toast.close).first().click()
    await expect(page.getByTestId(ELEMENT.toast.item)).toHaveCount(0)

    // **The foot of the page names the build**, and ten presses on its commit turn debug mode on.
    await expect(page.getByTestId(ELEMENT.settings.version).first()).toHaveText(/^v\d+\.\d+\.\d+$/)
    const commit = page.getByTestId(ELEMENT.settings.commit).first()
    await expect(commit).toHaveText(/^[0-9a-f]{8}(-dirty)?$/)
    // The version leaves for its release page, through the confirmation every link takes.
    await page.getByTestId(ELEMENT.settings.version).first().click()
    const confirm = page.getByTestId(ELEMENT.onboarding.openUrlDialog).first()
    await expect(confirm).toContainText('/releases/tag/v')
    await page.mouse.click(5, 5)
    await expect(page.getByTestId(ELEMENT.onboarding.openUrlDialog)).toHaveCount(0)
    for (let press = 0; press < 10; press += 1) await commit.click()
    await expect(page.getByTestId(ELEMENT.toast.item).first()).toHaveText(tr('debugModeEnabled'))
    await expect(page.getByTestId(ELEMENT.settings.row('developer-settings')).first()).toBeVisible()
    await page.getByTestId(ELEMENT.toast.close).first().click()

    // Developer Settings opens from that row, and its Debug Mode switch turns debug mode off and
    // leaves, taking the row with it.
    await page.getByTestId(ELEMENT.settings.row('developer-settings')).first().click()
    await expect(page.getByTestId(ELEMENT.developerSettings.page).first()).toBeVisible()
    await page.getByTestId(ELEMENT.developerSettings.debugModeSwitch).first().click()
    await expect(page.getByTestId(ELEMENT.developerSettings.page)).toHaveCount(0)
    await expect(page.getByTestId(ELEMENT.settings.row('developer-settings'))).toHaveCount(0)

    // A second modal over the first, which is the case the platform's own nesting gets wrong.
    await page.getByTestId(ELEMENT.settings.clearData).first().click()
    await expect(page.getByTestId(ELEMENT.settings.confirmClearDataButton).first()).toBeVisible()
    // Settings stays mounted underneath, so Cancel can return to it.
    await expect(page.getByTestId(ELEMENT.settings.accountId).first()).toBeVisible()

    await page.getByTestId(ELEMENT.settings.cancelClearData).first().click()
    await expect(page.getByTestId(ELEMENT.settings.confirmClearDataButton)).toHaveCount(0)
    await expect(page.getByTestId(ELEMENT.settings.accountId).first()).toBeVisible()

    // The scrim leaves the confirm (it has no cross), and only the confirm.
    await page.getByTestId(ELEMENT.settings.clearData).first().click()
    await expect(page.getByTestId(ELEMENT.settings.confirmClearDataButton).first()).toBeVisible()
    await page.mouse.click(5, 5)
    await expect(page.getByTestId(ELEMENT.settings.confirmClearDataButton)).toHaveCount(0)
    await expect(page.getByTestId(ELEMENT.settings.accountId).first()).toBeVisible()

    // Closing leaves the list, not a blank pane: settings was never a route.
    await page.getByTestId(ELEMENT.settings.modalClose).first().click()
    await expect(page.getByTestId(ELEMENT.settings.accountId)).toHaveCount(0)
    await expect(page.getByTestId(ELEMENT.conversationList.screen).first()).toBeVisible()
  } finally {
    await app.close()
  }
})
