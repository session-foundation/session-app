/**
 * What every launch of the desktop app on the fake starts from: spread over `process.env`, under
 * a spec's own additions.
 *
 * The world selectors are pinned empty, which the fake reads as unset. Desktop main loads the
 * repo .env and a launch spreads process.env, so a developer's fixture would otherwise win over a
 * spec's NO_ACCOUNT=1 and fail it on a timeout.
 */
export const FAKE_LAUNCH_ENV = {
  // Electron refuses Chromium's flags when this is set, and terminals set it.
  ELECTRON_RUN_AS_NODE: '',
  EXPO_PUBLIC_SESSION_FAKE: '1',
  EXPO_PUBLIC_SESSION_FAKE_FIXTURE: '',
  EXPO_PUBLIC_SESSION_NO_ACCOUNT: '',
  EXPO_PUBLIC_SESSION_FAKE_CROWD_PEERS: '',
  EXPO_PUBLIC_SESSION_FAKE_CROWD_HISTORY: '',
  EXPO_PUBLIC_SESSION_FAKE_SLOWDOWN: '',
  EXPO_PUBLIC_SESSION_FAKE_PATHS: '',
  EXPO_PUBLIC_SESSION_FAKE_FAILED_START: '',
  EXPO_PUBLIC_SESSION_FAKE_KEY_CUSTODY: '',
} as const
