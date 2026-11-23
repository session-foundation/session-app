import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron, expect, test } from '@playwright/test'
import { ELEMENT } from '@session/test-ids'

import { FAKE_LAUNCH_ENV } from '../harness/fakeEnv'

const repoRoot = join(import.meta.dirname, '../../..')

/**
 * Both ways into the path screen: the rail's path light opens it on its own, and Settings' Path
 * row opens it as a child of Settings. The fake holds paths open, so the flow is drawn once the
 * first snapshot is in; what it draws is the catalog's to check.
 */
test('the path light and the Path row open the path screen @desktop', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'session-path-screen-'))
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
    const screen = page.getByTestId(ELEMENT.settings.pathScreen)

    await page.getByTestId(ELEMENT.rail.pathStatus).first().click()
    await expect(screen.first()).toBeVisible()
    await expect(page.getByTestId(ELEMENT.settings.pathFlow).first()).toBeVisible()
    await expect(page.getByTestId(ELEMENT.settings.pathLearnMore).first()).toBeVisible()
    // Opened on its own, so there is nothing to go back to.
    await expect(page.getByTestId(ELEMENT.settings.modalBack)).toHaveCount(0)
    await page.getByTestId(ELEMENT.settings.modalClose).first().click()
    await expect(screen).toHaveCount(0)

    await page.getByTestId(ELEMENT.rail.settings).first().click()
    await page.getByTestId(ELEMENT.settings.row('onion-path')).first().click()
    await expect(screen.first()).toBeVisible()
    await page.getByTestId(ELEMENT.settings.modalBack).first().click()
    await expect(page.getByTestId(ELEMENT.settings.row('onion-path')).first()).toBeVisible()
    await expect(screen).toHaveCount(0)
  } finally {
    await app.close()
  }
})
