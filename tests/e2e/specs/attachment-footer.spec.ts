import { expect } from '@playwright/test'
import { ALBUM_TILE_ID, FOOTER_ACTION_ID } from '@session/expectations'
import { ELEMENT, type ElementId } from '@session/test-ids'
import { SPACING } from '@session/theme-tokens'

import { openFirstConversation } from '../harness/attachments'
import type { Frame, ISessionApp } from '../harness/ISessionApp'
import { EACH, sessionTest } from '../harness/sessionTest'

// @session/ui's buttonHeight('sm') and native ROW_TOUCH_TARGET: importing ui would pull
// react-native into Playwright.
const FOOTER_HEIGHT = 32
const ROW_TOUCH_TARGET = 48

/** How far inside an edge a tap lands: clear of the drawn button, which is 8 in from the row's. */
const EDGE = 2

/**
 * iOS's tree gives each frame in whole points, and Android lays out on whole pixels, which at a
 * density such as 2.625 puts an edge up to a third of a dp from where it was asked to be.
 */
const ROUNDING = 1

/** The most the row may start below what is above it: the line's gap. */
const MAX_CLEARANCE = SPACING['2xs'] + ROUNDING

/** The rule the sheet draws above its footer, between the rows and the footer's gap. */
const SHEET_RULE = 1

const FOOTER = ELEMENT.conversation.attachmentFooter

const bottom = (frame: Frame) => frame.y + frame.height
const centreX = (frame: Frame) => frame.x + frame.width / 2
const contains = (outer: Frame, inner: Frame) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  bottom(inner) <= bottom(outer)

async function frameOf(app: ISessionApp, id: ElementId, at = 0): Promise<Frame> {
  const frame = await app.frame(id, at)
  if (frame === null) throw new Error(`no ${id} at ${String(at)} on ${app.platform}`)
  return frame
}

/**
 * The last carrying `id` drawn inside `outer`, or null: the sheet comes after the transcript it is
 * drawn over, whose footers can lie inside its box as well.
 */
async function frameInside(app: ISessionApp, id: ElementId, outer: Frame): Promise<Frame | null> {
  let found: Frame | null = null
  for (let at = 0; ; at++) {
    const frame = await app.frame(id, at)
    if (frame === null) return found
    if (contains(outer, frame)) found = frame
  }
}

async function requiredInside(app: ISessionApp, id: ElementId, outer: Frame): Promise<Frame> {
  const frame = await frameInside(app, id, outer)
  if (frame === null) throw new Error(`no ${id} inside the sheet on ${app.platform}`)
  return frame
}

/** The first message's album: two tiles side by side, the footer under them. */
async function albumBottom(app: ISessionApp): Promise<number> {
  return Math.max(
    bottom(await frameOf(app, ALBUM_TILE_ID, 0)),
    bottom(await frameOf(app, ALBUM_TILE_ID, 1)),
  )
}

/**
 * A touch target's height on a phone, where a hitSlop stops at the row; the line's own height with
 * a pointer, where nothing grows.
 */
function expectRowHeight(app: ISessionApp, row: Frame): void {
  if (app.platform === 'desktop') expect.soft(row.height).toBeCloseTo(FOOTER_HEIGHT, 0)
  else expect.soft(row.height).toBeGreaterThanOrEqual(ROW_TOUCH_TARGET - ROUNDING)
}

/**
 * A touch on what is above lands there only if the footer's row starts below it. Soft, so the tap
 * that follows says what the overlap does as well. `between` is what is drawn in the gap, such as
 * the sheet's rule.
 */
function expectClearOf(row: Frame, aboveBottom: number, between = 0): void {
  expect
    .soft(row.y - aboveBottom, 'the footer row starts below what is above it')
    .toBeGreaterThanOrEqual(-ROUNDING)
  expect
    .soft(row.y - aboveBottom, 'the row hands its growth back')
    .toBeLessThanOrEqual(MAX_CLEARANCE + between)
}

/**
 * What a footer button draws, in the middle of its box: on a phone the box is the row's full height
 * and the button is drawn at the line's.
 */
function drawnOf(box: Frame): Frame {
  return { ...box, y: box.y + (box.height - FOOTER_HEIGHT) / 2, height: FOOTER_HEIGHT }
}

/** A point `EDGE` in from the row's edge must miss the button's drawn box, or it proves nothing. */
function expectOutsideDrawn(app: ISessionApp, y: number, box: Frame): void {
  if (app.platform === 'desktop') return
  const drawn = drawnOf(box)
  expect(y < drawn.y || y > bottom(drawn), 'the tap misses the drawn button').toBe(true)
}

sessionTest({
  title: 'draws the attachment footer a touch target tall, clear of the album above it',
  risk: 'medium',
  clients: { alice: EACH },
  run: async ({ alice }) => {
    if (!alice) throw new Error('the harness did not open alice')

    await openFirstConversation(alice)
    await alice.waitForVisible(ALBUM_TILE_ID)
    const row = await frameOf(alice, FOOTER)
    const above = await albumBottom(alice)
    expectRowHeight(alice, row)
    expectClearOf(row, above)

    // Above the toggle, where the footer's row would take the touch if it reached over the tile.
    const toggle = await frameOf(alice, ELEMENT.conversation.attachmentViewList)
    expectRowHeight(alice, toggle)
    await alice.tapPoint(centreX(toggle), above - EDGE)
    await alice.waitForVisible(ELEMENT.conversation.autoDownloadPrompt)
    // A phone's prompt hides the transcript from the tree, so the view is read once it is gone.
    await alice.tap(ELEMENT.conversation.autoDownloadNo)
    await expect
      .poll(async () => alice.isVisible(ELEMENT.conversation.autoDownloadPrompt), {
        timeout: 5_000,
      })
      .toBe(false)
    // The tap fetched the pictures, and a picture that arrives takes its own shape, which can
    // push the footer below the screen.
    await alice.reveal(ELEMENT.conversation.attachmentViewList, ELEMENT.conversation.screen)
    expect(await alice.count(ELEMENT.conversation.attachmentViewGallery)).toBe(0)
  },
})

sessionTest({
  title: 'takes a touch on the attachment footer’s whole row, above and below its buttons',
  risk: 'medium',
  clients: { alice: EACH },
  run: async ({ alice }) => {
    if (!alice) throw new Error('the harness did not open alice')

    await openFirstConversation(alice)
    await alice.waitForVisible(ALBUM_TILE_ID)

    const toList = await frameOf(alice, ELEMENT.conversation.attachmentViewList)
    const top = (await frameOf(alice, FOOTER)).y + EDGE
    expectOutsideDrawn(alice, top, toList)
    await alice.tapPoint(centreX(toList), top)
    await alice.waitForVisible(ELEMENT.conversation.attachmentViewGallery)

    // The list is taller than the album, so the row has moved.
    const toGallery = await frameOf(alice, ELEMENT.conversation.attachmentViewGallery)
    const below = bottom(await frameOf(alice, FOOTER)) - EDGE
    expectOutsideDrawn(alice, below, toGallery)
    await alice.tapPoint(centreX(toGallery), below)
    await alice.waitForVisible(ELEMENT.conversation.attachmentViewList)

    const verb = await frameOf(alice, FOOTER_ACTION_ID)
    const verbTop = (await frameOf(alice, FOOTER)).y + EDGE
    expectOutsideDrawn(alice, verbTop, verb)
    await alice.tapPoint(centreX(verb), verbTop)
    await alice.waitForVisible(ELEMENT.conversation.autoDownloadPrompt)
  },
})

/**
 * A point `EDGE` inside the end of a button's box that reaches past the row's, which only a box
 * that takes touches beyond its parent's edge answers.
 */
function pastRow(box: Frame, row: Frame): number {
  if (box.x < row.x) return box.x + EDGE
  const end = box.x + box.width
  if (end > row.x + row.width) return end - EDGE
  throw new Error('the box does not reach past the row')
}

sessionTest({
  title: 'takes a touch on the footer buttons’ boxes past the row’s ends',
  risk: 'medium',
  clients: { alice: EACH },
  run: async ({ alice }) => {
    if (!alice) throw new Error('the harness did not open alice')
    // The phones only: the desktop draws each button at its box.
    if (alice.platform === 'desktop') return

    await openFirstConversation(alice)
    await alice.waitForVisible(ALBUM_TILE_ID)

    const toList = await frameOf(alice, ELEMENT.conversation.attachmentViewList)
    const row = await frameOf(alice, FOOTER)
    await alice.tapPoint(pastRow(toList, row), toList.y + toList.height / 2)
    await alice.waitForVisible(ELEMENT.conversation.attachmentViewGallery)

    const verb = await frameOf(alice, FOOTER_ACTION_ID)
    await alice.tapPoint(pastRow(verb, await frameOf(alice, FOOTER)), verb.y + verb.height / 2)
    await alice.waitForVisible(ELEMENT.conversation.autoDownloadPrompt)
  },
})

/** Its own launch: the verb's first press asks the one question there is no leaving unanswered. */
sessionTest({
  title: 'takes a touch on the attachment footer’s row under its verb',
  risk: 'medium',
  clients: { alice: EACH },
  run: async ({ alice }) => {
    if (!alice) throw new Error('the harness did not open alice')

    await openFirstConversation(alice)
    await alice.waitForVisible(ALBUM_TILE_ID)
    const verb = await frameOf(alice, FOOTER_ACTION_ID)
    const below = bottom(await frameOf(alice, FOOTER)) - EDGE
    expectOutsideDrawn(alice, below, verb)
    await alice.tapPoint(centreX(verb), below)
    await alice.waitForVisible(ELEMENT.conversation.autoDownloadPrompt)
  },
})

/**
 * A row's press fetches its own file and the footer's every file, so what the touch reached is
 * told by whether the footer still offers to fetch the rest.
 */
sessionTest({
  title: 'keeps the sheet’s attachment footer clear of the rows above it',
  risk: 'medium',
  clients: { alice: EACH },
  run: async ({ alice }) => {
    if (!alice) throw new Error('the harness did not open alice')

    await openFirstConversation(alice)
    await alice.reveal(ELEMENT.conversation.attachmentShowAll, ELEMENT.conversation.screen)
    await alice.tap(ELEMENT.conversation.attachmentShowAll)
    await alice.waitForVisible(ELEMENT.conversation.attachmentSheetList)

    const sheet = await frameOf(alice, ELEMENT.conversation.attachmentSheet)
    const row = await requiredInside(alice, FOOTER, sheet)
    const list = await frameOf(alice, ELEMENT.conversation.attachmentSheetList)
    expectRowHeight(alice, row)
    expectClearOf(row, bottom(list), SHEET_RULE)

    const verb = await requiredInside(alice, FOOTER_ACTION_ID, sheet)
    await alice.tapPoint(centreX(verb), bottom(list) - EDGE)
    await alice.waitForVisible(ELEMENT.conversation.autoDownloadPrompt)
    await alice.tap(ELEMENT.conversation.autoDownloadNo)
    await expect
      .poll(async () => alice.count(ELEMENT.conversation.attachmentExport), { timeout: 15_000 })
      .toBeGreaterThan(0)
    expect(
      await frameInside(alice, FOOTER_ACTION_ID, sheet),
      'the footer still offers to fetch the rest',
    ).not.toBeNull()
  },
})
