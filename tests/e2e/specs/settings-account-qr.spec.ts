import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron, expect, test } from '@playwright/test'
import { ELEMENT } from '@session/test-ids'

import { FAKE_LAUNCH_ENV } from '../harness/fakeEnv'

const repoRoot = join(import.meta.dirname, '../../..')

/** The first eight bytes of every PNG. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** The display picture's diameter at rest and enlarged. */
const RESTING_PX = 90
const ENLARGED_PX = 190

/**
 * The top of Settings: the display picture swapped for the account's QR code, the desktop's
 * full-screen code and its Save, back to the picture, and the picture enlarged in place. One pass,
 * because each step starts from the state the last one left.
 */
test('swaps the display picture for the account QR code, opens it full screen, and enlarges the picture @desktop', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'session-settings-account-qr-'))
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
    await page.getByTestId(ELEMENT.rail.settings).first().click()

    const avatar = page.getByTestId(ELEMENT.settings.avatar).first()
    const name = page.getByTestId(ELEMENT.settings.displayName).first()
    const qr = page.getByTestId(ELEMENT.settings.accountQr).first()
    await expect(avatar).toBeVisible()
    await expect(name).toBeVisible()

    await page.getByTestId(ELEMENT.settings.qrToggle).first().click()
    await expect(qr).toBeVisible()
    await expect(page.getByTestId(ELEMENT.settings.avatar)).toHaveCount(0)
    await expect(page.getByTestId(ELEMENT.settings.displayName)).toHaveCount(0)
    // The ID stays: the code stands for it.
    await expect(page.getByTestId(ELEMENT.settings.copyAccountId).first()).toBeVisible()

    // The full-screen code, and Save on it, answered as a person would answer the dialog.
    await qr.click()
    const fullScreen = page.getByTestId(ELEMENT.settings.accountQrFullScreen).first()
    await expect(fullScreen).toBeVisible()
    const saved = join(dataDir, 'account.png')
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path })
    }, saved)
    // The middle, which is the code: a press beside it is a press on the backdrop.
    await fullScreen.click({ button: 'right' })
    await page.getByTestId(ELEMENT.contextMenu.item('save')).first().click()
    await expect.poll(() => existsSync(saved), { timeout: 10_000 }).toBe(true)
    expect([...readFileSync(saved).subarray(0, 8)]).toEqual(PNG_SIGNATURE)

    // Escape is the full-screen modal's own: react-native-web gives it to the topmost modal that
    // has finished opening, which is the menu until the menu has finished closing. Pressed again
    // only while the code is still up, so a press never reaches Settings underneath.
    await expect(async () => {
      if ((await fullScreen.count()) > 0) await page.keyboard.press('Escape')
      await expect(fullScreen).toHaveCount(0, { timeout: 1_000 })
    }).toPass({ timeout: 10_000 })
    // One level only: Settings is still open, on the code.
    await expect(qr).toBeVisible()

    // And the close button, which says it can be closed at all.
    await qr.click()
    await expect(fullScreen).toBeVisible()
    await page.getByTestId(ELEMENT.qrViewer.close).first().click()
    await expect(fullScreen).toHaveCount(0)
    await expect(qr).toBeVisible()

    await page.getByTestId(ELEMENT.settings.qrBack).first().click()
    await expect(avatar).toBeVisible()
    await expect(name).toBeVisible()
    await expect(page.getByTestId(ELEMENT.settings.accountQr)).toHaveCount(0)

    // From the keyboard, the focus follows each swap to the badge that swaps back, rather than
    // falling to the page with the badge that was pressed.
    await page.getByTestId(ELEMENT.settings.qrToggle).first().focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId(ELEMENT.settings.qrBack).first()).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId(ELEMENT.settings.qrToggle).first()).toBeFocused()

    expect((await avatar.boundingBox())?.width).toBe(RESTING_PX)
    await avatar.click()
    await expect.poll(async () => (await avatar.boundingBox())?.width).toBe(ENLARGED_PX)
    await avatar.click()
    await expect.poll(async () => (await avatar.boundingBox())?.width).toBe(RESTING_PX)
  } finally {
    await app.close()
  }
})
