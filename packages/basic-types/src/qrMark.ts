/**
 * The marks a QR code can carry in its middle. Only the recovery password's: the mark is how a
 * person tells the code that restores the account from any other, so no other code wears one.
 */
export type QrMark = 'recoveryPassword'

export function isQrMark(value: unknown): value is QrMark {
  return value === 'recoveryPassword'
}

/** A mark as SVG path data in its own box, filled with the nonzero rule. */
export interface MarkOutline {
  width: number
  height: number
  path: string
}

/**
 * The shield-and-loop mark the desktop client puts beside the Recovery Password heading. Here
 * rather than in the UI package so the PNG a QR code is saved as draws the same outline.
 */
export const RECOVERY_PASSWORD_MARK: MarkOutline = {
  width: 33,
  height: 41,
  path: 'm21.3 20.64-3.11-1.79h2.11c.88 0 1.73-.36 2.35-1a3.52 3.52 0 0 0 0-4.89 3.27 3.27 0 0 0-2.35-1.01h-7.37A4.1 4.1 0 0 0 10 13.22a4.41 4.41 0 0 0-1.23 3.05c0 .84.22 1.66.63 2.38.4.72 1 1.31 1.7 1.71l3.11 1.8h-2.1a3.22 3.22 0 0 0-2.39.99 3.46 3.46 0 0 0-.98 2.45 3.56 3.56 0 0 0 .98 2.46 3.32 3.32 0 0 0 2.38 1h7.37a4.1 4.1 0 0 0 2.95-1.27 4.41 4.41 0 0 0 1.22-3.06c0-.83-.22-1.65-.63-2.37a4.6 4.6 0 0 0-1.7-1.72Zm-9.71-1.21c-.53-.3-.98-.75-1.3-1.29a3.7 3.7 0 0 1-.5-1.78 3.26 3.26 0 0 1 3.22-3.34h7.22a2.38 2.38 0 0 1 2.22 3.2 2.4 2.4 0 0 1-1.25 1.37c-.28.13-.59.2-.9.2h-4.16a.45.45 0 0 0-.32.13.49.49 0 0 0-.14.34v3.52l-4.1-2.35Zm7.79 8.56h-7.22a2.38 2.38 0 0 1-2.22-3.21 2.4 2.4 0 0 1 1.25-1.36c.28-.13.59-.2.9-.2h4.16a.45.45 0 0 0 .33-.14.48.48 0 0 0 .13-.34v-3.52l4.1 2.36c.52.3.97.75 1.28 1.28.32.54.5 1.16.5 1.79a3.26 3.26 0 0 1-3.21 3.34ZM16.15 0c-.48 0-.94.11-1.4.34-.46.23-.95.45-1.43.68l-.87.42-.03.01-.02.02-.17.08-.1.05-2.38 1.14-7.89 3.75A3.27 3.27 0 0 0 0 9.66v8.13c0 1.22-.01 2.5.15 3.85.09.8.23 1.55.37 2.28l.12.63.04.17.04.16.1.33c.27.89.54 1.8.92 2.74.45 1.1 1 2.22 1.72 3.5l.1.18.1.12a21.46 21.46 0 0 0 8.09 7.73h.02l.02.02c1.15.6 2.3 1.06 3.45 1.38a3.35 3.35 0 0 0 1.78 0h.05c1.22-.36 2.33-.85 3.27-1.3l.1-.05.1-.05.19-.12a20.78 20.78 0 0 0 5.22-4.1c.95-1.02 1.84-2.19 2.8-3.7l.03-.05.03-.06c.81-1.4 1.43-2.7 1.9-3.96.36-.96.63-1.88.87-2.76l.03-.08.02-.09c.28-1.28.6-2.98.64-4.77.02-.68.02-1.38.03-2.08V16.96a289.3 289.3 0 0 1 0-5.9V9.96a3.48 3.48 0 0 0-2-3.51l-7.36-3.5-3.08-1.48-.65-.3-1.69-.82c-.45-.22-.9-.33-1.37-.33V0Zm-.02 38.13c-.05 0-.12 0-.22-.03-.97-.27-1.97-.67-2.97-1.18a18.71 18.71 0 0 1-7.07-6.76l-.08-.13-.05-.07a24.85 24.85 0 0 1-1.55-3.14c-.32-.81-.56-1.63-.82-2.5l-.1-.32-.13-.66c-.13-.7-.26-1.36-.34-2.05-.14-1.17-.13-2.3-.13-3.5v-7.31c0-.3.02-.6 0-.94 0-.14-.01-.29.28-.43l7.88-3.75 2.39-1.14.02-.02.03-.01.1-.05.17-.09.88-.41 1.48-.7c.12-.07.2-.07.25-.07.06 0 .14 0 .26.06l1.73.83.64.3 3.08 1.48c2.46 1.17 4.9 2.35 7.36 3.51.43.2.44.45.43.69a7 7 0 0 0 0 .84v7.1l-.03 2.04a22.57 22.57 0 0 1-.57 4.2 34 34 0 0 1-.79 2.5c-.41 1.1-.97 2.27-1.7 3.53a22.66 22.66 0 0 1-2.48 3.3 17.99 17.99 0 0 1-4.55 3.56l-.1.05-.09.06-.06.04c-.84.4-1.84.84-2.88 1.14l-.26.03Z',
}

export const QR_MARK_OUTLINES: Readonly<Record<QrMark, MarkOutline>> = {
  recoveryPassword: RECOVERY_PASSWORD_MARK,
}

/** The cleared square's share of the code's width. Level Q restores up to a quarter of modules. */
const QR_MARK_SHARE = 0.22

/**
 * The square cleared for a mark, in modules, for a code `size` modules wide without its quiet
 * zone. Kept odd so it centres on a module rather than between two.
 */
export function qrMarkModules(size: number): number {
  return Math.round((size * QR_MARK_SHARE) / 2) * 2 + 1
}

/** The mark's height as a share of its cleared square, which leaves a margin of panel round it. */
export const QR_MARK_FILL = 0.8
