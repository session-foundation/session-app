import { countByStatus, type PageResult, type PageStatus, type Size } from '#catalog/diff'

/** A page as the report shows it. */
export interface ReportPage extends PageResult {
  /** Identifies the pictures both sides drew, so a Seen mark lasts exactly as long as they do. */
  pictures: string
}

/** One side of the comparison, as the report names it. */
interface ReportSide {
  /** What it was asked for as: a ref, or "working tree". */
  label: string
  sha: string
  /** Anything a reader should know about how this side was captured. */
  note?: string | undefined
}

export type ImageKind = 'before' | 'after' | 'diff'

export interface ReportInput {
  base: ReportSide
  head: ReportSide
  tier: string
  sensitivity: number
  results: readonly ReportPage[]
  /** Said at the top: a capture that could not be confirmed complete, for instance. */
  warnings: readonly string[]
}

/** Where a page's picture sits, relative to the report: beside it, a folder per kind. */
export function imagePath(kind: ImageKind, id: string): string {
  return `${kind}/${encodeURIComponent(id)}.png`
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? '',
  )

const HEADINGS: Record<PageStatus, string> = {
  changed: 'Changed',
  added: 'Added',
  removed: 'Removed',
  unchanged: 'Unchanged',
}

const dimensions = (size: Size) => `${String(size.width)}×${String(size.height)}`

/**
 * "12,345 pixels differ (0.42%)", then the size change when there was one, and the picture
 * enlarged to compare when one was.
 */
export function describeChange(result: PageResult): string {
  const share = result.totalPixels === 0 ? 0 : (100 * result.differingPixels) / result.totalPixels
  const parts = [
    `${result.differingPixels.toLocaleString('en')} pixels differ (${share.toFixed(2)}%)`,
  ]
  const { before, after, scaled } = result
  if (before !== undefined && after !== undefined && !sameSize(before, after))
    parts.push(`size ${dimensions(before)} → ${dimensions(after)}`)
  if (scaled !== undefined)
    parts.push(`${scaled.side} enlarged to ${dimensions(scaled.to)} to compare, as Argos does`)
  return parts.join('; ')
}

const sameSize = (a: Size, b: Size) => a.width === b.width && a.height === b.height

function image(kind: ImageKind, id: string, alt: string): string {
  return `<img src="${escapeHtml(imagePath(kind, id))}" alt="${escapeHtml(alt)}" loading="lazy" draggable="false">`
}

const percent = (part: number, whole: number) => `${((100 * part) / whole).toFixed(4)}%`

/**
 * One picture on the page's canvas: at the top left, at its own size relative to the canvas, on an
 * opaque backdrop that fills the canvas so nothing beneath shows past its edge, and outlined when
 * the two sides differ in size.
 */
function layer(kind: ImageKind, id: string, size: Size, canvas: Size, alt: string): string {
  const box = `width:${percent(size.width, canvas.width)};height:${percent(size.height, canvas.height)}`
  return `<div class="layer ${kind}"><img style="${box}" src="${escapeHtml(imagePath(kind, id))}" alt="${escapeHtml(alt)}" loading="lazy" draggable="false"><span class="bounds" style="${box}"></span></div>`
}

/** A canvas the larger width by the larger height, the size both sides are compared on. */
function stage(result: PageResult, layers: readonly string[], extra = ''): string {
  const canvas = canvasOf(result)
  const resized = !sameSize(sizeOr(result.before, canvas), sizeOr(result.after, canvas))
  return `<div class="stage${resized ? ' resized' : ''}" style="--w:${String(canvas.width)};--h:${String(canvas.height)}"${extra}>${layers.join('')}</div>`
}

const sizeOr = (size: Size | undefined, fallback: Size) => size ?? fallback

function canvasOf(result: PageResult): Size {
  const before = result.before ?? result.after ?? { width: 1, height: 1 }
  const after = result.after ?? before
  return {
    width: Math.max(before.width, after.width),
    height: Math.max(before.height, after.height),
  }
}

const seenToggle = (id: string) =>
  `<label class="seen-toggle"><input type="checkbox" aria-label="Seen: ${escapeHtml(id)}"> Seen</label>`

const cardAttributes = (result: ReportPage) => `data-seen-key="${escapeHtml(result.pictures)}"`

/** Each view and the key that shows it on every changed page. */
const MODES = [
  { mode: 'slider', label: 'Slider', key: 's' },
  { mode: 'flip', label: 'Flip', key: 'f' },
  { mode: 'side', label: 'Side by side', key: 'b' },
  { mode: 'diff', label: 'Diff', key: 'd' },
] as const

const MODE_BUTTONS = `<span class="modes" role="group" aria-label="View">${MODES.map(
  ({ mode, label, key }) =>
    `<button type="button" data-mode="${mode}" aria-pressed="${String(mode === 'slider')}" aria-keyshortcuts="${key.toUpperCase()}" title="${label} (${key.toUpperCase()})">${label} <kbd>${key.toUpperCase()}</kbd></button>`,
).join('')}</span>`

/** A box the picture is zoomed and panned within, so a zoomed picture never outgrows the window. */
const pan = (content: string) => `<div class="pan">${content}</div>`

function changedCard(result: ReportPage): string {
  const id = escapeHtml(result.id)
  const canvas = canvasOf(result)
  const side = (kind: 'before' | 'after') =>
    layer(kind, result.id, sizeOr(result[kind], canvas), canvas, `${result.id} ${kind}`)
  const resized = !sameSize(sizeOr(result.before, canvas), sizeOr(result.after, canvas))
  const bounds = resized
    ? ' Dashed outlines mark each picture&#39;s own bounds; the checkerboard lies outside it.'
    : ''
  return `<article class="page" id="page-${id}" ${cardAttributes(result)} data-mode="slider" style="--w:${String(canvas.width)};--h:${String(canvas.height)}">
  <header>
    ${seenToggle(result.id)}
    <h3>${id}</h3>
    <span class="detail">${escapeHtml(describeChange(result))}</span>
    <button type="button" class="tag" aria-label="Showing after; show before">after</button>
    <button type="button" class="zoom-reset" aria-label="Reset zoom" title="Reset zoom (0)"></button>
    ${MODE_BUTTONS}
  </header>
  <div class="view slider">
    ${pan(stage(result, [side('before'), side('after')], ' data-split'))}
    <label class="range">Before <input type="range" min="0" max="100" value="50" aria-label="Before and after"> After</label>
  </div>
  <div class="view flip">
    ${pan(`<button type="button" class="flipper" aria-label="Show the other side">
      ${stage(result, [side('before'), side('after')], ' data-showing="after"')}
    </button>`)}
  </div>
  <div class="view side">
    <figure><figcaption>Before</figcaption>${pan(stage(result, [side('before')]))}</figure>
    <figure><figcaption>After</figcaption>${pan(stage(result, [side('after')]))}</figure>
  </div>
  <div class="view diff">
    ${pan(stage(result, [layer('diff', result.id, canvas, canvas, `${result.id}: what differs, in red; anti-aliasing in yellow, not counted`)]))}
  </div>
  <p class="legend view diff">Red: a pixel that counts as different. Yellow: a pixel that differs only as anti-aliasing, which is not counted. Grey: the after picture, faded. Checkerboard: where the after picture does not reach.</p>
  ${bounds === '' ? '' : `<p class="legend">${bounds.trim()}</p>`}
</article>`
}

function singleCard(result: ReportPage, kind: 'before' | 'after'): string {
  const id = escapeHtml(result.id)
  return `<article class="page single" id="page-${id}" ${cardAttributes(result)}>
  <header>${seenToggle(result.id)}<h3>${id}</h3><span class="detail">${kind === 'after' ? 'only in the working side' : 'only in the base'}</span></header>
  ${image(kind, result.id, `${result.id} ${kind}`)}
</article>`
}

function section(status: PageStatus, results: readonly ReportPage[]): string {
  const pages = results.filter((result) => result.status === status)
  if (pages.length === 0) return ''
  const heading = `<h2>${HEADINGS[status]} <span class="count">${String(pages.length)}</span></h2>`
  if (status === 'unchanged')
    return `<section class="unchanged"><details><summary>${heading}</summary><ul>${pages
      .map(
        (page) =>
          `<li><a href="${escapeHtml(imagePath('after', page.id))}">${escapeHtml(page.id)}</a></li>`,
      )
      .join('')}</ul></details></section>`
  const cards = pages.map((page) =>
    status === 'changed'
      ? changedCard(page)
      : singleCard(page, status === 'added' ? 'after' : 'before'),
  )
  return `<section class="${status}">${heading}${cards.join('\n')}</section>`
}

const STYLE = `
:root {
  color-scheme: light dark;
  --bg: Canvas; --text: CanvasText; --muted: GrayText;
  --surface: color-mix(in srgb, CanvasText 4%, Canvas);
  --line: color-mix(in srgb, CanvasText 18%, Canvas);
  --checker: color-mix(in srgb, CanvasText 8%, Canvas);
  --backdrop: repeating-conic-gradient(var(--checker) 0 25%, var(--bg) 0 50%) 0 0 / 16px 16px;
  --before-bounds: light-dark(darkorange, orange);
  --after-bounds: light-dark(royalblue, deepskyblue);
  --accent: light-dark(seagreen, mediumaquamarine);
  --changed: light-dark(firebrick, salmon);
  --added: var(--accent);
  --removed: light-dark(darkgoldenrod, khaki);
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
main { max-width: 1400px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 18px; margin: 32px 0 12px; }
h3 { font-size: 15px; margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
.meta { color: var(--muted); margin: 0 0 16px; }
.meta code { color: var(--text); }
.summary { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
.summary li { background: var(--surface); border: 1px solid var(--line); border-radius: 999px; padding: 2px 12px; }
.summary .changed b { color: var(--changed); } .summary .added b { color: var(--added); }
.summary .removed b { color: var(--removed); }
.warnings { border: 1px solid var(--removed); border-radius: 8px; padding: 8px 16px; margin: 16px 0; }
.count { color: var(--muted); font-weight: normal; }
.page { background: var(--surface); border: 1px solid var(--line); border-radius: 10px;
  padding: 12px; margin: 0 0 16px; }
/* Sticky so a long card's view can be switched without scrolling back to its title. */
.page header { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin: -12px -12px 12px;
  padding: 12px; position: sticky; top: 0; z-index: 2; background: var(--surface);
  border-radius: 10px 10px 0 0; border-bottom: 1px solid var(--line); }
.detail { color: var(--muted); }
.view-all { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; color: var(--muted); margin: 16px 0 0; }
.view-all .modes { margin-left: 0; }
.seen-progress { color: var(--muted); margin: 8px 0 0; }
.full-screen-option { display: flex; align-items: center; gap: 4px; color: var(--muted); margin: 8px 0 0; cursor: pointer; }
.seen-toggle { display: inline-flex; align-items: center; gap: 4px; color: var(--muted); font-size: 13px; cursor: pointer; }
/* Outranks the per-mode rules that show the current view. */
.page.seen > :not(header) { display: none !important; }
.page.seen header { margin-bottom: -12px; border-bottom: 0; border-radius: 10px; }
.page.seen h3 { color: var(--muted); }
.modes { display: inline-flex; gap: 4px; margin-left: auto; }
.modes button { font: inherit; font-size: 13px; padding: 2px 10px; border-radius: 6px; cursor: pointer;
  border: 1px solid var(--line); background: transparent; color: var(--text); }
.modes button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: Canvas; }
kbd { font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; opacity: 0.6; }
.keys { color: var(--muted); font-size: 13px; margin: 8px 0 0; }
img { display: block; max-width: 100%; height: auto; }
.single img { background: var(--backdrop); }
.view { display: none; }
.view.slider { max-width: calc(var(--w) * 1px); }
.page.zoomed .view.slider { max-width: none; }
.page[data-mode="slider"] .view.slider, .page[data-mode="flip"] .view.flip,
.page[data-mode="side"] .view.side, .page[data-mode="diff"] .view.diff { display: block; }
/* Fit to the box at --zoom 1, never past the picture's own size. */
.stage { position: relative; width: calc(min(var(--w) * 1px, 100%) * var(--zoom, 1));
  aspect-ratio: var(--w) / var(--h); }
.page.zoomed .pan { overflow: auto; max-height: calc(100vh - 9rem); overscroll-behavior: contain;
  cursor: grab; }
.page.zoomed .pan.dragging { cursor: grabbing; }
.page.pixelated .stage img { image-rendering: pixelated; }
.zoom-reset { display: none; font: inherit; font-size: 13px; padding: 2px 10px; border-radius: 6px; cursor: pointer;
  border: 1px solid var(--line); background: transparent; color: var(--text); }
.page.zoomed .zoom-reset { display: inline-block; }
.layer { position: absolute; inset: 0; background: var(--backdrop); }
.layer img, .layer .bounds { position: absolute; top: 0; left: 0; max-width: none; }
.layer .bounds { display: none; pointer-events: none; }
.stage.resized .layer:not(.diff) .bounds { display: block; outline-style: dashed; outline-width: 2px;
  outline-offset: -2px; }
.layer.before .bounds { outline-color: var(--before-bounds); }
.layer.after .bounds { outline-color: var(--after-bounds); }
.stage[data-split] .layer.after { clip-path: inset(0 0 0 var(--split, 50%)); }
.stage[data-split]::after { content: ''; position: absolute; top: 0; bottom: 0; left: var(--split, 50%);
  width: 2px; margin-left: -1px; background: var(--accent); pointer-events: none; }
.stage[data-showing="after"] .layer.before, .stage[data-showing="before"] .layer.after { display: none; }
.legend { color: var(--muted); font-size: 13px; margin: 8px 0 0; }
.range { display: flex; align-items: center; gap: 8px; color: var(--muted); margin-top: 8px; }
.range input { flex: 1; }
.page > :not(header) { user-select: none; }
.page:fullscreen { margin: 0; border: 0; border-radius: 0; overflow: auto; }
/* An overflowing view is a scroll container of its own, and would hold the range's stickiness. */
.page:fullscreen .view { overflow: visible; }
.page.zoomed:fullscreen .pan { max-height: calc(100vh - 7rem); }
.page:fullscreen .range { position: sticky; bottom: 0; z-index: 2; margin: 8px -12px -12px; padding: 8px 12px;
  background: var(--surface); border-top: 1px solid var(--line); }
.view.side { display: none; }
.page[data-mode="side"] .view.side { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px; }
@media (max-width: 700px) { .page[data-mode="side"] .view.side { grid-template-columns: minmax(0, 1fr); } }
figure { margin: 0; } figcaption { color: var(--muted); font-size: 13px; }
.flipper { position: relative; display: block; width: 100%; padding: 0; border: 0; background: none; cursor: pointer; text-align: left; }
.tag { display: none; font: inherit; font-size: 13px; padding: 2px 10px; border-radius: 6px; cursor: pointer;
  border: 1px solid var(--accent); background: var(--accent); color: Canvas; }
.page[data-mode="flip"] .tag { display: inline-block; }
.unchanged ul { columns: 3 260px; padding-left: 20px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.unchanged summary h2 { display: inline; }
a { color: var(--accent); }
`

const SCRIPT = `
// Every card above changes height with what this does; keep the clicked control where it was.
function keepInPlace(control, change) {
  const top = control.getBoundingClientRect().top;
  change();
  window.scrollBy(0, control.getBoundingClientRect().top - top);
}
const STORED_SEEN = 'catalog-compare-seen';
const cards = [...document.querySelectorAll('.page[data-seen-key]')];
const seenKey = (card) => card.dataset.seenKey;
let seen = new Set();
try { seen = new Set(JSON.parse(localStorage.getItem(STORED_SEEN) || '[]')); } catch {}
const progress = document.querySelector('.seen-progress');
function showProgress() {
  const count = cards.filter((card) => card.classList.contains('seen')).length;
  progress.textContent = count + ' of ' + cards.length + ' seen';
}
for (const card of cards) {
  const box = card.querySelector('.seen-toggle input');
  const mark = (on) => {
    box.checked = on;
    card.classList.toggle('seen', on);
  };
  mark(seen.has(seenKey(card)));
  box.addEventListener('change', () => {
    keepInPlace(box, () => mark(box.checked));
    if (box.checked) seen.add(seenKey(card)); else seen.delete(seenKey(card));
    try { localStorage.setItem(STORED_SEEN, JSON.stringify([...seen])); } catch {}
    showProgress();
  });
}
if (progress) showProgress();
// Off unless asked for: two quick flips would otherwise take the card full screen.
const STORED_FULL_SCREEN = 'catalog-compare-full-screen';
const fullScreenBox = document.querySelector('.full-screen-option input');
try { fullScreenBox.checked = localStorage.getItem(STORED_FULL_SCREEN) === 'on'; } catch {}
fullScreenBox?.addEventListener('change', () => {
  try { localStorage.setItem(STORED_FULL_SCREEN, fullScreenBox.checked ? 'on' : 'off'); } catch {}
});
// Tighter than the system's double click, which is usually 400-500 ms and fires on a deliberate
// pair of flips. Both clicks still act, so a flip card flips twice and is left as it was.
const FULL_SCREEN_CLICKS_MS = 250;
for (const card of cards) {
  let lastClickMs = -Infinity;
  card.addEventListener('click', (event) => {
    if (event.target.closest('header, input')) return;
    if (!fullScreenBox.checked && document.fullscreenElement !== card) return;
    const quick = event.timeStamp - lastClickMs < FULL_SCREEN_CLICKS_MS;
    lastClickMs = quick ? -Infinity : event.timeStamp;
    if (!quick) return;
    if (document.fullscreenElement === card) document.exitFullscreen();
    else card.requestFullscreen().catch(() => {});
  });
}
const MODES = ['slider', 'flip', 'side', 'diff'];
const MODE_KEYS = { s: 'slider', f: 'flip', b: 'side', d: 'diff' };
const STORED_MODE = 'catalog-compare-view';
const changedCards = [...document.querySelectorAll('.page[data-mode]')];
function showMode(mode) {
  for (const page of changedCards) page.dataset.mode = mode;
  for (const button of document.querySelectorAll('.modes button'))
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  for (const page of changedCards) restoreCentre(page);
}
function chooseMode(mode, anchor) {
  keepInPlace(anchor, () => showMode(mode));
  try { localStorage.setItem(STORED_MODE, mode); } catch {}
}
for (const button of document.querySelectorAll('.modes button'))
  button.addEventListener('click', () => chooseMode(button.dataset.mode, button));
const flips = new Map();
for (const page of changedCards) {
  const range = page.querySelector('.range input');
  const split = page.querySelector('.stage[data-split]');
  range.addEventListener('input', () => split.style.setProperty('--split', range.value + '%'));
  const flipper = page.querySelector('.flipper');
  const flipped = flipper.querySelector('.stage');
  const tag = page.querySelector('header .tag');
  const flip = () => {
    const next = flipped.dataset.showing === 'after' ? 'before' : 'after';
    flipped.dataset.showing = next;
    tag.textContent = next;
    tag.setAttribute('aria-label', 'Showing ' + next + '; show ' + (next === 'after' ? 'before' : 'after'));
  };
  flips.set(page, flip);
  flipper.addEventListener('click', flip);
  tag.addEventListener('click', flip);
}

// The card whose pictures the reader is looking at: under the pointer, else the first in view.
let pointerCard = null;
document.addEventListener('pointermove', (event) => { pointerCard = event.target.closest?.('.page') ?? null; });
function cardInView() {
  if (document.fullscreenElement?.matches('.page')) return document.fullscreenElement;
  if (pointerCard) return pointerCard;
  return cards.find((card) => card.getBoundingClientRect().bottom > 0) ?? null;
}
document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
  if (event.target.closest?.('input:not([type=checkbox]):not([type=range]), textarea, select, [contenteditable]')) return;
  const key = event.key.toLowerCase();
  const card = cardInView();
  if (key === '0') {
    for (const page of changedCards) if (zoomOf(page) !== 1) setZoom(page, 1);
    return;
  }
  const mode = MODE_KEYS[key];
  if (mode === undefined) return;
  event.preventDefault();
  const current = changedCards[0]?.dataset.mode;
  // F again swaps the side every card shows, so a whole report can be flipped through by key.
  if (mode === 'flip' && current === 'flip') {
    for (const flip of flips.values()) flip();
    return;
  }
  chooseMode(mode, card?.closest('.page') ?? document.body);
});

// Zoom is per card and shared by its views: --zoom scales every stage from its fitted width.
const MAX_PIXEL_SCALE = 32;
const zoomOf = (page) => Number(page.style.getPropertyValue('--zoom') || 1);
const visiblePans = (page) => [...page.querySelectorAll('.pan')].filter((pan) => pan.offsetParent !== null);
const centres = new Map();
function rememberCentre(pan) {
  const page = pan.closest('.page');
  centres.set(page, {
    x: (pan.scrollLeft + pan.clientWidth / 2) / pan.scrollWidth,
    y: (pan.scrollTop + pan.clientHeight / 2) / pan.scrollHeight,
  });
}
function restoreCentre(page, except) {
  const centre = centres.get(page);
  if (!centre || zoomOf(page) === 1) return;
  for (const pan of visiblePans(page)) {
    if (pan === except) continue;
    const left = Math.round(centre.x * pan.scrollWidth - pan.clientWidth / 2);
    const top = Math.round(centre.y * pan.scrollHeight - pan.clientHeight / 2);
    if (left === pan.scrollLeft && top === pan.scrollTop) continue;
    // Its scroll event is an echo of this one, not the reader moving it.
    pan.dataset.echo = '1';
    pan.scrollTo(left, top);
  }
}
function showZoom(page, zoom) {
  page.querySelector('.zoom-reset').textContent = Math.round(zoom * 100) + '% ×';
}
function setZoom(page, zoom, pan, clientX, clientY) {
  const before = zoomOf(page);
  const stage = (pan ?? visiblePans(page)[0])?.querySelector('.stage');
  const fitWidth = stage ? stage.getBoundingClientRect().width / before : 1;
  const canvasWidth = Number(getComputedStyle(page).getPropertyValue('--w')) || fitWidth;
  const maxZoom = Math.max(1, (MAX_PIXEL_SCALE * canvasWidth) / fitWidth);
  zoom = Math.min(maxZoom, Math.max(1, zoom));
  if (zoom === before) return;
  if (zoom === 1) {
    keepInPlace(page.querySelector('header'), () => {
      page.style.removeProperty('--zoom');
      page.classList.remove('zoomed', 'pixelated');
    });
    centres.delete(page);
    return;
  }
  // The point under the pointer, as a share of the picture, stays under the pointer.
  let anchor = null;
  if (pan) {
    const box = pan.getBoundingClientRect();
    anchor = {
      x: (pan.scrollLeft + clientX - box.left) / pan.scrollWidth,
      y: (pan.scrollTop + clientY - box.top) / pan.scrollHeight,
    };
  }
  page.style.setProperty('--zoom', String(zoom));
  showZoom(page, zoom);
  page.classList.add('zoomed');
  page.classList.toggle('pixelated', (fitWidth * zoom) / canvasWidth >= 2);
  if (!pan) return restoreCentre(page);
  if (before === 1) {
    // Becoming a bounded box can leave it above the sticky header or past the window's foot.
    const box = pan.getBoundingClientRect();
    const top = page.querySelector('header').getBoundingClientRect().bottom + 8;
    if (box.top < top || box.bottom > window.innerHeight) window.scrollBy(0, box.top - top);
  }
  const box = pan.getBoundingClientRect();
  pan.scrollLeft = anchor.x * pan.scrollWidth - (clientX - box.left);
  pan.scrollTop = anchor.y * pan.scrollHeight - (clientY - box.top);
  rememberCentre(pan);
  restoreCentre(page, pan);
}
for (const page of changedCards) {
  page.querySelector('.zoom-reset').addEventListener('click', () => setZoom(page, 1));
  for (const pan of page.querySelectorAll('.pan')) {
    // A trackpad pinch arrives as a wheel event with ctrlKey set, in Chromium and Firefox alike.
    pan.addEventListener('wheel', (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      // A mouse wheel's notch is ~100 where a pinch's step is a few; cap it so a notch is a step too.
      const delta = Math.max(-40, Math.min(40, event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY));
      setZoom(page, zoomOf(page) * Math.exp(-delta * 0.01), pan, event.clientX, event.clientY);
    }, { passive: false });
    // Safari pinches through its own gesture events instead.
    let gestureStart = 1;
    pan.addEventListener('gesturestart', (event) => { event.preventDefault(); gestureStart = zoomOf(page); });
    pan.addEventListener('gesturechange', (event) => {
      event.preventDefault();
      setZoom(page, gestureStart * event.scale, pan, event.clientX, event.clientY);
    });
    pan.addEventListener('scroll', () => {
      if (pan.dataset.echo) return void delete pan.dataset.echo;
      if (zoomOf(page) === 1) return;
      rememberCentre(pan);
      restoreCentre(page, pan);
    });
    // Dragging pans a zoomed picture; a drag is not a click, so it neither flips nor counts toward full screen.
    let drag = null;
    // The browser's own drag of an image would take the pointer away from the pan.
    pan.addEventListener('dragstart', (event) => event.preventDefault());
    pan.addEventListener('pointerdown', (event) => {
      if (zoomOf(page) === 1 || event.button !== 0 || event.pointerType === 'touch') return;
      drag = { x: event.clientX, y: event.clientY, left: pan.scrollLeft, top: pan.scrollTop, moved: false };
    });
    pan.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      if (!drag.moved) { drag.moved = true; pan.setPointerCapture(event.pointerId); pan.classList.add('dragging'); }
      pan.scrollLeft = drag.left - dx;
      pan.scrollTop = drag.top - dy;
    });
    const endDrag = () => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      pan.classList.remove('dragging');
      if (!moved) return;
      const swallow = (event) => event.stopPropagation();
      pan.addEventListener('click', swallow, { capture: true, once: true });
      // The click a drag ends with, when there is one, comes before any timer.
      setTimeout(() => pan.removeEventListener('click', swallow, { capture: true }));
    };
    pan.addEventListener('pointerup', endDrag);
    pan.addEventListener('pointercancel', endDrag);
  }
}
try {
  const stored = localStorage.getItem(STORED_MODE);
  if (MODES.includes(stored)) showMode(stored);
} catch {}
`

/** The whole report: one file, its pictures in folders beside it. */
export function renderReport(input: ReportInput): string {
  const counts = countByStatus(input.results)
  const statuses: PageStatus[] = ['changed', 'added', 'removed', 'unchanged']
  const side = (label: string, s: ReportSide) =>
    `${label} <code>${escapeHtml(s.label)}</code> (${escapeHtml(s.sha.slice(0, 10))})${
      s.note === undefined ? '' : ` — ${escapeHtml(s.note)}`
    }`
  const warnings =
    input.warnings.length === 0
      ? ''
      : `<div class="warnings"><ul>${input.warnings
          .map((warning) => `<li>${escapeHtml(warning)}</li>`)
          .join('')}</ul></div>`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Catalog comparison</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>Catalog comparison</h1>
<p class="meta">${side('Before:', input.base)}<br>${side('After:', input.head)}<br>Tier <code>${escapeHtml(input.tier)}</code>, sensitivity ${String(input.sensitivity)}, both sides captured on this machine.</p>
<ul class="summary">${statuses
    .map((status) => `<li class="${status}"><b>${String(counts[status])}</b> ${status}</li>`)
    .join('')}</ul>
${warnings}
${
  counts.changed === 0
    ? ''
    : `<p class="view-all">View for every changed page ${MODE_BUTTONS}</p>
<p class="keys">Keys: <kbd>S</kbd> <kbd>F</kbd> <kbd>B</kbd> <kbd>D</kbd> pick a view; <kbd>F</kbd> again swaps every flip; <kbd>0</kbd> resets the zoom. Pinch or Ctrl+scroll on a picture to zoom; scroll or drag to move around it.</p>`
}
${
  counts.changed + counts.added + counts.removed === 0
    ? ''
    : `<p class="seen-progress" aria-live="polite"></p>
<label class="full-screen-option"><input type="checkbox"> Two clicks within 250 ms open a page full screen</label>`
}
${statuses.map((status) => section(status, input.results)).join('\n')}
</main>
<script>${SCRIPT}</script>
</body>
</html>
`
}
