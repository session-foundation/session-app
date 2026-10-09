/**
 * The graph as Metro resolves it, `.native` first.
 *
 * root.cjs resolves as the desktop bundle does: a `.native` file's own imports are checked there,
 * but no import ever lands on one, which is why root once reported every `.native` file as an
 * orphan. Here an import does land on one, so cycles are checked again on the graph Metro sees,
 * and `native-unreachable` refuses a `.native` file the mobile bundle never reaches. Reachable
 * means a chain of imports the cruise can see, resolved `.native` first, from one of the mobile
 * roots: `apps/mobile/index.ts`, a route file under `apps/mobile/app/`, or the fake's dev entry
 * under `apps/mobile/src/dev/`. A file only reached through a port set at runtime or a dynamic
 * import gets its root added to the rule, never an exemption.
 *
 * What neither pass can see is a `.native` file whose plain twin is missing: Metro resolves it and
 * root.cjs never lands on it, so turbo-guard (`lint:manifests`) refuses that one.
 *
 * Only the `.native` split is resolved. Metro would also take `.ios`, `.android` and `.web`, but no
 * pass here does, so such a file is refused until a split needs it and this config learns it.
 *
 * Run: pnpm boundaries
 */
const root = require('./root.cjs')

const rule = (name) => {
  const found = root.forbidden.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`root.cjs has no rule named ${name}`)
  return found
}

/** Where the mobile bundle starts: the entry, the route files, and the fake's dev entry. */
const MOBILE_ROOTS = '^apps/mobile/(index\\.ts$|app/|src/dev/)'

module.exports = {
  forbidden: [
    rule('no-circular'),
    {
      name: 'native-unreachable',
      comment:
        'No mobile root imports this .native file, so Metro never bundles it: it is dead code ' +
        'root.cjs cannot see. Delete it, or add the root that loads it to MOBILE_ROOTS.',
      severity: 'error',
      from: { path: MOBILE_ROOTS },
      to: { path: '\\.native\\.tsx?$', reachable: false },
    },
  ],
  required: [
    {
      name: 'no-platform-suffix',
      comment:
        'Only .native splits are resolved; see the header before adding .ios, .android or .web.',
      severity: 'error',
      module: { path: '\\.(ios|android|web)\\.[jt]sx?$' },
      to: { path: '^$' },
    },
  ],
  options: {
    ...root.options,
    enhancedResolveOptions: {
      ...root.options.enhancedResolveOptions,
      extensions: ['.native.ts', '.native.tsx', ...root.options.enhancedResolveOptions.extensions],
    },
  },
}
