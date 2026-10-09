# session-app

One shared UI and one set of shared screens across an Expo app (`apps/mobile`, Android + iOS,
phone + tablet) and an Electron app (`apps/desktop`, Linux/macOS/Windows). libsession-util
(`client` branch, `libsession-util/` submodule) is the backbone: it owns the database, polling,
sending, receiving, attachments and retries, and pushes whole-state events. Apps render what
libsession says the state is and forward actions to it.

`docs/ARCHITECTURE.md` has the map. There is no web app: desktop means Electron.

## Boundaries

`pnpm boundaries` (dependency-cruiser) is the authority; the ESLint zone matrix says the same
things while you type. Both enforce: nothing imports `apps/*`; `ui` imports no sibling but
theme-tokens/test-ids/basic-types; `screens` imports ui/state/app/client/localization/test-ids;
`tamagui` only in `packages/ui`; `react-native` only in ui and apps/mobile; `expo-*` only in
apps/mobile; `electron` only in desktop main and preload; `react-router` only in the desktop nav
driver; no node builtins in shared packages; the Nitro module only from
`packages/client/src/*.native.*`; the addon only from desktop main; the fake only from tests and
dev entries. depcruise alone also refuses orphan files, unresolvable imports, `src` importing a
test, and shipped code importing a registry devDependency; a `@session/*` sibling listed only under
devDependencies is turbo-guard's to refuse (`lint:manifests`), since the tsconfig alias hides it
from depcruise. depcruise runs twice: `root.cjs` resolves as the desktop bundle does and
`native.cjs` as Metro does, which is the only pass that resolves an import to a `.native` file and
refuses one no mobile root reaches; a `.native` file without its plain twin is turbo-guard's too.
When a rule fires, fix the design - not the config.

## Hard rules

- UI components come only from `@session/ui`. Never tamagui, react-native primitives or HTML
  elements in `packages/screens` or in an app.
- Ports: module-scope `setPorts()` / `requirePorts()` for non-React consumers, installed by a
  side-effecting import at each app's entry; React context for render-scoped ports (NavPort);
  `.native.tsx` pairs with a shared `.types.ts` for file-level splits. New port =
  `turbo gen port`.
- Navigation: build paths with `routes.ts` only. Route params are extracted at the route file
  and passed as props - a screen never reads a router. Every route gets a route-contract row.
  **A mobile route file calls `useLocale()`**: `tr()` is a module-scope read, and the router holds
  the routed element, so nothing below re-renders on a language change unless the route itself
  subscribes. Keying `<Slot>` on the language is the shorter answer and it remounts the subtree,
  losing a half-typed name, a pasted recovery phrase, and the whole of onboarding.
- Every interactive element takes its `testID` from `@session/test-ids`. An element a test cannot
  address is a missing testID: fix the component, never reach for xpath. Address by id, then
  assert the copy.
- No `.js`/`.jsx` extensions in import paths. No inline `import('x').T` types - top-level
  `import type` instead.
- The fake mirrors the real bridge. Any bridge change updates `packages/client/src/fake` and
  the contract scenarios **in the same PR**.
- Tamagui: a missing token resolves to 0 silently, so token names must exist; `defaultFont`
  must be set; every scale is named rather than numbered. No hex outside `@session/theme-tokens`.
- **Every user-visible string comes from the Crowdin catalogue.** `packages/localization/src/**/generated/` is regenerated wholesale by the shared translation scripts, so a key added there is lost on the next run and fails the lint meanwhile. Use a key that exists, or hard-code the English and raise the missing key -- never add one to the generated files.
- Colour and type: `docs/THEMING.md` says which role to reach for and why. A theme is authored
  knobs plus derived roles - never add a hex, and never derive a value from the base when it is
  drawn on a card.
- Feature flags: every flag must be overridable by an environment variable **on all three
  platforms**, unless the flag's own doc comment says why it cannot be. A flag that can only be
  flipped by editing source cannot be used to bisect a bug on someone else's device, which is most
  of what a flag is for. The default belongs in the shared flag table; reading the override is a
  port, because each platform exposes the environment differently.
- Types compose from small `With*` pieces in `packages/basic-types/src/with.ts`. A shape declared
  inline twice gets a `With*`. A discriminated union is one shared piece plus one piece per variant
  (`AlbumImage | AlbumVideo`), never an optional field only one variant uses.
- `exactOptionalPropertyTypes` is on. Our optional props are `x?: T | undefined`, so a caller
  writes `x={x}`; the `{...(x === undefined ? {} : { x })}` spread is only for a third-party prop.
- A numeric name carries its unit (`sizeBytes`, `timeoutMs`) unless it is already a count.
- Define constants and helpers above their first use.
- Never define a component or render function inside another component; ESLint refuses it. Move
  it to module scope and pass what it reads as props.
- **The desktop renderer is granted no Chromium permission**, the clipboard's included:
  `denyAllPermissions` stays deny-all. What the page needs from the OS is a named preload
  function, handled on that window's `webContents.ipc` (not the global `ipcMain`), which checks
  the sender with `isFromAppFrame` and bounds its arguments. ESLint refuses `ipcMain` in desktop
  main, and an `ipc` handler that does not call `isFromAppFrame`.
- A port method one platform cannot honour is dropped or made nullable, never implemented to
  always fail.

## Porting a screen

**Put it side by side with the legacy clients — all three of them — and compare, before calling
it done.** Most UI exists on iOS, Android and Desktop, and where they differ the point is to pick
the best of the three for 2.0 rather than to follow whichever one was read first. Onboarding is the
exception that proves it: Desktop's is a different design, so there the mobile pair is the
reference. Reading the legacy source and reasoning about what it should look like is not the same
check and does not catch the same things: a screen whose flow completes can still have the wrong background, the
wrong button filled, missing chrome, wrong type sizes and a control nobody can hit. Walk the list
deliberately — colours, which button is primary, chrome present in one and not the other, type
sizes, control sizes and hit areas, spacing, transitions. An already-ported sibling counts as a
reference: the tablet layout will catch most of a phone layout's mistakes.

## Tests required, in the same PR

| change            | test                                              |
| ----------------- | ------------------------------------------------- |
| bridge capability | contract scenario + fake update + echo-frame case |
| screen            | route-contract row + fast-tier e2e smoke          |
| ui component      | render test                                       |
| state projection  | reducer unit test                                 |
| bug fix           | the test that would have caught it                |

**Tests live in `tests/`, never in `src/`.** Every package puts them in its own
`packages/<pkg>/tests/`, mirroring the `src/` path they cover -
`src/nav/routes.ts` is tested by `tests/nav/routes.contract.test.ts`. Cross-app end-to-end
specs stay in the repo's top-level `tests/e2e/`. A spec that launches an app itself rather than
through `sessionTest` closes it in a `finally`, or a failed assertion leaves the process running.

A test reaches its own package through `#src/*`, never `../src/*`:

```ts
import { shouldStampNetwork } from '#src/networkStamp'
```

Two lines make that work, and a new package with tests needs both. `package.json` maps the
subpath, with the extensions spelled out because neither tsc nor Node substitutes one through
a pattern:

```jsonc
"imports": { "#src/*": ["./src/*.ts", "./src/*.tsx"] }
```

and `tsconfig.json` lists `tests` in `include`, or nothing in there is typechecked - vitest
finds tests wherever they sit, so an unchecked one still runs and nothing complains.

## Native rebuild triggers

- `packages/bridge-types` changed → `turbo codegen && turbo build:native` (the generated C++
  under `packages/bridge-core/include/session_bridge/gen` is committed; CI's `codegen:check`
  fails otherwise)
- shim C++ changed → `turbo build:native`
- `*.nitro.ts` changed → `turbo codegen`, then rebuild the mobile dev client
- `libsession-util/` submodule bumped → the `build-native` skill's procedure: rebuild all three
  targets and run the contract suite against the real addon before committing

**`turbo build:native` only rebuilds the node addon.** iOS reads `bridge-core`'s headers from a
vendored binary, `packages/bridge-rn/ios/SessionBridgeCore.xcframework`, whose `Headers/` sit ahead
of the source on the search path — so editing `bridge-core` and rebuilding the addon leaves iOS
compiling against whatever that artefact was built from, however old. `pod install` does not
refresh it either. Rebuild it with `packages/bridge-rn/scripts/build-libsession-ios.sh`, and use
`all` or `both` rather than `simulator`: the one-slice modes also rename the simulator slice, which
breaks the next build with an `rsync … ios-arm64_x86_64-simulator: No such file or directory` a
long way from its cause.

**Regenerating also needs `pod install` before iOS will build.** The nitrogen output is _copied_
into `Pods/Headers/Public/SessionBridgeRN`, so a regeneration that adds a header — a new type in
the spec — leaves that copy missing it.

## Commands

```
pnpm install
pnpm dev                       # both apps against libsession; or dev:desktop / dev:mobile
pnpm dev:fake                  # the same on the fake: no network, seeded history, dev:*:fake too
pnpm android                   # build and install the mobile dev client; or ios
turbo lint typecheck test
pnpm boundaries
turbo test:e2e:fast            # Electron + the fake; e2e workflows are manual dispatch in CI
turbo gen package|screen|port|bridge-capability
```

## Conventions

English everywhere - commits, PRs, comments, docs. Commit subjects are imperative; no AI
attribution or co-author trailers. Branch off `main` and open a PR; never push to `main`.
Comments explain a constraint or a choice; they never restate the code.

`pnpm install` points git at `.githooks/`. `tooling/checks/src/checks.ts` places every `pnpm`
step of CI in pre-commit, in pre-push (narrowed to the packages the branch changes), or in CI alone
with a reason; `lint:manifests` fails when it and the workflow disagree, so a new CI check goes
there too. A hook checks the working tree, not the commit: CI is the authority, and a commit that
left a fix unstaged fails there. commit-msg refuses co-author and AI attribution lines. Never commit
or push with `--no-verify`: fix what the hook found.
