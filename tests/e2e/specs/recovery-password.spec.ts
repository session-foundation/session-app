import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron, expect, test } from '@playwright/test'
import { PENDING_COPY } from '@session/localization'
import { ELEMENT } from '@session/test-ids'

import { FAKE_LAUNCH_ENV } from '../harness/fakeEnv'

const repoRoot = join(import.meta.dirname, '../../..')

/** The first eight bytes of every PNG. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * The recovery password from the settings row to hiding it: words, the QR code, the desktop's
 * full-screen code and its Save, then the two confirmations. One pass, because hiding is for good
 * and every step before it needs the row still there.
 */
test('shows the recovery password as words and a QR code, saves the code, and hides it @desktop', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'session-recovery-password-'))
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

    await page.getByTestId(ELEMENT.settings.row('recovery-password')).first().click()
    // The fake's thirteen words, in the order libsession would give them.
    const words = page.getByTestId(ELEMENT.recoveryPassword.words).first()
    await expect(words).toBeVisible()
    expect((await words.textContent())?.split(' ')).toHaveLength(13)

    await page.getByTestId(ELEMENT.recoveryPassword.viewQr).first().click()
    await expect(page.getByTestId(ELEMENT.recoveryPassword.qr).first()).toBeVisible()
    await expect(words).toHaveCount(0)

    // The full-screen code, and Save on it, answered as a person would answer the dialog.
    await page.getByTestId(ELEMENT.recoveryPassword.qr).first().click()
    const fullScreen = page.getByTestId(ELEMENT.recoveryPassword.qrFullScreen).first()
    await expect(fullScreen).toBeVisible()
    const saved = join(dataDir, 'recovery.png')
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
    // One level only: still on the recovery password, not back in Settings.
    await expect(page.getByTestId(ELEMENT.recoveryPassword.viewWords).first()).toBeVisible()
    await page.getByTestId(ELEMENT.recoveryPassword.viewWords).first().click()
    await expect(words).toBeVisible()

    // From the keyboard, the focus follows each swap to the button that swaps back, rather than
    // falling to the page with the button that was pressed.
    await page.getByTestId(ELEMENT.recoveryPassword.viewQr).first().focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId(ELEMENT.recoveryPassword.viewWords).first()).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId(ELEMENT.recoveryPassword.viewQr).first()).toBeFocused()

    // Two confirmations, the second with Cancel where the first had Continue.
    await page.getByTestId(ELEMENT.recoveryPassword.hide).first().click()
    const proceed = page.getByTestId(ELEMENT.recoveryPassword.hideContinue).first()
    const continueAt = await proceed.boundingBox()
    await proceed.click()
    const cancelAt = await page
      .getByTestId(ELEMENT.recoveryPassword.hideCancel)
      .first()
      .boundingBox()
    expect(cancelAt?.x).toBe(continueAt?.x)
    await page.getByTestId(ELEMENT.recoveryPassword.hideYes).first().click()

    // Back at Settings, where the row has gone and a line in its place says so.
    await expect(page.getByTestId(ELEMENT.settings.accountId).first()).toBeVisible()
    await expect(page.getByTestId(ELEMENT.settings.row('recovery-password'))).toHaveCount(0)
    await expect(
      page.getByTestId(ELEMENT.settings.row('recovery-password-hidden')).first(),
    ).toHaveText(PENDING_COPY.recoveryPasswordHiddenOnDevice)
  } finally {
    await app.close()
  }
})
