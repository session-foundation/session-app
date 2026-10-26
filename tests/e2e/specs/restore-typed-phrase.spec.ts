import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron, expect, test } from '@playwright/test'
import { ELEMENT } from '@session/test-ids'

import { FAKE_LAUNCH_ENV } from '../harness/fakeEnv'

const repoRoot = join(import.meta.dirname, '../../..')

/**
 * A typed recovery phrase reaches the bridge and gets an answer.
 *
 * The phrase is the one request that crosses the bridge port carrying a secret, and the only one
 * whose sending is special-cased in the renderer. When that special case listed the phrase's buffer
 * for transfer, Electron's main-process port dropped the message without a word: the screen sat on
 * a spinning Continue with back disabled, and nothing on either side reported anything. Only the
 * whole app, renderer and main together, can show it.
 *
 * Any 13 words do on the fake, which checks the count and leaves the word lists to libsession.
 */
test('a typed recovery phrase gets past the restore screen', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'session-typed-phrase-'))
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
  try {
    const page = await app.firstWindow()

    await page.getByTestId(ELEMENT.onboarding.restoreAccount).first().click({ timeout: 20_000 })
    const screen = page.getByTestId(ELEMENT.onboarding.loadAccountScreen).first()
    await screen.waitFor()

    await page
      .getByTestId(ELEMENT.onboarding.recoveryPhraseInput)
      .first()
      .fill(Array.from({ length: 13 }, (_, i) => `word${String.fromCharCode(97 + i)}`).join(' '))
    await page.getByTestId(ELEMENT.onboarding.continueButton).first().click()

    await expect(page.getByTestId(ELEMENT.onboarding.loadAccountScreen)).toHaveCount(0, {
      timeout: 15_000,
    })
  } finally {
    await app.close()
  }
})
