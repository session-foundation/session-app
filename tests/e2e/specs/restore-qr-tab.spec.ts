import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron, expect, test } from '@playwright/test'
import { ELEMENT } from '@session/test-ids'

import { FAKE_LAUNCH_ENV } from '../harness/fakeEnv'

const repoRoot = join(import.meta.dirname, '../../..')

/**
 * The restore screen offers a QR tab only where something can scan.
 *
 * Desktop is the case worth a spec, because it is the one with no camera port: the tab used to be
 * drawn there and its whole content was a request for a permission the app cannot ask for. A unit
 * test cannot see this -- `packages/screens` has no DOM -- and the gate is a render decision, so
 * the app itself is the only place it is observable.
 *
 * **The other half is not asserted here.** That a build *with* a camera port keeps the tab needs a
 * mobile driver, and this project is desktop. `ScanQrPane`'s own states are what cover the pane
 * once a camera exists.
 */
test('the restore screen offers no QR tab where nothing can scan', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'session-qr-tab-'))
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
      EXPO_PUBLIC_SESSION_NO_ACCOUNT: '1',
    },
  })
  const page = await app.firstWindow()

  await page.getByTestId(ELEMENT.onboarding.restoreAccount).first().click({ timeout: 20_000 })
  await page.getByTestId(ELEMENT.onboarding.loadAccountScreen).first().waitFor()

  // Both halves, because a screen that drew neither would pass on the first alone.
  await expect(page.getByTestId(ELEMENT.onboarding.scanQrTab)).toHaveCount(0)
  await expect(page.getByTestId(ELEMENT.onboarding.scanQrPane)).toHaveCount(0)

  // And the field is still the screen rather than a gap where the pager was.
  const field = page.getByTestId(ELEMENT.onboarding.recoveryPhraseInput).first()
  await expect(field).toBeVisible()
  await field.fill('one two three')
  expect(await field.inputValue()).toBe('one two three')

  await page.screenshot({ path: join(repoRoot, 'test-results', 'restore-no-qr-tab.png') })
  await app.close()
})
