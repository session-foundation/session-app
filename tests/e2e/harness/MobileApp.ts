import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { ELEMENT, type ElementId } from '@session/test-ids'
import { remote } from 'webdriverio'

import { METRO_PORT, serveBundle } from './bundleServer'
import { FAKE_LAUNCH_ENV } from './fakeEnv'
import type { AccessibleNode, AuditIssue, Frame, ISessionApp } from './ISessionApp'
import {
  androidAccessibleNode,
  androidAudit,
  androidCustomActions,
  androidHidden,
  iosAccessibleNode,
  iosTargetSizes,
  nativeFrame,
  shownWhole,
  testIdOf,
} from './nativeAccessibility'
import { parseNativeTree, walk, type NativeNode } from './nativeTree'

const run = promisify(execFile)

export type MobilePlatform = 'android' | 'ios'
export type FormFactor = 'phone' | 'tablet'

type Driver = Awaited<ReturnType<typeof remote>>

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

/** From `apps/mobile/app.json`; iOS adds the suffix `app.config.ts` gives every test build. */
const APP_ID: Readonly<Record<MobilePlatform, string>> = {
  android: 'org.getsession.session2',
  ios: 'org.getsession.session2-test',
}

const DEFAULT_WAIT_MS = 10_000
/** A cold start reads the whole bundle over the network before the first screen draws. */
const FIRST_SCREEN_MS = 180_000
const POLL_MS = 250
/** Swipes `reveal` makes each way before giving up on an element. */
const REVEAL_SWIPES = 8

/** An accessibility element as `idb ui describe-all` lists it. */
interface IdbElement {
  AXUniqueId?: string | null
  help?: string | null
  custom_actions?: string[]
  frame?: { x: number; y: number }
}

/** One finding of XCTest's `performAccessibilityAudit`, as Appium hands it on. */
interface AppleAuditFinding {
  auditType: string | number
  compactDescription: string
  /** XCTest's description of the element, its identifier among it. */
  element: string
}

/** The serial or simulator id each device is reached by, from the harness host's environment. */
function deviceId(platform: MobilePlatform, form: FormFactor): string {
  const name = `SESSION_E2E_${platform.toUpperCase()}_${form.toUpperCase()}`
  const id = process.env[name]
  if (id === undefined || id === '')
    throw new Error(`${name} is not set: the ${platform} ${form} to run on, by serial or udid`)
  return id
}

function appiumEndpoint(): { protocol: string; hostname: string; port: number; path: string } {
  const url = new URL(process.env['SESSION_E2E_APPIUM_URL'] ?? 'http://127.0.0.1:4723')
  return {
    protocol: url.protocol.replace(':', ''),
    hostname: url.hostname,
    port: Number(url.port || '4723'),
    path: url.pathname,
  }
}

const adb = () =>
  join(process.env['ANDROID_HOME'] ?? process.env['ANDROID_SDK_ROOT'] ?? '', 'platform-tools/adb')

const ANIMATION_SCALES = [
  'animator_duration_scale',
  'transition_animation_scale',
  'window_animation_scale',
] as const

/** Each of Android's animation scales on the device, as `settings get` reads it. */
async function animationScales(id: string): Promise<string[]> {
  return Promise.all(
    ANIMATION_SCALES.map(async (scale) =>
      (await run(adb(), ['-s', id, 'shell', 'settings', 'get', 'global', scale])).stdout.trim(),
    ),
  )
}

async function setAnimationScales(id: string, values: readonly string[]): Promise<void> {
  for (const [at, scale] of ANIMATION_SCALES.entries())
    await run(adb(), ['-s', id, 'shell', 'settings', 'put', 'global', scale, values[at] ?? '1'])
}

/**
 * A client on an Android emulator or an iOS simulator, through Appium: UiAutomator2 finds an
 * element by its resource id, which react-native sets from `testID`; XCUITest by its
 * accessibility identifier, which is the same string.
 *
 * The dev client is installed already, and the fake's photographs pushed to it. Each launch
 * points it at a Metro serving a bundle built with the launch's environment; see `serveBundle`.
 */
export class MobileApp implements ISessionApp {
  private density: number | null = null
  /** What the last read saw, so that a scroll can tell whether it moved without another. */
  private lastSource: string | null = null
  /** The page source `scroll` read after its swipe, which an `audit` straight after reads. */
  private scrolledTo: string | null = null

  private constructor(
    readonly platform: MobilePlatform,
    readonly identity: string,
    readonly form: FormFactor,
    private readonly device: string,
    private readonly driver: Driver,
    /** Android's animation scales before the launch turned them off, which `close` puts back. */
    private readonly scales: readonly string[] | null,
  ) {}

  /** `env` is merged over the variables every launch sets, and is inlined into the bundle. */
  static async launch(
    platform: MobilePlatform,
    identity: string,
    options: { env?: Record<string, string> | undefined; form?: FormFactor | undefined } = {},
  ): Promise<MobileApp> {
    const form = options.form ?? 'phone'
    const device = deviceId(platform, form)
    await serveBundle({ ...FAKE_LAUNCH_ENV, ...options.env }, platform)
    // No motion for the run, so a capture never lands mid-transition; `close` puts it back.
    const scales = platform === 'android' ? await animationScales(device) : null
    if (scales !== null) await setAnimationScales(device, ['0', '0', '0'])

    const driver = await remote({
      ...appiumEndpoint(),
      logLevel: 'warn',
      connectionRetryTimeout: 600_000,
      capabilities:
        platform === 'android'
          ? {
              platformName: 'Android',
              'appium:automationName': 'UiAutomator2',
              'appium:udid': device,
              'appium:appPackage': APP_ID.android,
              'appium:noReset': true,
              'appium:autoLaunch': false,
              'appium:newCommandTimeout': 600,
              // A running transfer redraws every frame, and waiting for an idle screen then stalls
              // every command for its whole timeout; each wait here is the spec's own.
              'appium:waitForIdleTimeout': 0,
            }
          : {
              platformName: 'iOS',
              'appium:automationName': 'XCUITest',
              'appium:udid': device,
              'appium:bundleId': APP_ID.ios,
              'appium:noReset': true,
              'appium:autoLaunch': false,
              'appium:newCommandTimeout': 600,
              'appium:wdaLaunchTimeout': 600_000,
              'appium:reduceMotion': true,
            },
    })

    const app = new MobileApp(platform, identity, form, device, driver, scales)
    try {
      await app.start()
    } catch (error) {
      await driver.deleteSession().catch(() => undefined)
      if (scales !== null) await setAnimationScales(device, scales)
      throw error
    }
    return app
  }

  private async start(): Promise<void> {
    const appId = APP_ID[this.platform]
    const host = `localhost:${String(METRO_PORT)}`
    if (this.platform === 'android') {
      // A node's accessibility actions, which `customActions` reads, are left out of the source.
      await this.driver.updateSettings({ includeA11yActionsInPageSource: true })
      await this.driver.execute('mobile: terminateApp', { appId })
      // A debug build asks the emulator's host on 8081 unless its dev settings name a server.
      await run(adb(), [
        '-s',
        this.device,
        'reverse',
        `tcp:${String(METRO_PORT)}`,
        `tcp:${String(METRO_PORT)}`,
      ])
      const prefs = `<map><string name="debug_http_host">${host}</string></map>`
      await run(adb(), [
        '-s',
        this.device,
        'shell',
        `run-as ${appId} sh -c 'mkdir -p shared_prefs && echo '"'"'${prefs}'"'"' > shared_prefs/${appId}_preferences.xml'`,
      ])
      await this.driver.execute('mobile: activateApp', { appId })
    } else {
      await this.driver.execute('mobile: terminateApp', { bundleId: appId })
      // An export saves to Photos, and asking would stop it at a system alert no spec answers.
      await run('xcrun', ['simctl', 'privacy', this.device, 'grant', 'photos-add', appId])
      await run('xcrun', [
        'simctl',
        'spawn',
        this.device,
        'defaults',
        'write',
        appId,
        'RCT_jsLocation',
        host,
      ])
      // UTC, because a message's time is drawn in the device's zone.
      await this.driver.execute('mobile: launchApp', {
        bundleId: appId,
        environment: { TZ: 'UTC' },
      })
    }
    await this.waitForVisible(ELEMENT.conversationList.screen, { timeoutMs: FIRST_SCREEN_MS })
  }

  private selector(id: ElementId): string {
    return this.platform === 'android'
      ? `android=new UiSelector().resourceId(${JSON.stringify(id)})`
      : `~${id}`
  }

  private async elements(id: ElementId) {
    return this.driver.$$(this.selector(id)).getElements()
  }

  private async element(id: ElementId, at = 0) {
    const found = await this.elements(id)
    const element = found[at]
    if (element === undefined) throw new Error(`no element ${id} at ${String(at)}`)
    return element
  }

  /** The whole window as the driver reads it. */
  async tree(): Promise<NativeNode> {
    return parseNativeTree(await this.source())
  }

  private async source(): Promise<string> {
    this.lastSource = await this.driver.getPageSource()
    return this.lastSource
  }

  /** Every node carrying the id, in the order a find answers in. */
  private async carrying(id: ElementId): Promise<NativeNode[]> {
    return [...walk(await this.tree())].filter((node) => testIdOf(node, this.platform) === id)
  }

  async waitForVisible(id: ElementId, options?: { timeoutMs?: number }): Promise<void> {
    const deadline = Date.now() + (options?.timeoutMs ?? DEFAULT_WAIT_MS)
    while (!(await this.isVisible(id))) {
      if (Date.now() > deadline) throw new Error(`${id} did not appear`)
      await this.driver.pause(POLL_MS)
    }
  }

  /** From the tree in one read: asking element by element fails slowly on one that just went. */
  async isVisible(id: ElementId): Promise<boolean> {
    const shown = this.platform === 'android' ? 'displayed' : 'visible'
    return (await this.carrying(id)).some((node) => node.attributes[shown] === 'true')
  }

  async isDisabled(id: ElementId): Promise<boolean> {
    return !(await (await this.element(id)).isEnabled())
  }

  async tap(id: ElementId): Promise<void> {
    await this.tapAt(id, 0)
  }

  async tapAt(id: ElementId, at: number): Promise<void> {
    this.scrolledTo = null
    await (await this.element(id, at)).click()
  }

  async tapPoint(x: number, y: number): Promise<void> {
    this.scrolledTo = null
    // Appium takes Android's pixels and iOS's points.
    const scale = this.platform === 'android' ? (await this.screenDensity()) / 160 : 1
    await this.driver
      .action('pointer', { parameters: { pointerType: 'touch' } })
      .move({ x: Math.round(x * scale), y: Math.round(y * scale) })
      .down()
      .pause(50)
      .up()
      .perform()
  }

  async type(id: ElementId, text: string): Promise<void> {
    this.scrolledTo = null
    await (await this.element(id)).setValue(text)
  }

  async readText(id: ElementId): Promise<string> {
    const [first] = await this.readAllText(id)
    if (first === undefined) throw new Error(`no element ${id}`)
    return first
  }

  /** What each carrying the id reads as: a label where a container carries one, as a name does. */
  async readAllText(id: ElementId): Promise<string[]> {
    return (await this.carrying(id)).map((node) =>
      this.platform === 'android'
        ? ((node.attributes['text'] || node.attributes['content-desc']) ?? '')
        : ((node.attributes['label'] || node.attributes['value']) ?? ''),
    )
  }

  async count(id: ElementId): Promise<number> {
    return (await this.elements(id)).length
  }

  imageLoaded(): Promise<boolean> {
    // Neither tree says whether a picture has its bytes; a spec that asks stays on the desktop.
    return Promise.reject(new Error(`imageLoaded has no answer on ${this.platform}`))
  }

  private async screenDensity(): Promise<number> {
    this.density ??= Number(await this.driver.getDisplayDensity())
    return this.density
  }

  async describe(id: ElementId, at = 0): Promise<AccessibleNode | null> {
    const node = (await this.carrying(id))[at]
    if (node === undefined) return null
    if (this.platform === 'android') {
      if (androidHidden(node)) return null
      return androidAccessibleNode(node, await this.screenDensity())
    }
    return iosAccessibleNode(node, await this.iosHint(node))
  }

  async frame(id: ElementId, at = 0): Promise<Frame | null> {
    const node = (await this.carrying(id))[at]
    if (node === undefined) return null
    return nativeFrame(
      node,
      this.platform,
      this.platform === 'android' ? await this.screenDensity() : 1,
    )
  }

  async reveal(id: ElementId, within: ElementId, at = 0): Promise<void> {
    const shown = this.platform === 'android' ? 'displayed' : 'visible'
    const revealed = async () => {
      const node = (await this.carrying(id))[at]
      return node?.attributes[shown] === 'true' && shownWhole(node, this.platform)
    }
    for (const direction of [1, -1] as const)
      for (let swipe = 0; swipe < REVEAL_SWIPES; swipe++) {
        if (await revealed()) return
        if (!(await this.scroll(within, direction, 0.4))) break
      }
    if (!(await revealed())) throw new Error(`${id} at ${String(at)} is nowhere in ${within}`)
  }

  /**
   * What XCUITest does not read of an iOS node: idb reads the accessibility element itself. idb
   * lists only accessibility elements, so the one meant is the one in the node's place.
   */
  private async idbElement(node: NativeNode): Promise<IdbElement | undefined> {
    const { stdout } = await run('idb', ['ui', 'describe-all', '--udid', this.device, '--json'], {
      maxBuffer: 64 * 1024 * 1024,
    })
    const id = testIdOf(node, 'ios')
    const x = Number(node.attributes['x'])
    const y = Number(node.attributes['y'])
    return (JSON.parse(stdout) as IdbElement[]).find(
      (element) =>
        element.AXUniqueId === id &&
        Math.abs((element.frame?.x ?? Infinity) - x) < 1 &&
        Math.abs((element.frame?.y ?? Infinity) - y) < 1,
    )
  }

  /** The hint VoiceOver says after the name, which XCUITest has no attribute for. */
  private async iosHint(node: NativeNode): Promise<string | null> {
    const help = (await this.idbElement(node))?.help
    return help === undefined || help === null || help === '' ? null : help
  }

  private async node(id: ElementId, at: number): Promise<NativeNode> {
    const node = (await this.carrying(id))[at]
    if (node === undefined) throw new Error(`no element ${id} at ${String(at)}`)
    return node
  }

  /**
   * The actions a screen reader offers on the node besides activating it, in order. iOS names
   * them; Android's tree only counts them, so each is null there.
   */
  async customActions(id: ElementId, at = 0): Promise<(string | null)[]> {
    const node = await this.node(id, at)
    if (this.platform === 'android') return androidCustomActions(node)
    return (await this.idbElement(node))?.custom_actions ?? []
  }

  /** What VoiceOver says after the name, a transfer's progress among it; Android has none. */
  async accessibilityValue(id: ElementId, at = 0): Promise<string | null> {
    if (this.platform === 'android') return null
    const value = (await this.node(id, at)).attributes['value']
    return value === undefined || value === '' ? null : value
  }

  /**
   * The checker's findings within the box of `scope`, by position rather than by subtree: a
   * screen's id can sit on a view the tree lists beside the screen's content rather than over it.
   * On iOS only target sizes are scoped: XCTest audits the whole screen and gives no frames.
   */
  async audit(scope?: ElementId): Promise<AuditIssue[]> {
    // A page source costs seconds on iOS, and an audit after a scroll needs the one it just read.
    const root = parseNativeTree(this.scrolledTo ?? (await this.source()))
    this.scrolledTo = null
    const within =
      scope === undefined
        ? undefined
        : [...walk(root)].find((node) => testIdOf(node, this.platform) === scope)
    if (scope !== undefined && within === undefined) throw new Error(`no ${scope} to audit`)
    if (this.platform === 'android') return androidAudit(root, await this.screenDensity(), within)
    // webdriverio types an execute's answer as elements; this one is plain data.
    const answer: unknown = await this.driver.execute('mobile: performAccessibilityAudit', {})
    const found = answer as AppleAuditFinding[]
    return [
      ...found.map((issue) => ({
        rule: String(issue.auditType),
        impact: 'serious' as const,
        // XCTest names the element `"<identifier>" Button`, its label where it has no identifier.
        target: /^"([^"]*)"/.exec(issue.element)?.[1] ?? issue.element,
        message: issue.compactDescription,
      })),
      ...iosTargetSizes(root, within),
    ]
  }

  async screenshot(name: string): Promise<void> {
    await this.driver.saveScreenshot(join(repoRoot, 'test-results', `${name}.png`))
  }

  /**
   * Swipes the scrolled view under `id` by `span` of its height, `direction` -1 towards its start;
   * false once the tree no longer changes, which is the end of it.
   */
  async scroll(id: ElementId, direction: -1 | 1, span = 0.6): Promise<boolean> {
    const before = this.lastSource ?? (await this.source())
    const { x, y, width, height } = await this.driver.getElementRect(
      (await this.element(id)).elementId,
    )
    const centre = Math.round(x + width / 2)
    const near = Math.round(y + height * (0.5 - span / 2))
    const far = Math.round(y + height * (0.5 + span / 2))
    const [from, to] = direction === 1 ? [far, near] : [near, far]
    await this.driver
      .action('pointer', { parameters: { pointerType: 'touch' } })
      .move({ x: centre, y: from })
      .down()
      .move({ x: centre, y: to, duration: 400 })
      // Still before lifting, so the list moves by the drag alone and does not fling on.
      .pause(300)
      .up()
      .perform()
    await this.driver.pause(600)
    this.scrolledTo = await this.source()
    return this.scrolledTo !== before
  }

  /** Brings the app back in front of whatever an export opened over it. */
  async activate(): Promise<void> {
    const appId = APP_ID[this.platform]
    await this.driver.execute(
      'mobile: activateApp',
      this.platform === 'android' ? { appId } : { bundleId: appId },
    )
    this.scrolledTo = null
  }

  async close(): Promise<void> {
    const appId = APP_ID[this.platform]
    try {
      await this.driver.execute(
        'mobile: terminateApp',
        this.platform === 'android' ? { appId } : { bundleId: appId },
      )
    } finally {
      await this.driver.deleteSession()
      if (this.scales !== null) await setAnimationScales(this.device, this.scales)
    }
  }
}
