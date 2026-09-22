const UNITS = ['B', 'kB', 'MB', 'GB', 'TB'] as const

/**
 * A byte count, in decimal units.
 *
 * Deliberately not kibibytes: a file manager saying 2.4 MB beside this saying 2.3 MiB for the
 * same file reads as a discrepancy rather than as a different convention.
 *
 * Not localised, because the catalogue has no key that takes a size and inventing one here is
 * not this file's decision. The digits and the unit are the same in every locale we ship.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''

  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000
    unit += 1
  }

  const digits = unit === 0 || value >= 100 ? 0 : 1
  return `${value.toFixed(digits)} ${UNITS[unit] ?? 'B'}`
}
