import type { ElementId } from '@session/test-ids'

/**
 * What a test may ask of a running client, whichever one it is.
 *
 * Every member here must use platform-neutral signatures only - primitives, enums and plain
 * data. No Playwright Locator and no Appium element type may appear in this file. Anything
 * one platform cannot do today belongs in a narrower interface until every platform can
 * satisfy it, at which point it is promoted here.
 *
 * That rule is what keeps a flow spec honest: if it can only be written against one
 * platform's vocabulary, it is not a shared flow.
 */
export interface ISessionApp {
  readonly platform: 'desktop' | 'android' | 'ios'
  /** Which account this client is signed into, for failure messages and screenshots. */
  readonly identity: string

  waitForVisible(id: ElementId, options?: { timeoutMs?: number }): Promise<void>
  isVisible(id: ElementId): Promise<boolean>
  tap(id: ElementId): Promise<void>
  type(id: ElementId, text: string): Promise<void>
  readText(id: ElementId): Promise<string>
  /** Every occurrence, in the order they appear - a transcript, a conversation list. */
  readAllText(id: ElementId): Promise<string[]>
  /** How many carry this id. A control that must appear on some rows and not others. */
  count(id: ElementId): Promise<number>
  /**
   * Whether the picture at `id` actually has its bytes, not merely an element on screen.
   *
   * Its own member because the two are genuinely different here: an attachment draws its box
   * from the dimensions the sender supplied, so a picture whose bytes never arrived is present,
   * laid out and the right shape - `isVisible` cannot tell it from one that loaded.
   */
  imageLoaded(id: ElementId, options?: { timeoutMs?: number }): Promise<boolean>
  screenshot(name: string): Promise<void>
  close(): Promise<void>
}
