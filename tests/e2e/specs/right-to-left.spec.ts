import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron, expect, test } from '@playwright/test'
import { ELEMENT } from '@session/test-ids'

const repoRoot = join(import.meta.dirname, '../../..')

/** Arabic, which `isRtlLocale` answers true for and which the catalogue ships. */
const RTL_LOCALE = 'ar'

/**
 * The one browser global this spec's page-side body touches.
 *
 * Declared rather than pulled in with `dom`, for the reason `DesktopApp` gives: harness code runs
 * in Node and a stray `document` there should stay an error. A body that is serialised into the
 * renderer is the exception, and it gets the types it needs and nothing else does.
 */
interface PageGlobals {
  document: { documentElement: { dir: string } }
}

/**
 * Choosing a right-to-left language mirrors the layout, not just the text.
 *
 * `applyDirection` writes `dir` on the document element and everything below follows from that --
 * flex rows reverse, logical edges swap, and the components that have to ask read `isLayoutRtl()`.
 * None of it is observable from a unit test: `packages/ui` has no document, and the whole point is
 * what the browser does with one attribute.
 *
 * It sits here rather than beside a feature because it is the standing check. A component that
 * places something with `left` instead of `insetInlineStart` looks correct in every English
 * screenshot ever taken of it, and this is the run where that shows up.
 */
test('choosing a right-to-left language mirrors the layout', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'session-rtl-'))
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
      ELECTRON_RUN_AS_NODE: '',
      EXPO_PUBLIC_SESSION_FAKE: '1',
      SESSION_FAKE: '1',
      SESSION_FAKE_NO_ACCOUNT: '1',
      SESSION_DATA_DIR: dataDir,
    },
  })
  const page = await app.firstWindow()

  const direction = () =>
    page.evaluate(() => (globalThis as unknown as PageGlobals).document.documentElement.dir)

  // Asserted before as well as after: a document that was already `rtl` would pass the second
  // check without the picker having done anything.
  await page.getByTestId(ELEMENT.languagePicker.trigger).first().click({ timeout: 20_000 })
  expect(await direction()).not.toBe('rtl')

  await page.getByTestId(ELEMENT.languagePicker.panel).first().waitFor()
  await page.getByTestId(ELEMENT.languagePicker.option(RTL_LOCALE)).first().click()

  await expect.poll(direction).toBe('rtl')

  // The screenshot is the half a `dir` assertion cannot make: an element placed with a physical
  // edge still leaves `dir` correct and lands on the wrong side.
  await page.screenshot({ path: join(repoRoot, 'test-results', 'right-to-left.png') })
  await app.close()
})
