/** A workspace package, as far as the manifest rule needs to know it. */
export interface WorkspacePackage {
  name: string
  /** Relative to the repo root. */
  directory: string
  /** Every workspace package its manifest names, in any dependency field. */
  declared: ReadonlySet<string>
  /** The siblings its manifest names under devDependencies and nowhere else. */
  devOnly: ReadonlySet<string>
  /** Its source files, with their text. Paths relative to the repo root. */
  sources: readonly { path: string; text: string }[]
}

export interface ImportViolation {
  package: string
  file: string
  imports: string
  rule: 'undeclared-import' | 'shipped-imports-dev-dep'
}

/** A static import, a re-export, a dynamic import or a require of a `@session/*` package. */
const SIBLING =
  /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"](@session\/[\w.-]+)/gm

/**
 * What a package ships, as root.cjs's not-to-dev-dep draws it: src/, less tests and dev entries.
 */
const SHIPPED = /^(?:packages|apps)\/[^/]+\/src\//
const NOT_SHIPPED = /\.(?:test|spec)\.[cm]?[jt]sx?$|\/dev\//

/** Whether the statement whose specifier starts at `index` is `import type` / `export type`. */
function typeOnly(text: string, index: number): boolean {
  const start = Math.max(text.lastIndexOf('import', index), text.lastIndexOf('export', index))
  const statement = text.slice(start, index)
  return start >= 0 && /^(?:import|export)\s+type\b/.test(statement) && !/['"]/.test(statement)
}

/**
 * Imports of a sibling the importing package does not declare, or declares only for development
 * while shipping the file that imports it.
 *
 * **Every such import resolves anyway**, which is why nothing else catches it: the hoisted layout
 * links every workspace package at the root, and tsconfig paths map the siblings to their source,
 * so typecheck and lint pass. It fails only when a bundler resolves from the package itself -- and
 * before that, turbo has already got it wrong, because `^build` and a task's cache key follow the
 * declared graph: a sibling nobody declared is neither built first nor hashed.
 *
 * The devDependency case is depcruise's `not-to-dev-dep` for siblings: the tsconfig alias makes
 * dependency-cruiser see them as local paths, never as an npm package of any kind.
 */
export function importViolations(packages: readonly WorkspacePackage[]): ImportViolation[] {
  const found: ImportViolation[] = []
  for (const pkg of packages)
    for (const source of pkg.sources)
      for (const match of source.text.matchAll(SIBLING)) {
        const imported = match[1]
        if (imported === undefined || imported === pkg.name) continue
        const violation = { package: pkg.name, file: source.path, imports: imported }
        if (!pkg.declared.has(imported)) found.push({ ...violation, rule: 'undeclared-import' })
        else if (
          pkg.devOnly.has(imported) &&
          SHIPPED.test(source.path) &&
          !NOT_SHIPPED.test(source.path) &&
          !typeOnly(source.text, match.index)
        )
          found.push({ ...violation, rule: 'shipped-imports-dev-dep' })
      }
  return found
}
