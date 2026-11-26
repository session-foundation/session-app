import { requirePorts } from '@session/app'
import { PENDING_COPY, tr } from '@session/localization'
import { useNotificationSettings, useSessionActions, type NotificationSwitch } from '@session/state'
import { useModals } from '@session/ui'
import { deliveryModeTitle, deliveryOffers } from '../../deliveryModes'

import { NotificationContentChoice } from './ContentChoice'
import { DesktopNotificationsContent } from './DesktopNotificationsContent'
import { MessageDeliveryContent } from './MessageDeliveryContent'
import { MobileNotificationsContent } from './MobileNotificationsContent'
import { NotificationSoundChoice } from './SoundChoice'
import { previewSample, DEFAULT_SOUND, effectiveDeliveryMode } from './choices'
import { useOsState } from './useOsState'

/** The Message delivery child screen. */
function MessageDeliveryPage() {
  const notifications = requirePorts().notifications
  const actions = useSessionActions()
  const deliveryMode = effectiveDeliveryMode(useNotificationSettings().deliveryMode)
  const os = useOsState(notifications)
  return (
    <MessageDeliveryContent
      offers={deliveryOffers(notifications)}
      pushService={notifications.pushService}
      selected={deliveryMode}
      backgroundAllowed={os.backgroundAllowed}
      backgroundRefreshOn={os.backgroundRefreshOn}
      onSelect={(mode) => void actions.setDeliveryMode(mode)}
      onBackgroundActivity={() => notifications.backgroundActivity?.change()}
      onOpenSettings={() => notifications.openSettings?.()}
    />
  )
}

/** The phones' Notification Content child screen: the choice is saved as it is picked. */
function NotificationContentPage() {
  const preview = requirePorts().notifications.preview
  const actions = useSessionActions()
  const { notificationContent } = useNotificationSettings()
  const selected = notificationContent ?? 'nameAndContent'
  return (
    <NotificationContentChoice
      selected={selected}
      canPreview={preview !== null}
      onSelect={(content) => void actions.setNotificationContent(content)}
      onPreview={() => void preview?.(previewSample(selected))}
    />
  )
}

/** iOS's Sound child screen: the choice is saved as it is picked, and played. */
function NotificationSoundPage() {
  const playSound = requirePorts().notifications.playSound
  const actions = useSessionActions()
  const { notificationSound } = useNotificationSettings()
  return (
    <NotificationSoundChoice
      selected={notificationSound ?? DEFAULT_SOUND}
      onSelect={(sound) => {
        playSound?.(sound)
        void actions.setNotificationSound(sound)
      }}
    />
  )
}

/**
 * Notifications: how messages reach the device and what notifications show. A child screen; the
 * settings modal supplies the chrome. The phones and tablets choose a delivery mode; desktop keeps
 * running and has legacy desktop's switches instead.
 */
export function NotificationsPage() {
  const notifications = requirePorts().notifications
  const actions = useSessionActions()
  const modals = useModals()
  const settings = useNotificationSettings()
  const os = useOsState(notifications)
  const content = settings.notificationContent ?? 'nameAndContent'
  const deliveryMode = effectiveDeliveryMode(settings.deliveryMode)
  const preview = notifications.preview
  const onPreview = () => void preview?.(previewSample(content))
  const setSwitch = (name: NotificationSwitch, on: boolean) =>
    void actions.setNotificationSwitch(name, on)

  if (!notifications.notificationModesApply) {
    return (
      <DesktopNotificationsContent
        shown={settings.notificationsShown ?? true}
        content={content}
        audio={settings.audioNotifications ?? false}
        canPreview={preview !== null}
        onShown={(on) => setSwitch('notificationsShown', on)}
        onContent={(next) => void actions.setNotificationContent(next)}
        onAudio={(on) => setSwitch('audioNotifications', on)}
        onPreview={onPreview}
      />
    )
  }
  return (
    <MobileNotificationsContent
      deliveryTitle={deliveryModeTitle(deliveryMode, notifications.pushService)}
      content={content}
      sound={
        notifications.playSound === null ? null : (settings.notificationSound ?? DEFAULT_SOUND)
      }
      soundWhenOpen={settings.soundWhenOpen ?? notifications.soundWhenOpenDefault}
      notificationsAllowed={os.notificationsAllowed}
      channels={notifications.openChannelSettings !== null}
      canOpenSettings={notifications.openSettings !== null}
      onDelivery={() => {
        modals.push({ title: PENDING_COPY.messageDelivery, render: () => <MessageDeliveryPage /> })
      }}
      onContent={() => {
        modals.push({
          title: tr('notificationsContent'),
          render: () => <NotificationContentPage />,
        })
      }}
      onSound={() => {
        modals.push({ title: tr('notificationsSound'), render: () => <NotificationSoundPage /> })
      }}
      onSoundWhenOpen={(on) => setSwitch('soundWhenOpen', on)}
      onChannel={(channel) => notifications.openChannelSettings?.(channel)}
      onOpenSettings={() => notifications.openSettings?.()}
    />
  )
}
