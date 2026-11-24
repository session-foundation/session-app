import { requireOptionalNativeModule } from 'expo'
import { AppState } from 'react-native'

const SessionPush = requireOptionalNativeModule<{
  setOpenConversation(id: string | null): void
  /** Android's: iOS knows from its own app state. */
  setInFront?: (inFront: boolean) => void
}>('SessionPush')

let open: string | null = null
let inFront = AppState.currentState === 'active'

/** What the push handler is told: a conversation only while the app is in front. */
function tell(): void {
  SessionPush?.setInFront?.(inFront)
  SessionPush?.setOpenConversation(inFront ? open : null)
}

AppState.addEventListener('change', (state) => {
  inFront = state === 'active'
  tell()
})

/**
 * Tells the native push handler which conversation is on screen, which libsession then gives no
 * notification. Null for none.
 */
export function reportOpenConversation(id: string | null): void {
  open = id
  tell()
}

/** Whether `id` is the conversation on screen with the app in front. */
export function onScreen(id: string | undefined): boolean {
  return inFront && id !== undefined && id === open
}
