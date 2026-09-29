import { describe, expect, it } from 'vitest'

// By path rather than through the package: react-native's exports close off `ReactCommon/`, and the
// workspace hoists every package to the root.
import layoutManager from '../../../node_modules/react-native/ReactCommon/react/renderer/textlayoutmanager/platform/ios/react/renderer/textlayoutmanager/RCTTextLayoutManager.mm?raw'

import fix from '../modules/text-layout/ios/TextContainerSlack.mm?raw'

/**
 * What `modules/text-layout/ios/TextContainerSlack.mm` depends on in React Native, checked against
 * the source of the version installed.
 *
 * The iOS core is prebuilt from that same source, and the fix replaces one of its private methods
 * at launch. A React Native upgrade that renames or reshapes it would otherwise surface only as a
 * debug build stopping on a simulator, or as clipped text in a release one; this fails wherever the
 * tests run, CI included, before anyone builds.
 *
 * Both files come in through Vite's `?raw` rather than `node:fs`: this program is checked against
 * react-native's environment, which has no node.
 */

/** Whitespace folded, so a reformatted declaration still matches. */
const flat = (source: string) => source.replace(/\s+/g, ' ')

/** One method's body, from its declaration to the next one. */
function body(source: string, selectorStart: string): string {
  const from = source.indexOf(`- (NSTextStorage *)${selectorStart}`)
  const to = source.indexOf('\n- (', from + 1)
  return source.slice(from, to === -1 ? undefined : to)
}

describe('the iOS text container slack', () => {
  const selector = /SELECTOR =\s*@"([^"]+)"/.exec(fix)?.[1]

  it('names the class that method is on', () => {
    expect(/CLASS = @"([^"]+)"/.exec(fix)?.[1]).toBe('RCTTextLayoutManager')
    expect(layoutManager).toMatch(/^@implementation RCTTextLayoutManager\b/m)
  })

  it('names the method React Native builds every text container in', () => {
    expect(selector).toBe(
      '_textStorageAndLayoutManagerWithAttributesString:paragraphAttributes:size:',
    )
    expect(flat(layoutManager)).toContain(
      '- (NSTextStorage *)_textStorageAndLayoutManagerWithAttributesString:(NSAttributedString *)attributedString paragraphAttributes:(ParagraphAttributes)paragraphAttributes size:(CGSize)size',
    )
  })

  it('calls it with the argument types React Native declares', () => {
    expect(flat(fix)).toContain(
      'typedef NSTextStorage *(*TextStorageForSize)( id, SEL, NSAttributedString *, ParagraphAttributes, CGSize);',
    )
  })

  it('is on the drawing path, which is sized by the frame', () => {
    const draw = flat(layoutManager.slice(layoutManager.indexOf('- (void)drawAttributedString:')))
    expect(draw).toMatch(/_textStorageAndLayoutManagerWithAttributesString:.*?size:frame\.size\]/)
  })

  // React Native 0.88 fixes the same bug upstream, in measurement rather than drawing: it rounds a
  // text's measured size up past the pixel boundary (react/react-native@5e40a17), so the frame
  // Yoga rounds is never short of the text. Once the installed version has it, re-check the
  // notifications step on iOS 26 without this module and remove it.
  it('is still needed: React Native does not yet round measurements past the pixel boundary', () => {
    expect(layoutManager).not.toContain('internal_roundTextMeasurementToPixelGrid')
  })

  // Fails when React Native stops clipping a text with no line limit, which may mean the
  // shortfall no longer loses a line and the fix can go -- check on iOS 26 before removing it.
  it('is still needed: a text with no line limit still clips', () => {
    expect(
      flat(body(layoutManager, '_textStorageAndLayoutManagerWithAttributesString:')),
    ).toContain(': NSLineBreakByClipping;')
  })
})
