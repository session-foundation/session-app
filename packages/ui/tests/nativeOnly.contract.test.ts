import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// What only a phone shows and no driver reads either: each case says why a device spec cannot
// hold it.

function source(file: string): string {
  return readFileSync(join(import.meta.dirname, '../src', file), 'utf8')
}

describe('the album’s download cloud on native', () => {
  it('takes no tab index, which tamagui reads as making a native view accessible', () => {
    // Adding one left the cloud hidden on both phones, so no device spec fails on it.
    expect(source('FetchHint.tsx')).not.toContain('tabIndex')
  })
})

describe('the album’s cloud on native', () => {
  it('takes a press, and leaves the tiles under the rest of its box their own', () => {
    // `none` on a box excludes the whole subtree on native, so the cloud's press never fired.
    // A press that falls through lands on the tile under it, which fetches the same set.
    expect(source('AttachmentAlbum.tsx')).not.toContain('pointerEvents="none"')
    expect(source('FetchHint.tsx')).toContain(
      "pointerEvents={onPress === undefined ? 'none' : 'box-none'}",
    )
  })
})

describe('an attachment tile’s picture on Android', () => {
  const tile = source('AttachmentTile.tsx')
  const picture = tile.slice(
    tile.indexOf('<Image\n            uri={uri}'),
    tile.indexOf('/>', tile.indexOf('<Image\n            uri={uri}')),
  )

  // A decode's size is Fresco's, which no tree or screenshot reports.
  it('asks for a decode 4/3 its view, so Fresco’s rounding still covers it', () => {
    // Without it an album's tiles decode at three quarters of their size.
    expect(picture).toContain('resizeMultiplier={4 / 3}')
  })

  it('is the only picture that does: the placeholder decodes to its view', () => {
    expect(tile.match(/resizeMultiplier=/g)).toHaveLength(1)
  })

  it('hands the multiplier to react-native, which applies it only under resizeMethod="resize"', () => {
    const image = source('Image.tsx')
    expect(image).toContain('resizeMethod="resize"')
    expect(image).toContain('resizeMultiplier={resizeMultiplier}')
  })
})

describe('a file row on native', () => {
  const row = source('FileRow.tsx')
  const nativeButton = row.slice(
    row.indexOf('function nativeRowElement('),
    row.indexOf('function Trailing('),
  )

  it('stops a press on the lead square or the control from reaching the row', () => {
    // Removing either changed nothing on either phone, so no device spec can fail on it.
    expect(row).toMatch(/event\.stopPropagation\(\)\s*onAction\?\.\(\)/)
    expect(row).toMatch(/event\.stopPropagation\(\)\s*onOpen\(\)/)
  })

  it('is a button wherever a double-tap does something, its own press or not', () => {
    // A failed send's row has no press, and its Retry is the activation fileRowActions gives it.
    // No fixture the specs open has a failed send.
    expect(nativeButton).toContain(
      "const activate = actions.find((action) => action.name === 'activate')",
    )
    expect(nativeButton).toContain('const operable = pressable || activate !== undefined')
  })

  it('runs its activation on a VoiceOver double-tap, which reaches no accessibility action', () => {
    // RN's iOS view answers accessibilityActivate only through onAccessibilityTap. A driver's tap
    // is a touch, never VoiceOver's activation.
    expect(nativeButton).toContain(
      '...(activate === undefined ? {} : { onAccessibilityTap: activate.run })',
    )
  })
})

describe('the native PressArea', () => {
  // Breaking either left every node the specs read unchanged on both phones.
  it('takes no tab index, which on iOS would hide what it holds from VoiceOver', () => {
    expect(source('PressArea.native.tsx')).not.toMatch(/keyboardPress|tabIndex/)
  })

  it('takes no tab index from keyboardPress either', () => {
    expect(source('keyboardPress.ts')).toContain('if (!isWeb || onPress === undefined) return {}')
  })
})

describe('a Button on native', () => {
  const button = source('Button.tsx')

  it('puts the role on its frame, which is the element a native press reaches', () => {
    // Without it the PressArea round the frame still reads as the button on both phones.
    expect(button).toContain("const FRAME_ROLE = isWeb ? {} : ({ role: 'button' } as const)")
    expect(button).toContain('{...FRAME_ROLE}')
  })

  /** The body of each `variant:` entry, keyed by name. */
  function variants(): Map<string, string> {
    const block = /variant: \{\n([\s\S]*?)\n {4}\},\n {4}size:/.exec(button)?.[1] ?? ''
    const out = new Map<string, string>()
    const starts = [...block.matchAll(/^ {6}(\w+): \{$/gm)]
    starts.forEach((m, i) => {
      const from = m.index + m[0].length
      const to = i + 1 < starts.length ? (starts[i + 1]?.index ?? block.length) : block.length
      out.set(m[1] as string, block.slice(from, to))
    })
    return out
  }

  const SURFACES = [
    '$backgroundPrimary',
    '$backgroundSecondary',
    '$backgroundTertiary',
    '$backgroundNested',
    '$hoverOverlay',
    '$pressedOverlay',
  ]

  function leavesTheLadder(declared: string): boolean {
    const fill = /backgroundColor: '(\$\w+)'/.exec(declared)?.[1]
    return fill !== undefined && !SURFACES.includes(fill)
  }

  /** Each variant's entry in `PRESS_STYLE`, the one table the web and native presses read. */
  function pressStyles(): Map<string, string> {
    const block = /const PRESS_STYLE = \{\n([\s\S]*?)\n\} as const/.exec(button)?.[1] ?? ''
    const out = new Map<string, string>()
    for (const m of block.matchAll(/^ {2}(\w+): \{([\s\S]*?)\},$/gm))
      out.set(m[1] as string, m[2] as string)
    return out
  }

  // A press lasts while a finger is down, and no spec holds one to screenshot it.
  it('takes its web press style from the shared table, so native cannot differ', () => {
    const found = variants()
    expect([...pressStyles().keys()]).toEqual([...found.keys()])
    const inline = [...found].filter(
      ([name, body]) => !body.includes(`pressStyle: PRESS_STYLE.${name},`),
    )
    expect(inline.map(([name]) => name)).toEqual([])
  })

  it('has a pressed-label entry wherever the press inverts', () => {
    // A Text inherits nothing from a View on native, so PRESSED_LABEL is what colours it there.
    const pressedLabel = /const PRESSED_LABEL[\s\S]*?\n\}/.exec(button)?.[0] ?? ''
    const inverts = [...pressStyles()]
      .filter(([, declared]) => leavesTheLadder(declared))
      .map(([name]) => name)
    expect(inverts.length).toBeGreaterThan(0)
    expect(inverts.filter((name) => !new RegExp(`^\\s+${name}:`, 'm').test(pressedLabel))).toEqual(
      [],
    )
  })

  it('presses on native with its entry in the shared table, less only the label colour', () => {
    // PRESSED is what native applies while held, since the frame does not own the press there.
    const pressed = /const PRESSED = \{[\s\S]*?\n\} as const/.exec(button)?.[0] ?? ''
    const restated = [...variants().keys()].filter(
      (name) =>
        !new RegExp(
          `^\\s+${name}: (withoutColor\\(PRESS_STYLE\\.${name}\\)|PRESS_STYLE\\.${name}),$`,
          'm',
        ).test(pressed),
    )
    expect(restated).toEqual([])
  })
})

describe('Reply as an accessibility action on native', () => {
  it('runs the reply only for its own action name', () => {
    // The action is VoiceOver's and TalkBack's menu, which no driver opens.
    expect(source('replyAction.ts')).toContain(
      'if (event.nativeEvent.actionName === REPLY_ACTION) onReply()',
    )
  })
})
