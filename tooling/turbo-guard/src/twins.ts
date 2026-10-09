const NATIVE = /^(.*)\.native\.([cm]?[jt]sx?)$/
const TWIN_EXTENSIONS = ['ts', 'tsx', 'js', 'jsx']

/**
 * `.native` files with no plain twin beside them, which the desktop bundle cannot resolve.
 *
 * Neither depcruise pass sees this: native.cjs resolves the `.native` file and is satisfied, and
 * root.cjs never lands on it, so the import looks fine until electron-vite fails on it.
 */
export function nativeWithoutTwin(files: ReadonlySet<string>): string[] {
  return [...files]
    .filter((file) => {
      const stem = NATIVE.exec(file)?.[1]
      return (
        stem !== undefined &&
        !TWIN_EXTENSIONS.some((extension) => files.has(`${stem}.${extension}`))
      )
    })
    .sort()
}
