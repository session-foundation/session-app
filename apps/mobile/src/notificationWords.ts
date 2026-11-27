import type { SessionClient } from '@session/client'
import { subscribeLocale, tr } from '@session/localization'

/**
 * The bridge's word for a mention of the person, in their language, for the notifications it
 * decides while the app runs. Nothing native to hand words to on iOS yet: the notification
 * extension arrives with APNs.
 */
export function followNotificationWords(client: Pick<SessionClient, 'setNotificationYou'>): void {
  const save = () => {
    void client.setNotificationYou(tr('you'))
  }
  save()
  subscribeLocale(save)
}
