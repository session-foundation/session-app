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
dev entries. When a rule fires, fix the design - not the config.

## Hard rules

- UI components come only from `@session/ui`. Never tamagui, react-native primitives or HTML
  elements in `packages/screens` or in an app.
- Ports: module-scope `setPorts()` / `requirePorts()` for non-React consumers, installed by a
  side-effecting import at each app's entry; React context for render-scoped ports (NavPort);
  `.native.tsx` pairs with a shared `.types.ts` for file-level splits. New port =
  `turbo gen port`.
- State: app state goes in the zustand store (`@session/state`). React context is only for a
  value that differs by subtree, such as which pane a screen is in or which surface it is drawn
  on. Consider the store first.
- Navigation: build paths with `routes.ts` only. Route params are extracted at the route file
  and passed as props - a screen never reads a router. Every route gets a route-contract row.
  **A mobile route file calls `useLocale()`**: `tr()` is a module-scope read, and the router holds
  the routed element, so nothing below re-renders on a language change unless the route itself
  subscribes. Keying the navigator on the language is the shorter answer and it remounts the
  subtree, losing a half-typed name, a pasted recovery phrase, and the whole of onboarding.
- Every interactive element takes its `testID` from `@session/test-ids`. An element a test cannot
  address is a missing testID: fix the component, never reach for xpath. Address by id, then
  assert the copy.
- No `.js`/`.jsx` extensions in import paths. No inline `import('x').T` types - top-level
  `import type` instead.
- The fake mirrors the real bridge. Any bridge change updates `packages/client/src/fake` and
  the contract scenarios **in the same PR**.
- Tamagui: a missing token resolves to 0 silently, so token names must exist; `defaultFont`
  must be set; every scale is named rather than numbered. No hex outside `@session/theme-tokens`.
- **Every user-visible string comes from the Crowdin catalogue.** `packages/localization/src/**/generated/` is regenerated wholesale by the shared translation scripts, so a key added there is lost on the next run and fails the lint meanwhile. Use a key that exists, or hard-code the English and raise the missing key -- never add one to the generated files. The one exception is Developer Settings, whose words are English beside the flag table (`packages/app/src/developerSettings.ts`), as legacy iOS's are.
- Colour and type: `docs/THEMING.md` says which role to reach for and why. A theme is authored
  knobs plus derived roles - never add a hex, and never derive a value from the base when it is
  drawn on a card.
- Feature flags: every flag must be overridable by an environment variable **on all three
  platforms**, unless the flag's own doc comment says why it cannot be. A flag that can only be
  flipped by editing source cannot be used to bisect a bug on someone else's device, which is most
  of what a flag is for. The default belongs in the shared flag table; reading the override is a
  port, because each platform exposes the environment differently.
- An environment variable that means the same on every platform has one name on all of them,
  `EXPO_PUBLIC_SESSION_<AREA>_<NAME>`, desktop included - the shape `envVarFor` derives for flags.
  One whose value only makes sense on the machine running it (a host path) stays unprefixed.
- Types compose from small `With*` pieces in `packages/basic-types/src/with.ts`. A shape declared
  inline twice gets a `With*`. A discriminated union is one shared piece plus one piece per variant
  (`Shared & (TextVariant | IconVariant)`), never an optional field only one variant uses.
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
- **A list row stays cheap.** Nothing is mounted once per row that can live once on the list or
  the screen: no gesture detector, animated value or style, wrapper view, context provider, effect
  or timer on a message row, a conversation row or an album tile. A list is shown after drawing a
  screenful, not a page. A change to a row component or to a list's first render carries its open
  time measured on a phone against the base, in the PR: the catalog and the desktop e2e show
  neither cost.

## Porting a screen

Compare it side by side with all three legacy clients before calling it done; the `port-feature`
skill has the checklist.

## Tests required, in the same PR

| change            | test                                                                |
| ----------------- | ------------------------------------------------------------------- |
| bridge capability | contract scenario + fake update + echo-frame case                   |
| screen            | route-contract row + fast-tier e2e smoke                            |
| ui component      | catalog story; a render test only for what a picture cannot show    |
| screen state      | catalog scenario in `apps/desktop/src/renderer/catalog/scenarios`   |
| state projection  | reducer unit test                                                   |
| bug fix           | the test that would have caught it: a catalog row if it can be seen |

**What can be seen is tested in the catalog, not in a render test.** A look (colour, fill, ring,
hover, press, focus, direction, layout at a width) is a story in `packages/ui/src/catalog/stories`:
a row per variant including the worst case, `forced` for interaction states, `sensitive` for
accent, RTL and width. Argos diffs every page and axe audits it on each PR. A `*.test.tsx` holds
only what a picture cannot show: accessible role, name and state; what a press calls; focus and
timing; two outcomes that draw alike (which verb, which id, against `@session/expectations`); a
contract another package reads. A render test that asserts a style, a colour or a direction
repeats the catalog: write the story instead.

No new source grep where a drawn check can fail instead: assert what is drawn, not what a file
contains. The exceptions say why, one by one: `packages/ui/tests/nativeOnly.contract.test.ts` for
what no driver reads, and the repo-wide `*.contract.test.ts` checks (copy, logical edges, named
tokens).
What only a phone shows goes in a shared spec with `clients: { alice: EACH }`, run by
`pnpm --filter @session/e2e test:e2e:android` (or `:ios`).

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

Changed `packages/bridge-types`, the shim C++, a `*.nitro.ts` spec or the `libsession-util/`
submodule → the `build-native` skill, before running anything. `turbo build:native` alone leaves
iOS on stale headers.

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
