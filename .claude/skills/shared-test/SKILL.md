---
name: shared-test
description: Write an end-to-end flow spec that runs against every client. Use when adding e2e coverage for a user-visible flow in session-app.
---

# Writing a flow spec

One spec, every platform. That only works if the spec never says anything platform-specific.

## Declare it

```ts
sessionTest({
  title: 'blocks a contact from the conversation menu',
  risk: 'medium',
  clients: { alice: 'desktop', bob: 'android' },
  run: async ({ alice, bob }) => { ... },
})
```

The `clients` descriptor decides the platforms _and_ the tags - `@cross-platform`,
`@medium-risk`, `@2-devices` - which is what CI selects on. Nobody writes tags by hand, so
they cannot drift from what the test actually needs.

`sessionTest` is the only thing that opens or closes a client. A spec that opened its own
would leak one the first time an assertion failed halfway through.

## Address by id, assert the copy

```ts
await alice.tap(ELEMENT.conversation.menu)
expect(await alice.readText(ELEMENT.conversation.headerName)).toBe('Bob')
```

Every id comes from `@session/test-ids`. **An element you cannot address is a missing `testID` on
the component** - add it there and to the registry. Never reach for an xpath, a class name or
a text selector to get around it: those break on a copy change and hide the real problem,
which is that the component is not addressable.

Ids are the anchor; text is the assertion. That way a copy regression fails loudly instead of
making the test fail to find anything.

## Only what ISessionApp offers

The spec may use `waitForVisible`, `tap`, `type`, `readText`, `readAllText`, `screenshot`. If
you need something else, add it to `ISessionApp` **and implement it for every platform**. A
verb only one driver can do belongs in a narrower interface until the others catch up.

## Sequencing

Assertions against one client run in sequence - a driver session takes one command at a time.
Assertions across clients can run together:

```ts
await Promise.all([verify(alice), verify(bob)])
```

## Run it

```
pnpm --filter @session/desktop build
xvfb-run -a pnpm --filter @session/e2e test:e2e:fast
```

`e2e-fast` and `e2e-full` are started by hand. `devices` runs the `android` and `ios` projects
nightly on main, or by dispatch.
