/**
 * What electron.vite.config.ts substitutes into the renderer bundle.
 *
 * Declared rather than pulled in with vite/client: the renderer's tsconfig lists its types
 * explicitly, and this is the only one of vite's it uses.
 */
interface ImportMetaEnv {
  /** The Session network this build talks to. See parseNetworkName. */
  readonly EXPO_PUBLIC_SESSION_NETID?: string
  /**
   * '1' when the build was started against the fake bridge. See the define block.
   *
   * The same spelling the main process reads and the same the `dev:fake` scripts set. It was
   * declared here without the prefix while everything else set it with one, so the badge that
   * says "this is the fake" read an unset variable and said nothing.
   */
  readonly EXPO_PUBLIC_SESSION_FAKE?: string
  /**
   * Every flag variable present when the renderer was built, keyed by its full name.
   *
   * An object rather than one entry per flag, because the flag table is shared code and the config
   * collects by prefix: a flag added there must not also need a line here. Prefixed like the rest
   * even though the config synthesises it rather than passing it through, so that "everything
   * carries the prefix" stays a rule with no exceptions to remember.
   */
  readonly EXPO_PUBLIC_SESSION_FLAGS?: Record<string, string>
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** What the preload exposes, which is the whole of the page's privilege. */
interface Window {
  readonly sessionDesktop: {
    openExternal(url: string): void
    chooseSaveLocation(suggestedName: string): Promise<string | null>
    revealInFolder(path: string): Promise<void>
    openPath(path: string): Promise<void>
  }
}
