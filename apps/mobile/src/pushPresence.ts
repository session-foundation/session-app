import { AppState } from 'react-native'

let open: string | null = null

/** Nothing to tell the native side on iOS yet: the notification extension arrives with APNs. */
export function reportOpenConversation(id: string | null): void {
  open = id
}

/** Whether `id` is the conversation on screen with the app in front. */
export function onScreen(id: string | undefined): boolean {
  return AppState.currentState === 'active' && id !== undefined && id === open
}
