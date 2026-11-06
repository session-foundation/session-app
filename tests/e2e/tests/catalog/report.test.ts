import { describe, expect, it } from 'vitest'

import { describeChange, imagePath, renderReport, type ReportPage } from '#catalog/report'

const size = { width: 100, height: 50 }
const results: ReportPage[] = [
  {
    id: 'album-focus',
    status: 'changed',
    differingPixels: 1234,
    totalPixels: 5000,
    before: size,
    after: size,
    pictures: 'album-focus-1',
  },
  { id: 'button-<new>', status: 'added', differingPixels: 0, totalPixels: 0, pictures: 'new-1' },
  { id: 'text-gone', status: 'removed', differingPixels: 0, totalPixels: 0, pictures: 'gone-1' },
  {
    id: 'settings-row',
    status: 'unchanged',
    differingPixels: 0,
    totalPixels: 5000,
    before: size,
    after: size,
    pictures: 'settings-row-1',
  },
]

const html = renderReport({
  base: { label: 'origin/main', sha: '0123456789abcdef', note: 'given the hidden-run change' },
  head: { label: 'working tree', sha: 'fedcba9876543210' },
  tier: 'pr',
  sensitivity: 0.5,
  results,
  warnings: ['The base capture is from the cache'],
})

describe('the report', () => {
  it('lists changed, added and removed pages before the unchanged ones', () => {
    const order = ['album-focus', 'button-&lt;new&gt;', 'text-gone', 'settings-row'].map((id) =>
      html.indexOf(id),
    )
    expect(order.every((at) => at > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('shows a changed page before, after and as a diff, with its count of differing pixels', () => {
    for (const kind of ['before', 'after', 'diff'] as const)
      expect(html).toContain(`src="${imagePath(kind, 'album-focus')}"`)
    expect(html).toContain('1,234 pixels differ (24.68%)')
    expect(html).toContain('type="range"')
  })

  it('escapes what it is given', () => {
    expect(html).not.toContain('button-<new>')
    expect(html).toContain('button-&lt;new&gt;')
  })

  it('names both sides and carries the warnings', () => {
    expect(html).toContain('0123456789')
    expect(html).toContain('given the hidden-run change')
    expect(html).toContain('The base capture is from the cache')
  })

  it('offers one view switch for every changed page, as well as one per page', () => {
    expect(html).toContain('class="view-all"')
    expect(html.match(/<button type="button" data-mode="flip"/g)).toHaveLength(2)
  })

  it('gives every view a key, and says so on its button', () => {
    for (const key of ['S', 'F', 'B', 'D'])
      expect(html.match(new RegExp(`aria-keyshortcuts="${key}"`, 'g'))).toHaveLength(2)
  })

  it('puts each of a changed page’s four views in a box it can be zoomed within', () => {
    const card = html.slice(html.indexOf('id="page-album-focus"'), html.indexOf('</article>'))
    expect(card.match(/<div class="pan">/g)).toHaveLength(5)
    expect(card).toContain('class="zoom-reset"')
  })

  it('names the side the flip view shows in the card header, where it stays in sight', () => {
    expect(html).toMatch(/<header>[\s\S]*class="tag"[\s\S]*<\/header>/)
  })

  it('lets every changed, added or removed page be marked seen, against its pictures', () => {
    expect(html.match(/class="seen-toggle"/g)).toHaveLength(3)
    expect(html).toContain('data-seen-key="album-focus-1"')
    expect(html).toContain('aria-label="Seen: button-&lt;new&gt;"')
    expect(html).toContain('class="seen-progress"')
  })

  it('offers full screen on two quick clicks as an option, unticked', () => {
    expect(html).toMatch(/<label class="full-screen-option"><input type="checkbox">/)
  })

  it('stands alone: no script or style fetched from anywhere', () => {
    expect(html).not.toMatch(/<(script|link)[^>]+(src|href)=/)
  })
})

describe('a page that changed size', () => {
  const resized = renderReport({
    base: { label: 'base', sha: 'a'.repeat(40) },
    head: { label: 'working tree', sha: 'b'.repeat(40) },
    tier: 'pr',
    sensitivity: 0.5,
    results: [
      {
        id: 'grew',
        status: 'changed',
        differingPixels: 10,
        totalPixels: 1000,
        before: { width: 200, height: 100 },
        after: { width: 100, height: 150 },
        pictures: 'grew-1',
      },
    ],
    warnings: [],
  })

  it('draws both sides on one canvas the larger width by the larger height', () => {
    expect(resized).toContain('class="stage resized" style="--w:200;--h:150"')
    // Each picture keeps its own size on that canvas, at the top left.
    expect(resized).toContain('style="width:100.0000%;height:66.6667%" src="before/grew.png"')
    expect(resized).toContain('style="width:50.0000%;height:100.0000%" src="after/grew.png"')
    expect(resized).toContain('Dashed outlines mark each picture')
  })

  it('has no page-wide view switch without a changed page', () => {
    const quiet = renderReport({
      base: { label: 'base', sha: 'a'.repeat(40) },
      head: { label: 'working tree', sha: 'b'.repeat(40) },
      tier: 'pr',
      sensitivity: 0.5,
      results: [
        { id: 'new', status: 'added', differingPixels: 0, totalPixels: 0, pictures: 'new-1' },
      ],
      warnings: [],
    })
    expect(quiet).not.toContain('class="view-all"')
  })

  it('says what the diff colours mean, anti-aliasing included', () => {
    expect(resized).toContain('anti-aliasing, which is not counted')
  })
})

describe('a change, described', () => {
  it('adds the size change when there was one', () => {
    expect(
      describeChange({
        id: 'a',
        status: 'changed',
        differingPixels: 10,
        totalPixels: 1000,
        before: { width: 10, height: 10 },
        after: { width: 10, height: 100 },
      }),
    ).toBe('10 pixels differ (1.00%); size 10×10 → 10×100')
  })

  it('says which side was enlarged to compare, and to what', () => {
    expect(
      describeChange({
        id: 'a',
        status: 'changed',
        differingPixels: 10,
        totalPixels: 1000,
        before: { width: 10, height: 10 },
        after: { width: 20, height: 30 },
        scaled: { side: 'before', to: { width: 20, height: 20 } },
      }),
    ).toBe(
      '10 pixels differ (1.00%); size 10×10 → 20×30; before enlarged to 20×20 to compare, as Argos does',
    )
  })
})
