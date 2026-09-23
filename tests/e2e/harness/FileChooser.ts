/**
 * Answering a native file dialog without one opening.
 *
 * Deliberately not part of `ISessionApp`, by that interface's own rule: a save dialog is the
 * operating system's window and no automation driver can drive one. What can be done is to
 * replace the call that opens it, which Playwright allows in Electron's main process and which
 * has no counterpart on a device - iOS and Android will need their own mechanism to answer the
 * same question, and the signature stays a string so it promotes unchanged if they ever share one.
 *
 * This stubs the *chooser*, not the write. Everything after the path is chosen - the IPC, the
 * folder the main process remembers, libsession writing the bytes - is the real thing, which is
 * the whole reason a test like this is worth having.
 */
export interface IFileChooser {
  /** Makes the next save dialog answer with this path instead of appearing. */
  answerSaveDialogWith(path: string): Promise<void>
  /** Makes the next save dialog answer as though somebody dismissed it. */
  cancelNextSaveDialog(): Promise<void>
  /**
   * Every path the app has asked the operating system to reveal, in order.
   *
   * The end of the chain, and the only part of it that is observable from outside: a reveal that
   * happened is a save that got a destination, reached libsession, came back with a path, and was
   * allowed by the folder the main process remembered from the dialog.
   */
  revealedPaths(): Promise<string[]>
}
