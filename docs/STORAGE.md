# Where the apps keep things

**Nothing the app keeps leaves the device.** No cloud backup, no computer backup, no transfer to a
new phone, no roaming profile. What is on disk is an account's messages, its attachments and the
logs about them, and the legacy clients keep all of it on the device; 2.0 does the same, and on
the desktop goes further than legacy did.

## The rule

Every file the mobile app stores lives under a **root** handed out by `apps/mobile/src/storage/`.
Each root is protected and excluded from backup by the platform before anything is written into
it, so a file created inside one inherits both. A file written anywhere else does not, which is why
nothing else may reach the file system.

| root      | iOS                      | Android            |
| --------- | ------------------------ | ------------------ |
| `data`    | `<app group>/session`    | `filesDir/session` |
| `logs`    | `<app group>/logs`       | `filesDir/logs`    |
| `exports` | `Library/Caches/exports` | `cacheDir/exports` |
| `staged`  | `<app group>/staged`     | `filesDir/staged`  |

`data` is libsession's, with a directory per network holding the database, its -wal and -shm, the
attachment cache and the netcache.

**iOS.** The roots live in the app-group container (`group.` + the bundle identifier), so a
notification extension can share the database rather than keep a copy of its own. Each root gets
data protection class C (`completeUntilFirstUserAuthentication`) and `isExcludedFromBackup`, and
the temporary directory gets class C, as legacy's do. Class C rather than A because messages arrive
while the phone is locked and have to be written then. `modules/storage-roots` does this as the app
delegate registers its subscribers, before JavaScript runs. A build without the app-group
entitlement falls back to Application Support with the same attributes, and says so in the startup
block.

**The database is closed whenever the app leaves the screen.** iOS kills an app that is suspended
while it holds a lock on a file in a shared container (exception code 0xdead10cc), and any write
in flight at that moment is enough. So as the app goes to the background it destroys the Client
under a background task: once nothing is outbound, or after 10 s, with the database's SQL
interrupted and rolled back if that is still not done 15 s in. It builds the Client again when the
app comes back. A send the close did not wait out shows as interrupted. Android keeps the database
open: it has no such rule. `apps/mobile/src/backgroundClose.ts` has the details.

A new file inherits its directory's class. A **moved or copied** file does not: since iOS 26 it
keeps the class of the directory it was first written in, and the temporary directory, where such
files usually start, defaults to `complete`, which a locked phone cannot open. Legacy hit this with
its extension's files and fixed it by protecting each one again where it landed. Here:

- **Everything the app writes is created where it stays, but for picks.** libsession's renames
  (`.part` to final, its snode and router caches) stay within one directory, and expo-file-system
  does not write through a temporary file. A picker writes its copy in the cache, and `staged`
  takes it in through `moveInto`.
- **A staged copy sent with a message is libsession's from then on.** `takeFile` has libsession
  move it beneath its cache, in the same container, so it keeps the class `moveInto` gave it, and
  the launch sweep of `staged` never meets it.
- **A move goes through `moveInto`**, which protects the file again where it lands. The storage
  module's `File` and `Directory` types leave out expo-file-system's `move` and `copy`, so nothing
  else can move a file in; a copy, when something needs one, gets a `copyInto` beside it.
- **The database files are protected again after libsession opens them**, as legacy does: SQLite
  creates the -wal and -shm when it needs them.
- **A notification extension, or anything else native that writes outside a root and moves the
  result in, has to call `protect` on it**, as legacy's extension does.

**Temporary files.** There is no temporary directory of the app's own: the pickers write theirs, and
what `staged` and `exports/attachments` hold is deleted at launch. The first thing that needs one -- the
notification extension, say -- should make one the way legacy does: a directory per launch inside `NSTemporaryDirectory()`, created
under class C, with the previous launches' directories deleted shortly after start
(`SessionFileManager.clearOldTemporaryDirectories` in legacy's `FileManagerType.swift`). Files staged
there still go into a root through `moveInto`.

**Android.** The manifest keeps the roots out: `allowBackup="false"`, and backup rules
(`fullBackupContent` and `dataExtractionRules`, for cloud backup **and** device-to-device transfer,
which `allowBackup` alone does not stop) that exclude every domain. The data and logs are in
`filesDir` rather than `noBackupFilesDir`, which would not depend on the manifest, because
expo-file-system lets JS write only in `filesDir` and `cacheDir`. So the startup block's Storage row
reads the app's own backup flag, and a manifest that lost it shows there. App-private storage is credential-encrypted, Android's
equivalent of class C, so there is nothing per file to set.

**The database key** is in the keychain as `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`: never in a backup,
so a backup restored to another phone carries a database it cannot open.

## How it is enforced

- `pnpm boundaries` (`mobile-files-go-through-storage`) and ESLint's mobile zone refuse
  `expo-file-system` in apps/mobile outside `src/storage/`.
- `apps/mobile/tests/backupConfig.test.ts` pins `allowBackup`, expo-secure-store's
  `configureAndroidBackup: false`, the backup rules and the app-group entitlement.
- At launch the startup block's `Storage` row reports each root's class and backup state, read back
  from the file system. A root missing either attribute is logged as a warning and protected again.

## Desktop

Everything is under Electron's `userData`.

- **macOS:** excluded from Time Machine at every launch (`tmutil addexclusion`, the sticky
  exclusion: an extended attribute on the directory, no root needed).
- **Windows:** under Local AppData rather than Roaming, which a roaming profile syncs.
- **Linux:** unchanged. There is no standard backup to opt out of.

The startup block's `Backup` row says which applies. On macOS the answer from `tmutil` is a line
of its own, logged when it comes back: it can take seconds, and the log is not held for it.
