import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { parseSource } from './support/source'

/**
 * Every word a person reads comes from the catalogue.
 *
 * Not a style rule. A literal in a screen ships English to everybody, and it does it silently -
 * nothing renders wrong, nothing throws, and the first sign of it is somebody reading English in
 * an app they set to German.
 *
 * Parsed rather than grepped because the things worth catching look nothing alike in text: a bare
 * JSX child (`<Text>Hello</Text>`), a string handed to a prop that ends up on screen
 * (`placeholder="Hello"`), and a toast's message (`toasts.show('Hello')`). The compiler already
 * knows which is which.
 *
 * What counts as fine is anything that is not a literal: `{tr('x')}` obviously, but also
 * `{account.name}` or `{count}`, because a value is not copy. The check is deliberately about
 * where the *words* come from, not about spelling `tr` at the call site.
 *
 * `PENDING_COPY` in `@session/localization` is the one exception, and the second test here is
 * what keeps it one: it holds English the catalogue has no key for, and growing it means editing
 * that list.
 */

/** Props whose string value is rendered, or read out, rather than used as a value. */
const COPY_PROPS = new Set([
  'placeholder',
  'accessibilityLabel',
  'accessibilityHint',
  'title',
  'label',
])

/**
 * Calls whose first argument is shown to somebody: a toast's message. Matched on the method and
 * on a receiver whose name says it is the toasts, so `list.show()` elsewhere is not swept in.
 */
const COPY_CALLS: readonly { method: string; receiver: RegExp }[] = [
  { method: 'show', receiver: /toast/i },
]

/** The screens under test. They are in src; this file is not. */
const dir = join(import.meta.dirname, '../src')

function screenFiles(from: string): string[] {
  return readdirSync(from, { withFileTypes: true }).flatMap((entry) => {
    const path = join(from, entry.name)
    if (entry.isDirectory()) return screenFiles(path)
    return entry.isFile() && entry.name.endsWith('.tsx') ? [path] : []
  })
}

/** Every rendered literal in one file, as `path:line text`. */
function literalsIn(path: string): string[] {
  const source = parseSource(path)
  const found: string[] = []

  const report = (node: ts.Node, text: string) => {
    const trimmed = text.trim()
    // Punctuation and whitespace between elements is not copy: a bare `-` or `·` has nothing to
    // translate, and demanding a key for one would be the rule wearing out its welcome.
    if (!/\p{Letter}/u.test(trimmed)) return
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
    found.push(`${path.slice(path.indexOf('packages/'))}:${String(line + 1)} ${trimmed}`)
  }

  /** A literal, or each one a conditional can produce, since `on ? 'A' : 'B'` is two strings. */
  const reportLiterals = (node: ts.Expression) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      report(node, node.text)
    else if (ts.isConditionalExpression(node)) {
      reportLiterals(node.whenTrue)
      reportLiterals(node.whenFalse)
    } else if (ts.isParenthesizedExpression(node)) reportLiterals(node.expression)
  }

  const walk = (node: ts.Node) => {
    if (ts.isJsxText(node)) report(node, node.text)
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const { name, expression: receiver } = node.expression
      const [message] = node.arguments
      const copy = COPY_CALLS.some(
        (call) => call.method === name.text && call.receiver.test(receiver.getText(source)),
      )
      if (copy && message !== undefined) reportLiterals(message)
    }
    if (ts.isJsxAttribute(node) && COPY_PROPS.has(node.name.getText(source))) {
      const value = node.initializer
      if (value && ts.isStringLiteral(value)) report(value, value.text)
      if (
        value &&
        ts.isJsxExpression(value) &&
        value.expression &&
        ts.isStringLiteral(value.expression)
      )
        report(value.expression, value.expression.text)
    }
    ts.forEachChild(node, walk)
  }

  walk(source)
  return found
}

describe('screen copy', () => {
  const files = screenFiles(dir)

  it('reads some screens at all', () => {
    // Without this the assertion below would pass over an empty list and prove nothing.
    expect(files.length).toBeGreaterThan(3)
  })

  it('takes every word from @session/localization', () => {
    const offenders = files.flatMap(literalsIn)
    expect(
      offenders,
      'Hardcoded copy. Use tr() with a key from @session/localization; if no key fits, that is a ' +
        'question for the translation pipeline rather than a string to invent here.',
    ).toEqual([])
  })

  it('keeps the copy with no key yet to a list somebody has to edit', () => {
    // Living in a .ts file is what puts these out of the parser's reach above, so nothing else
    // stops another appearing. This is that stop: the set is spelled out, and adding to it is a
    // deliberate edit here rather than a string that slid in beside an existing one.
    const source = readFileSync(join(dir, '../../localization/src/pendingCopy.ts'), 'utf8')
    const keys = [...source.matchAll(/^ {2}(\w+):/gm)].map((match) => match[1])

    expect(
      keys,
      'English with no catalogue key. Each of these ships untranslated until the key lands, so ' +
        'the list is meant to shrink: promote one via session-localization rather than adding.',
    ).toEqual([
      'attachmentCache',
      'attachmentCacheUsage',
      'attachmentCacheLimit',
      'attachmentCacheNoLimit',
      'messagesLoadFailed',
      'attachmentCount',
      'attachmentViewGallery',
      'attachmentViewList',
      'export',
      'recoveryPasswordHiddenOnDevice',
      'exporting',
      'exportFailed',
      'previous',
      'attachmentImagePosition',
      'attachmentViewerPosition',
      'attachmentNameAndMore',
      'attachmentsErrorLimit',
      'attachmentsErrorImageTooLarge',
      'attachmentsNotAdded',
      'attachmentsStagedCount',
      'attachmentsStagedCountSpoken',
      'attachmentQueued',
      'attachmentNotSent',
      'attachmentsUploaded',
      'attachmentsDownloadProgress',
      'attachmentsFailedCount',
      'attachmentsDropHint',
      'attachmentRemove',
      'autoDownloadAllFiles',
      'autoDownloadImagesOnly',
      'onionRoutingPathConnected',
      'onionRoutingPathConnecting',
      'onionRoutingPathOffline',
      'changeToLightMode',
      'changeToDarkMode',
      'messageNavigate',
      'attachmentNavigate',
      'messageQuoteHint',
      'messageScrollToLatest',
      'messageBackToReply',
      'onionRoutingPathsInUse',
      'onionRoutingPathCountries',
      'onionRoutingPathEntryNodes',
      'onionRoutingPathRebuilt',
      'onionRoutingPathAverage',
      'onionRoutingPathFastest',
      'onionRoutingPathSlowest',
      'onionRoutingPathJitter',
      'onionRoutingPathMilliseconds',
      'onionRoutingPathJitterMilliseconds',
      'onionRoutingPathAverageResponse',
      'onionRoutingPathFastestResponse',
      'onionRoutingPathSlowestResponse',
      'onionRoutingPathNotApplicable',
      'onionRoutingPathIntro',
      'onionRoutingPathEntry',
      'onionRoutingPathRelay',
      'onionRoutingPathBuilding',
      'onionRoutingPathFileServer',
      'onionRoutingPathYourMessages',
      'onionRoutingPathContactsGroups',
      'messageDelivery',
      'messageDeliveryDescription',
      'deliveryPushGoogle',
      'deliveryPushApple',
      'deliveryPushHuawei',
      'deliveryPush',
      'deliveryInstantDescriptionGoogle',
      'deliveryInstantDescriptionApple',
      'deliveryInstantDescriptionHuawei',
      'deliveryInstantDescription',
      'deliveryInstantCommunities',
      'deliveryUnavailableBuild',
      'deliveryUnavailableDeviceGoogle',
      'deliveryUnavailableDeviceHuawei',
      'deliveryUnavailableDevice',
      'deliveryUnavailableNetwork',
      'deliveryAlwaysConnected',
      'deliveryAlwaysConnectedDescription',
      'deliveryPeriodic',
      'deliveryPeriodicDescription',
      'deliveryWhileOpen',
      'deliveryWhileOpenDescription',
      'notificationsOffForSession',
      'backgroundActivityDescription',
      'backgroundRefreshOffPeriodic',
      'backgroundRefreshOffInstant',
      'deviceSettingsMessageRequestNotifications',
      'previewNotificationBody',
      'notificationSoundNames',
    ])
  })
})
