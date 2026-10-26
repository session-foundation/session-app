import { Pseudonyms } from '#src/pseudonym'
import type { LogDirectory, LogFileInfo } from '#src/writer'

export const SALT = new Uint8Array(16).fill(7)

export function pseudonyms(): Pseudonyms {
  return new Pseudonyms(SALT)
}

/** A log directory in memory, for the writer's rules. `appends` records each append's urgency. */
export function memoryDirectory(initial: Record<string, string> = {}): LogDirectory & {
  files: Map<string, string>
  appends: boolean[]
} {
  const files = new Map(Object.entries(initial))
  const appends: boolean[] = []
  return {
    files,
    appends,
    list: () =>
      Promise.resolve(
        [...files].map(([name, text]): LogFileInfo => ({ name, sizeBytes: text.length })),
      ),
    append: (name, text, urgent) => {
      appends.push(urgent)
      files.set(name, (files.get(name) ?? '') + text)
      return Promise.resolve()
    },
    remove: (name) => {
      files.delete(name)
      return Promise.resolve()
    },
    read: (name) => Promise.resolve(files.get(name) ?? ''),
  }
}
