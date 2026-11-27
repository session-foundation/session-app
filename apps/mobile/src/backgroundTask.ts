import { requireOptionalNativeModule } from 'expo'

/** `modules/background-task`, iOS only: the grace iOS gives an app that has left the screen. */
interface BackgroundTaskModule {
  begin(): void
  end(): void
}

export const BackgroundTask = requireOptionalNativeModule<BackgroundTaskModule>('BackgroundTask')
