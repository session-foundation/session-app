# The benchmark, on a phone

Every other number in this exercise was taken on a development machine, under V8, on desktop
silicon. Hermes has no comparable optimising tier and a phone is much slower. **That multiplier is
the only thing that can overturn the conclusion that removing the serialisation from the mobile
path is not worth it**, and it cannot be measured anywhere but here.

## What this does and does not need

It measures the **JavaScript half only** - the protobuf decode through the real
`createSessionClient`, and `applyEvent`. That half imports no native module, so this runs in
**Expo Go with nothing built**: no dev client, no signing, no libsession for the device.

The bridge half - the C++, the JSI hop - does need a dev client and a signed device build. That is
a separate and much larger job; see below.

## Running it

```sh
cd tests/bench/mobile
pnpm exec expo start
```

Scan the QR code with Expo Go. Press the button, wait a few seconds, read the table.

The app deliberately blocks the thread while it runs, which is the thing being measured. It will
look frozen. That is the point.

## Reading it

Run the same measurement on this machine for the baseline:

```sh
BENCH_OUT=/tmp/bench.txt pnpm exec vitest run --root tests/bench src/mobileRunner.test.ts
```

It is the same file - `mobile/src/run.ts` - so the two are directly comparable. Divide.

For reference, on an Apple Silicon Mac under Node 22:

| rows | KB    | decode | project | total |
| ---- | ----- | ------ | ------- | ----- |
| 100  | 12.0  | 0.06   | 0.00    | 0.07  |
| 500  | 60.5  | 0.26   | 0.01    | 0.27  |
| 1000 | 120.7 | 0.51   | 0.03    | 0.55  |
| 5000 | 604.8 | 2.67   | 0.20    | 2.87  |

What the ratio decides:

- **Under about 5x** - the decode stays well inside a frame even at a thousand conversations, and
  the serialisation is not worth removing. Spend the effort on the projection and on virtualising
  the lists instead.
- **Around 10x** - a thousand conversations costs roughly 5 ms to decode. Worth having back, but
  still behind the render.
- **Above about 20x** - the decode is a frame on its own, and the direct-JSI path earns its
  maintenance cost.

## Measured: iPhone X, iOS 16.7.12, Safari / JavaScriptCore

| rows | KB    | decode | project | total | vs the Mac above |
| ---- | ----- | ------ | ------- | ----- | ---------------- |
| 100  | 12.0  | 0.433  | 0.033   | 0.47  | 6.7x             |
| 500  | 60.5  | 1.067  | 0.100   | 1.17  | 4.3x             |
| 1000 | 120.7 | 2.200  | 0.200   | 2.40  | 4.4x             |
| 5000 | 604.8 | 11.667 | 1.000   | 12.67 | 4.4x             |

**The A11 hardware factor is 4.4x**, and it holds across every size. Taken alone it says "not
worth removing" - and taken alone it is misleading, which is the point of the next table.

## Measured: iPhone X, iOS 16.7.12, Expo Go / Hermes

| rows | KB    | decode  | project | total  | vs Mac | vs JSC on the same phone |
| ---- | ----- | ------- | ------- | ------ | ------ | ------------------------ |
| 100  | 12.0  | 2.943   | 0.094   | 3.04   | 43x    | 6.5x                     |
| 500  | 60.5  | 15.488  | 0.632   | 16.12  | 60x    | 13.8x                    |
| 1000 | 120.7 | 30.763  | 1.371   | 32.13  | 58x    | 13.4x                    |
| 5000 | 604.8 | 153.685 | 8.264   | 161.95 | 56x    | 12.8x                    |

**The factors do not multiply.** Hardware alone is 4.4x and the estimate `4.4 x (2 to 3)` gave
9-13x; the real number is **58x**, out by a factor of five. Hermes costs 13.4x on the very device
where JavaScriptCore costs 4.4x, and anyone reasoning from separately-measured factors would have
carried that error into a design decision. Measure the combination.

**Decode is 95-97% of it.** At a thousand conversations that is 32 ms on the JavaScript thread -
two dropped frames at 60 Hz - for a single `conversation_list_replaced`. At five thousand it is
162 ms.

On the thresholds above this is comfortably in "the direct-JSI path earns its maintenance cost",
and the pass-count argument in the write-up is attacking exactly the 96%.

## The browser fallback

When Expo Go will not open - it requires an account, and the App Store build tracks the newest SDK
rather than this project's - Safari answers the hardware half with nothing installed:

```sh
node_modules/.bin/esbuild tests/bench/mobile/src/web-entry.ts --bundle --format=iife \
  --outfile=tests/bench/mobile/web/bench.js
node tests/bench/mobile/web/serve.mjs
```

Then open `http://<this machine>:8090` on the phone. Results post back to the terminal.

## Timing resolution

`performance.now()` is not guaranteed sub-millisecond under Hermes, so `perCall` times a batch and
divides rather than timing one call. Do not "simplify" that back to a single timed call: the
numbers here are fractions of a millisecond and a one-millisecond clock reports them as 0 or 1.

## The other half, later

Measuring the bridge on a device needs, in order:

1. **libsession and the shim cross-compiled for device arm64.** Only a simulator slice has ever
   been built - `pnpm --filter @session/bridge-rn build:libsession:ios` builds one. See
   `.claude/skills/run/references/ios.md`.
2. **A real signing identity.** The simulator build passes `CODE_SIGN_IDENTITY="-"`, which a device
   will not accept.
3. `npx expo prebuild --platform ios`, `pod install`, then `xcodebuild` against
   `platform=iOS,id=<udid>`.

An iPhone X is a good target for this precisely because it is slow: an A11, and the oldest device
the deployment target in `SessionBridgeRN.podspec` (iOS 15.1) still admits.
