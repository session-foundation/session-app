import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { _electron, type ElectronApplication, type Page } from '@playwright/test'
import type { ElementId } from '@session/test-ids'

import type { ISessionApp } from './ISessionApp'
import type { IPerformanceProbe } from './PerformanceProbe'

/**
 * The handful of browser globals the probe's page-side code touches.
 *
 * Declared here rather than by adding `dom` to this package's lib, because the environment split
 * is deliberate: harness code runs in Node, and a stray `window` in it should stay an error. These
 * bodies are the exception - they are serialised and run in the renderer - so they get the types
 * they need and nothing else does.
 */
interface LongTask {
  start: number
  duration: number
}

interface PageGlobals {
  __longTasks?: LongTask[]
  PerformanceObserver: new (
    callback: (list: { getEntries: () => { startTime: number; duration: number }[] }) => void,
  ) => { observe: (options: { type: string; buffered: boolean }) => void }
  requestAnimationFrame: (callback: () => void) => number
  performance: { now: () => number }
}

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

/**
 * The Electron client, driven by Playwright.
 *
 * testID reaches the DOM as data-testid through react-native-web, so the selector a test
 * writes is the same string the component was given. There is no per-platform locator table
 * here, and there should not need to be one.
 */
export class DesktopApp implements ISessionApp, IPerformanceProbe {
  readonly platform = 'desktop' as const

  private constructor(
    readonly identity: string,
    private readonly app: ElectronApplication,
    private readonly page: Page,
    private readonly dataDir: string,
  ) {}

  static async launch(identity: string): Promise<DesktopApp> {
    // Its own data directory, thrown away afterwards: two clients in one run must never
    // share libsession's database, and a leftover one would make the next run start with
    // yesterday's conversations.
    const dataDir = mkdtempSync(join(tmpdir(), `session2-${identity}-`))

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
        // Electron refuses Chromium's flags when this is set, and terminals set it.
        ELECTRON_RUN_AS_NODE: '',
        SESSION_FAKE: '1',
        SESSION_IDENTITY: identity,
        SESSION_DATA_DIR: dataDir,
      },
    })

    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    return new DesktopApp(identity, app, page, dataDir)
  }

  private locator(id: ElementId) {
    return this.page.getByTestId(id)
  }

  async waitForVisible(id: ElementId, options?: { timeoutMs?: number }): Promise<void> {
    await this.locator(id)
      .first()
      .waitFor({ state: 'visible', timeout: options?.timeoutMs ?? 10_000 })
  }

  async isVisible(id: ElementId): Promise<boolean> {
    return this.locator(id).first().isVisible()
  }

  async tap(id: ElementId): Promise<void> {
    await this.locator(id).first().click()
  }

  async type(id: ElementId, text: string): Promise<void> {
    await this.locator(id).first().fill(text)
  }

  async readText(id: ElementId): Promise<string> {
    return (await this.locator(id).first().textContent()) ?? ''
  }

  async readAllText(id: ElementId): Promise<string[]> {
    return this.locator(id).allTextContents()
  }

  async screenshot(name: string): Promise<void> {
    await this.page.screenshot({ path: join(repoRoot, 'test-results', `${name}.png`) })
  }

  // -- IPerformanceProbe ------------------------------------------------------------------

  async startProbe(): Promise<void> {
    await this.page.evaluate(() => {
      const g = globalThis as unknown as PageGlobals
      if (g.__longTasks) return
      const collected: LongTask[] = []
      g.__longTasks = collected
      // buffered, so a task that ran between load and this call is not lost - which is most of
      // startup, and startup is the interesting part.
      new g.PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          collected.push({ start: entry.startTime, duration: entry.duration })
        }
      }).observe({ type: 'longtask', buffered: true })
    })
  }

  async readLongTasks(): Promise<LongTask[]> {
    return this.page.evaluate(() => {
      const g = globalThis as unknown as PageGlobals
      return g.__longTasks ?? []
    })
  }

  async timeUntilVisible(testId: string, timeoutMs = 30_000): Promise<number> {
    const start = performance.now()
    await this.page.getByTestId(testId).first().waitFor({ state: 'visible', timeout: timeoutMs })
    return performance.now() - start
  }

  async countFrames(windowMs: number): Promise<number> {
    return this.page.evaluate(async (ms: number) => {
      const g = globalThis as unknown as PageGlobals
      return new Promise<number>((resolve) => {
        let frames = 0
        const deadline = g.performance.now() + ms
        const tick = () => {
          frames++
          if (g.performance.now() < deadline) g.requestAnimationFrame(tick)
          else resolve(frames)
        }
        g.requestAnimationFrame(tick)
      })
    }, windowMs)
  }

  async close(): Promise<void> {
    await this.app.close()
    rmSync(this.dataDir, { recursive: true, force: true })
  }
}
