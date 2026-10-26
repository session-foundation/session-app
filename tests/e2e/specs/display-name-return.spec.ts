import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron, expect, test } from '@playwright/test'
import { ELEMENT } from '@session/test-ids'

import { FAKE_LAUNCH_ENV } from '../harness/fakeEnv'

const repoRoot = join(import.meta.dirname, '../../..')

/**
 * The return key on the name step does what Continue does, and nothing Continue would refuse.
 *
 * Continue is disabled on an empty field and the keyboard is not, so the screen refuses the return
 * key itself; without that, an account leaves onboarding with no name. A submit that reads the name
 * from before the last keystrokes needs characters and the return key in one batch, which a browser
 * never delivers, so that case is not covered here.
 */
test('the name step takes the return key only with a name', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'session-name-return-'))
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

  await page.getByTestId(ELEMENT.onboarding.createAccount).first().click({ timeout: 20_000 })
  const field = page.getByTestId(ELEMENT.onboarding.displayNameInput).first()
  await expect(field).toBeVisible()

  await field.press('Enter')
  await expect(page.getByTestId(ELEMENT.onboarding.displayNameScreen).first()).toBeVisible()
  await expect(page.getByTestId(ELEMENT.conversationList.screen)).toHaveCount(0)

  await field.fill('Tester')
  await field.press('Enter')
  await expect(page.getByTestId(ELEMENT.conversationList.screen).first()).toBeVisible({
    timeout: 20_000,
  })

  await app.close()
})
