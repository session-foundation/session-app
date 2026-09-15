# Where session-app is

What is missing and what needs deciding. `ARCHITECTURE.md` is how the thing is built and why,
`CLAUDE.md` is the rule list, and the `run` skill is how to build and drive each client. This
file does not repeat them, and deliberately carries no branch name, submodule SHA or test count -
those go stale faster than anyone updates them.

The loop is closed on all three clients: an account is created, the network attaches, messages
arrive and messages send, against real libsession over mainnet. What is left is features, one at
a time, via the `port-feature` skill.

## Not built yet

- **Push.** `setPushToken` and `handlePushPayload` are in the protocol and the shim answers both
  with an error naming itself.
- **Sending an attachment.** Receiving one works: metadata, a download with progress, saving to a
  chosen path, and the per-conversation auto-download setting. `sendMessage` still takes a body
  and nothing else, so `SendState::uploading` is a state nothing here can reach.
- **Showing an attachment on mobile.** Desktop draws pictures inline over the `session-media`
  scheme; React Native needs a native image loader per platform - an `RCTImageURLLoader` on iOS, a
  Fresco fetcher on Android - and neither is written, so `MediaPort.urlFor` returns null there and
  the file form is what mobile shows.
- **A full-size viewer.** Tapping a picture does nothing: there is no screen to open.
- **Returning to a conversation starts at the newest page.** A window is dropped when its screen
  stops showing it, so paging depth and scroll position go with it. Keeping both - so that coming
  back puts you where you were - is its own piece of work and wants doing deliberately rather than
  by keeping every window loaded for the session, which is what this replaced.
- **Anything a message can be beyond text**: no reactions, replies, edits, deletes or read
  receipts.
- **A devnet cannot have its own Pro backend.** The key libsession verifies proofs against is a
  `constexpr` read at one call site in `core.cpp`, so pointing a build at another deployment needs
  a libsession change. Nothing here configures one, and nothing here has Pro code to configure.
- **Android has not been run against a devnet.** iOS has - it discovered 15 seed nodes, built its
  paths and polled its swarm - and the two share everything above the Nitro module, so what is
  untried is the Android side of that module rather than any of the logic. A dev client built
  since the shim last changed is what it needs.
- **Onboarding is one button.** `restoreAccount` is a bridge command already, with no screen.
- **No contact list and no QR scanner.** Starting a conversation means pasting an account ID.
- **iOS device builds and a release-shaped xcframework.** The simulator works; nothing has been
  signed with a real identity.
- **devnet refuses rather than half-working.** It needs seed nodes - a public key, an address and
  two ports each - which is not something a `devnet_seed_url` can be turned into. How the app
  learns those is a devnet question rather than a bridge one.

## Questions that need a person

- **Accepting a message request.** `approveConversation` has no libsession counterpart: approval
  is recorded by messages flowing, and writing to someone is what approves them. Session's UX has
  an Accept button that sends nothing, so either the conversation layer needs a way to accept
  without answering, or the button has to mean something else. Not hypothetical - `RequestsScreen`
  draws that button and calls this, so against the real bridge accepting a request does nothing
  and rejects into a `void`. The fake implements it, which is why every loop except the contract
  against the real addon looks correct. The button and the command have to be settled together.
- **Background and push.** The requirement is both slow-path OS wakeups and push-triggered fetch,
  on all three platforms. Three things need raising with the libsession team before the iOS side
  can be designed: a supported one-shot poll entry point; decrypting a push envelope without
  opening the database, for the notification service extension; and whether an extension and the
  app can hold the same database at once.
- **Thumbnails.** A transcript fetches whole attachments to draw them, which is what libsession
  offers today. They should be generated locally from whatever can produce one rather than fetched
  as a second file from the server, and that needs an image decoder wherever it happens.
- **Two things to ask libsession for.** `conversation_id` inside `AttachmentProgress`, so a report
  from a command's own handler carries what the background callback already does and a screen can
  drop what it is not showing. And `attachment_cache_size()`, a sum over the cache index: there is
  a getter for the limit and none for the usage, so nothing can say how full it is.
- **Three strings in settings have no catalogue key.** The attachment cache section needs
  "Attachment Cache", "Reveal" and "No limit", and the Crowdin set has nothing that fits, so they
  sit in `packages/screens/src/pendingCopy.ts` and ship as English in every locale. Each is named
  for the token it is destined for; `copy.contract.test.ts` pins the list so a fourth cannot join
  quietly. They want a pull request against session-localization and a submodule bump.
- **`device::Type` for the new clients.** Device records are user-visible on linked devices, so
  this is an upstream conversation.
- **The desktop app's name is a placeholder.** `app.setName('session-app')` deliberately avoids
  `Session`: the shipped client owns that directory, and a dev build opening the real client's data
  would be a bad afternoon. Somebody has to decide on branding before a release.
- **libsession verifies a Pro proof and discards the answer.** `decode_dm_envelope` returns a
  `DecodedPro` whose own comment says the caller must check its status; `Core` never reads it and
  copies only the raw signature off the wire, so `pro_signature` on a received message means "a
  signature was present" rather than "a valid proof". Worth raising upstream on its own account -
  it is not about which backend signs.
- **Mnemonic handling.** libsession owns the word list, so no TypeScript library is needed, but
  once words cross into JavaScript they cannot be wiped. Keep them out of logs and out of the
  store.

## Known gaps in the safety net

- **CI compiles no C++.** `ci.yml` and `e2e-fast` initialise only the localization submodule, so
  every addon test guards itself on the built artifact and skips when it is absent. `e2e-full`
  does check out submodules recursively, and is manual dispatch only.
- **Two npm patches are carried in `patches/npm/`** and applied by `pnpm install`: nitrogen, and
  expo-modules-jsi, which does not compile under Xcode 26. Each goes away when an upstream release
  fixes it, and nothing checks whether one has - the `run` skill's traps table has the symptoms.
- **There is no macOS runner.** The iOS build is verified by hand on a Mac and nothing else.
- **A send in the first seconds after launch fails.** The router bootstraps for about ten seconds
  after the bridge attaches, and a QUIC handshake started before then times out. Retry is the
  answer. Nothing waits for the router, because `networkAttached` goes true when the bridge
  attaches rather than when the router is ready - an indicator built on it would say "connected"
  through the whole window where sending does not work.
