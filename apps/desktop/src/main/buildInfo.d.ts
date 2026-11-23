/**
 * The build's stamps, substituted by `electron.vite.config.ts` when main is bundled: main writes
 * the log's startup block, and a packaged app has no git and no build environment to ask.
 */
declare const __SESSION_BUILD_INFO__: {
  version: string
  /** Eight characters, `-dirty` when the tree had changes; null outside a git checkout. */
  commit: string | null
  libsessionCommit: string | null
  /** `EXPO_PUBLIC_SESSION_BUILD_VARIANT` at build time, empty when unset. */
  variant: string
  /** Every `EXPO_PUBLIC_SESSION_FLAG_` variable present at build time. */
  flags: Record<string, string>
}
