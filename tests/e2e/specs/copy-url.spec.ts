import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron, expect, test } from '@playwright/test'
import { ELEMENT } from '@session/test-ids'

import { FAKE_LAUNCH_ENV } from '../harness/fakeEnv'

const repoRoot = join(import.meta.dirname, '../../..')

interface PageGlobals {
  sessionDesktop: { copyText(text: string): Promise<void> }
}

/**
 * The renderer is refused every permission, so a copy reaches the clipboard only through the main
 * process, and a refusal there has to reach the page as a rejection rather than a silent success.
 */
test('copies a URL through main, and rejects a copy main refuses', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'session-copy-url-'))
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
      SESSION_DATA_DIR: dataDir,
    },
  })
  try {
    const page = await app.firstWindow()
    const readClipboard = () => app.evaluate(({ clipboard }) => clipboard.readText())

    await page.getByTestId(ELEMENT.onboarding.faqLink).first().waitFor({ timeout: 20_000 })
    await app.evaluate(({ clipboard }) => clipboard.writeText('untouched'))

    const oversized = await page.evaluate(() =>
      (globalThis as unknown as PageGlobals).sessionDesktop.copyText('x'.repeat(1024 * 1024)).then(
        () => 'written',
        () => 'refused',
      ),
    )
    expect(oversized).toBe('refused')
    expect(await readClipboard()).toBe('untouched')

    await page.getByTestId(ELEMENT.onboarding.faqLink).first().click()
    await page.getByTestId(ELEMENT.onboarding.copyUrl).first().click()

    await expect.poll(readClipboard).toMatch(/^https:\/\/\S+/)
  } finally {
    await app.close()
  }
})
