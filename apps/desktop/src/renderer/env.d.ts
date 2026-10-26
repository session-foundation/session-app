import type { WithSpan } from '@session/basic-types'
import type { DiagnosticsSnapshot, ExportPart, LogFileInfo } from '@session/logging'

// The type imports make this a module, so what it declares for the page is declared global.
declare global {
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
     * An object rather than one entry per flag, because the flag table is shared code and the
     * config collects by prefix: a flag added there must not also need a line here. Prefixed like
     * the rest even though the config synthesises it rather than passing it through, so that
     * "everything carries the prefix" stays a rule with no exceptions to remember.
     */
    readonly EXPO_PUBLIC_SESSION_FLAGS?: Record<string, string>
    /** This app's version, from its manifest. */
    readonly EXPO_PUBLIC_SESSION_BUILD_VERSION: string
    /** The commit stamp, or null outside a git checkout. See `commitStamp` in the config. */
    readonly EXPO_PUBLIC_SESSION_BUILD_COMMIT: string | null
    /** The libsession submodule's commit stamp, or null outside a git checkout. */
    readonly EXPO_PUBLIC_SESSION_LIBSESSION_COMMIT: string | null
    /** What the build was made as, from whoever assembled it; empty when they did not say. */
    readonly EXPO_PUBLIC_SESSION_BUILD_VARIANT: string
    /** Vite's own: true under the dev server, false in a built bundle. */
    readonly DEV: boolean
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv
  }

  /** What the preload exposes, which is the whole of the page's privilege. */
  interface Window {
    readonly sessionDesktop: {
      openExternal(url: string): void
      chooseExportLocation(suggestedName: string): Promise<string | null>
      /** False when main refused a path outside the folders chosen this run. */
      revealInFolder(path: string): Promise<boolean>
      /** Rejects when the main process refuses: no recent click or key press, or too long. */
      copyText(text: string): Promise<void>
      setLocale(locale: string): void
      /** Ends this process and starts the app again in a fresh one. */
      restart(): void
      /** The content zoom from the View menu: called with the current one, then on each change. */
      onZoom(listener: (zoom: number) => void): void
      /** Main's clock, which times the renderer's lines; see `LogSession` in main's logs.ts. */
      openLog(): Promise<{ uptimeMs: number }>
      /** Lines as records, for main to sweep, render and write; see `LogRecord`. */
      appendLog(records: unknown[]): void
      retainedLogs(): Promise<LogFileInfo[]>
      logSpan(first: string, last: string): Promise<WithSpan>
      /** False when the person cancelled the save dialog. */
      exportLogs(name: string, parts: readonly ExportPart[]): Promise<boolean>
      /** What main's `log:diagnostics` handler returns, typed alike on both sides. */
      diagnostics(): Promise<DiagnosticsSnapshot>
    }
  }
}
