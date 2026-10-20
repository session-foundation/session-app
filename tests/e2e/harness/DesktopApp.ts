import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { _electron, type ElectronApplication, type Page } from '@playwright/test'
import type { ElementId } from '@session/test-ids'

import { FAKE_LAUNCH_ENV } from './fakeEnv'
import type { ISessionApp } from './ISessionApp'
import type { IFileChooser } from './FileChooser'
import type { ILayoutProbe } from './LayoutProbe'
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

/** What `imageLoaded`'s page-side body touches, and nothing more. */
interface MediaElement {
  getAttribute: (name: string) => string | null
  style?: { backgroundImage?: string }
  querySelector: (selector: string) => { style?: { backgroundImage?: string } } | null
}

interface MediaGlobals {
  Image: new () => {
    naturalWidth: number
    src: string
    onload: (() => void) | null
    onerror: (() => void) | null
  }
  setTimeout: (callback: () => void, ms: number) => unknown
}

interface PageGlobals {
  __longTasks?: LongTask[]
  PerformanceObserver: new (
    callback: (list: { getEntries: () => { startTime: number; duration: number }[] }) => void,
  ) => { observe: (options: { type: string; buffered: boolean }) => void }
  requestAnimationFrame: (callback: () => void) => number
  performance: { now: () => number }
}

/** Only what `clipped` reads of an element, since this program has no DOM types. */
interface LaidOutNode {
  textContent: string | null
  clientWidth: number
  scrollWidth: number
  querySelectorAll(selector: string): ArrayLike<LaidOutNode>
}

/** What the layout probe's page-side bodies touch. */
interface DocumentGlobals {
  document: { documentElement: { dir: string; clientWidth: number } }
  getComputedStyle(element: unknown): { direction: string }
}

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

/**
 * The Electron client, driven by Playwright.
 *
 * testID reaches the DOM as data-testid through react-native-web, so the selector a test
 * writes is the same string the component was given. There is no per-platform locator table
 * here, and there should not need to be one.
 */
export class DesktopApp implements ISessionApp, IPerformanceProbe, IFileChooser, ILayoutProbe {
  readonly platform = 'desktop' as const

  private constructor(
    readonly identity: string,
    private readonly app: ElectronApplication,
    private readonly page: Page,
    private readonly dataDir: string,
  ) {}

  /** `env` is merged over the variables every launch sets, so a spec can override them. */
  static async launch(
    identity: string,
    options: { env?: Record<string, string> | undefined } = {},
  ): Promise<DesktopApp> {
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
        ...FAKE_LAUNCH_ENV,
        SESSION_IDENTITY: identity,
        SESSION_DATA_DIR: dataDir,
        ...options.env,
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

  async isDisabled(id: ElementId): Promise<boolean> {
    return (await this.locator(id).first().getAttribute('aria-disabled')) === 'true'
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

  async count(id: ElementId): Promise<number> {
    return this.locator(id).count()
  }

  async imageLoaded(id: ElementId, options?: { timeoutMs?: number }): Promise<boolean> {
    const element = this.locator(id).first()
    // No element is an answer, not an error: the id is on the picture, not the tile, so a tile
    // never given a url has nothing carrying it - and "is the picture here" is false exactly then.
    try {
      await element.waitFor({ state: 'attached', timeout: options?.timeoutMs ?? 10_000 })
    } catch {
      return false
    }

    // react-native-web draws an Image as a div with a background-image rather than an <img>, so
    // there is no naturalWidth to read. Loading the same URL again answers the question and is
    // free: whatever the element fetched is in the renderer's cache by then.
    return element.evaluate(
      (node: unknown, timeoutMs: number) =>
        new Promise<boolean>((resolve) => {
          const el = node as MediaElement
          const g = globalThis as unknown as MediaGlobals
          const own = el.style?.backgroundImage ?? ''
          const nested = el.querySelector('div')?.style?.backgroundImage ?? ''
          const source =
            el.getAttribute('src') ?? /url\("?([^")]+)"?\)/.exec(own || nested)?.[1] ?? null
          if (source === null) {
            resolve(false)
            return
          }
          const probe = new g.Image()
          probe.onload = () => resolve(probe.naturalWidth > 0)
          probe.onerror = () => resolve(false)
          probe.src = source
          g.setTimeout(() => resolve(false), timeoutMs)
        }),
      options?.timeoutMs ?? 10_000,
    )
  }

  async screenshot(name: string): Promise<void> {
    // Animations frozen at their end state, so an artifact taken the moment a surface opens is
    // the surface rather than a frame of it fading in - which is a picture that reads as a bug.
    await this.page.screenshot({
      path: join(repoRoot, 'test-results', `${name}.png`),
      animations: 'disabled',
    })
  }

  // -- IFileChooser -----------------------------------------------------------------------

  // Each arms one answer. A dialog nothing armed rejects rather than opening, so a spec that
  // exports twice after arming once fails there instead of reusing the answer.
  async answerSaveDialogWith(path: string): Promise<void> {
    await this.app.evaluate(({ dialog }, chosen) => {
      dialog.showSaveDialog = () => {
        dialog.showSaveDialog = () => Promise.reject(new Error('A save dialog nothing answered'))
        return Promise.resolve({ canceled: false, filePath: chosen })
      }
    }, path)
  }

  async cancelNextSaveDialog(): Promise<void> {
    await this.app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = () => {
        dialog.showSaveDialog = () => Promise.reject(new Error('A save dialog nothing answered'))
        return Promise.resolve({ canceled: true, filePath: '' })
      }
    })
  }

  async recordReveals(): Promise<void> {
    await this.app.evaluate(({ shell }) => {
      // Kept on the main process because a later evaluate can read it back there. Replacing the
      // call also stops a file manager window opening on whoever is running the suite.
      const global = globalThis as unknown as { sessionRevealed?: string[] }
      global.sessionRevealed = []
      shell.showItemInFolder = (revealed: string) => global.sessionRevealed?.push(revealed)
    })
  }

  async revealedPaths(): Promise<string[]> {
    const revealed = await this.app.evaluate(
      () => (globalThis as unknown as { sessionRevealed?: string[] }).sessionRevealed ?? null,
    )
    // An empty answer from a recorder nobody installed would pass any "nothing was revealed" check.
    if (revealed === null) throw new Error('revealedPaths() read before recordReveals()')
    return revealed
  }

  // -- ILayoutProbe -----------------------------------------------------------------------

  async documentDirection(): Promise<string> {
    return this.page.evaluate(
      () => (globalThis as unknown as DocumentGlobals).document.documentElement.dir,
    )
  }

  async horizontalHalf(id: ElementId): Promise<'left' | 'right'> {
    const box = await this.locator(id).first().boundingBox()
    if (box === null) throw new Error(`${id} is not laid out`)
    // Electron windows have no emulated viewport, so page.viewportSize() is null here.
    const width = await this.page.evaluate(
      () => (globalThis as unknown as DocumentGlobals).document.documentElement.clientWidth,
    )
    return box.x + box.width / 2 > width / 2 ? 'right' : 'left'
  }

  async verticalCentre(id: ElementId): Promise<number> {
    const box = await this.locator(id).first().boundingBox()
    if (box === null) throw new Error(`${id} is not laid out`)
    return box.y + box.height / 2
  }

  async clipped(id: ElementId): Promise<boolean[]> {
    return this.locator(id).evaluateAll((elements) =>
      (elements as unknown as LaidOutNode[]).map((element) =>
        [element, ...Array.from(element.querySelectorAll('*'))].some(
          (node) =>
            (node.textContent ?? '') !== '' &&
            (node.clientWidth === 0 || node.scrollWidth > node.clientWidth + 1),
        ),
      ),
    )
  }

  async directions(id: ElementId): Promise<string[]> {
    return this.locator(id).evaluateAll((elements) =>
      elements.map(
        (element) => (globalThis as unknown as DocumentGlobals).getComputedStyle(element).direction,
      ),
    )
  }

  async isLeftOf(first: ElementId, second: ElementId): Promise<boolean> {
    const [a, b] = await Promise.all([
      this.locator(first).first().boundingBox(),
      this.locator(second).first().boundingBox(),
    ])
    if (a === null || b === null) throw new Error(`${first} or ${second} is not laid out`)
    return a.x + a.width / 2 < b.x + b.width / 2
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

  async pageNow(): Promise<number> {
    return this.page.evaluate(() => performance.now())
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
