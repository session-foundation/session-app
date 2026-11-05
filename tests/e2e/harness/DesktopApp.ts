import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { AxeBuilder } from '@axe-core/playwright'
import {
  _electron,
  type CDPSession,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test'
import type { ElementId } from '@session/test-ids'

import { FAKE_LAUNCH_ENV } from './fakeEnv'
import type { AccessibleNode, AuditIssue, Frame, ISessionApp } from './ISessionApp'
import type { IFileChooser } from './FileChooser'
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

/** What `focusedStop`'s page-side body reads. */
interface FocusNode {
  getAttribute(name: string): string | null
}

interface FocusGlobals {
  document: {
    activeElement: FocusNode | null
    body: FocusNode
    documentElement: FocusNode
    querySelectorAll(selector: string): ArrayLike<FocusNode>
  }
}

/** What `audit` asks of the element axe names. */
interface TestIdOwner {
  closest(selector: string): TestIdOwner | null
  getAttribute(name: string): string | null
}

/** The part of a CDP `Accessibility.AXNode` that `describe` reads. */
interface AXNode {
  ignored: boolean
  ignoredReasons?: { name: string }[]
  role?: { value?: unknown }
  name?: { value?: unknown }
  description?: { value?: unknown }
  properties?: { name: string; value: { value?: unknown } }[]
}

/** Where focus sits: its test id, and which of the elements carrying it, from 0. */
export interface FocusedStop {
  testID: string | null
  at: number
}

/** Chromium's computed roles, folded onto the few every platform's tree can tell apart. */
const ROLES: Record<string, AccessibleNode['role']> = {
  button: 'button',
  image: 'image',
  img: 'image',
  link: 'link',
  textbox: 'textbox',
  searchbox: 'textbox',
  progressbar: 'progressbar',
  StaticText: 'text',
  paragraph: 'text',
  heading: 'text',
}

const testIdSelector = (id: string) => `[data-testid=${JSON.stringify(id)}]`

const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null

const BLOCKING_IMPACTS = new Set(['serious', 'critical'])

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

/**
 * Whoever runs the suite asked for no window on screen: `pnpm catalog:compare` does, so a capture
 * on a developer's Mac neither covers the screen nor takes focus. The app reads it from the env a
 * launch passes on; see apps/desktop/src/main/hiddenRun.ts.
 */
const HIDDEN_RUN_VARIABLE = 'SESSION_E2E_HIDDEN'
const hiddenRunAsked = process.env[HIDDEN_RUN_VARIABLE] === '1'

/**
 * The Electron client, driven by Playwright.
 *
 * testID reaches the DOM as data-testid through react-native-web, so the selector a test
 * writes is the same string the component was given. There is no per-platform locator table
 * here, and there should not need to be one.
 */
export class DesktopApp implements ISessionApp, IPerformanceProbe, IFileChooser {
  readonly platform = 'desktop' as const
  private cdp: CDPSession | null = null

  /** `page` is public for desktop-only specs, which assert through Playwright's own matchers. */
  private constructor(
    readonly identity: string,
    private readonly app: ElectronApplication,
    readonly page: Page,
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
        // Pictures in sRGB, as the Linux captures Argos compares with are. On a Mac a capture is
        // otherwise encoded in the display's colour space, which a window opening elsewhere can
        // change between two pages. Here rather than in main's `appendSwitch`, which is too late
        // for it.
        '--force-color-profile=srgb',
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
    // A build without hidden runs ignores the variable and shows its window: stopped at once
    // rather than left on screen for the length of a run that was promised to stay out of sight.
    if (
      hiddenRunAsked &&
      (await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((window) => window.isVisible()),
      ))
    ) {
      await app.close()
      rmSync(dataDir, { recursive: true, force: true })
      throw new Error(`${HIDDEN_RUN_VARIABLE}=1, but this desktop build showed its window`)
    }
    await page.waitForLoadState('domcontentloaded')
    return new DesktopApp(identity, app, page, dataDir)
  }

  locator(id: ElementId): Locator {
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

  async tapAt(id: ElementId, at: number): Promise<void> {
    await this.locator(id).nth(at).click()
  }

  async tapPoint(x: number, y: number): Promise<void> {
    await this.page.mouse.click(x, y)
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

  async describe(id: ElementId, at = 0): Promise<AccessibleNode | null> {
    const element = this.locator(id).nth(at)
    if ((await element.count()) === 0) return null
    this.cdp ??= await this.page.context().newCDPSession(this.page)
    // getByTestId's own match, in document order, which is the order `nth` counts in.
    const { result } = await this.cdp.send('Runtime.evaluate', {
      expression: `document.querySelectorAll(${JSON.stringify(testIdSelector(id))})[${String(at)}]`,
    })
    if (result.objectId === undefined) return null
    const { nodes } = (await this.cdp.send('Accessibility.getPartialAXTree', {
      objectId: result.objectId,
      fetchRelatives: false,
    })) as { nodes: AXNode[] }
    await this.cdp.send('Runtime.releaseObject', { objectId: result.objectId })
    const node = nodes[0]
    if (node === undefined) return null
    if (node.ignored) {
      // Chromium folds a plain box of text into its text; a reader still reads that text there.
      const hidden = node.ignoredReasons?.some((reason) => reason.name.startsWith('ariaHidden'))
      const text = hidden === true ? null : stringOrNull((await element.innerText()).trim())
      if (text === null) return null
      const box = await element.boundingBox()
      return {
        role: 'text',
        name: text,
        hint: null,
        disabled: false,
        busy: false,
        focusable: false,
        bounds: { width: box?.width ?? 0, height: box?.height ?? 0 },
      }
    }

    const property = (name: string) =>
      node.properties?.find((entry) => entry.name === name)?.value.value
    const box = await element.boundingBox()
    const name = stringOrNull(node.name?.value)
    return {
      // The web has no role for text: a generic element that says something is read as text, as
      // the render tier and the native drivers read one.
      role: ROLES[String(node.role?.value)] ?? (name === null ? 'none' : 'text'),
      name,
      hint: stringOrNull(node.description?.value),
      disabled: property('disabled') === true,
      busy: property('busy') === true,
      focusable: property('focusable') === true,
      bounds: { width: box?.width ?? 0, height: box?.height ?? 0 },
    }
  }

  async frame(id: ElementId, at = 0): Promise<Frame | null> {
    const element = this.locator(id).nth(at)
    if ((await element.count()) === 0) return null
    return element.boundingBox()
  }

  async reveal(id: ElementId, _within: ElementId, at = 0): Promise<void> {
    await this.locator(id).nth(at).scrollIntoViewIfNeeded()
  }

  async audit(scope?: ElementId): Promise<AuditIssue[]> {
    // Legacy mode runs axe in the page; the default opens a second page, which Electron refuses.
    const builder = new AxeBuilder({ page: this.page }).setLegacyMode(true)
    if (scope !== undefined) builder.include(testIdSelector(scope))
    const { violations } = await builder.analyze()
    const found = violations.flatMap((violation) =>
      violation.nodes
        .filter((node) => BLOCKING_IMPACTS.has(node.impact ?? violation.impact ?? ''))
        .map((node) => ({
          rule: violation.id,
          impact: (node.impact ?? violation.impact) as AuditIssue['impact'],
          selector: node.target.join(' '),
          message: node.failureSummary ?? violation.help,
        })),
    )
    // axe names a node by a selector of tamagui's hashed classes; the nearest test id is stable.
    const owners = await this.page.evaluate(
      (selectors) =>
        selectors.map((selector) => {
          const { document } = globalThis as unknown as {
            document: { querySelector(selector: string): TestIdOwner | null }
          }
          const owner = document.querySelector(selector)?.closest('[data-testid]') ?? null
          return owner?.getAttribute('data-testid') ?? null
        }),
      found.map((issue) => issue.selector),
    )
    return found.map(({ selector, ...issue }, at) => ({
      ...issue,
      target: owners[at] ?? selector,
    }))
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

  // -- Desktop only ----------------------------------------------------------------------

  /**
   * For every element with this id, whether any text in it is cut short: an ellipsis, or a box
   * with no width to draw into. No matcher says so, since an overflow is no CSS value.
   */
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

  /** The page's own size, in CSS px: the window's frame is the window manager's. */
  async resize(width: number, height: number): Promise<void> {
    await this.app.evaluate(
      ({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height)
      },
      { width, height },
    )
    await this.page.waitForFunction(
      (wanted) => (globalThis as unknown as { innerWidth: number }).innerWidth === wanted,
      width,
      { timeout: 5_000 },
    )
  }

  /** Null where nothing but the page has focus. `at` counts the elements carrying its id. */
  async focusedStop(): Promise<FocusedStop | null> {
    return this.page.evaluate(() => {
      const { document } = globalThis as unknown as FocusGlobals
      const node = document.activeElement
      if (node === null || node === document.body || node === document.documentElement) return null
      const testID = node.getAttribute('data-testid')
      const peers = document.querySelectorAll(
        testID === null ? '*' : `[data-testid=${JSON.stringify(testID)}]`,
      )
      return { testID, at: Array.prototype.indexOf.call(peers, node) }
    })
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
