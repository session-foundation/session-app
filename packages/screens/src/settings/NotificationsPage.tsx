import {
  requirePorts,
  type DeliveryModeOffer,
  type NotificationChannel,
  type NotificationsPort,
} from '@session/app'
import { PENDING_COPY, singular, tr } from '@session/localization'
import {
  useNotificationSettings,
  useSessionActions,
  type DeliveryMode,
  type NotificationSwitch,
} from '@session/state'
import type { NotificationContent, NotificationSound } from '@session/client'
import { ELEMENT } from '@session/test-ids'
import {
  RadioIndicator,
  SettingsGroup,
  SettingsNote,
  SettingsRow,
  SettingsSection,
  Switch,
  useModals,
  YStack,
} from '@session/ui'
import { useEffect, useState } from 'react'

import { deliveryModeDescription, deliveryModeTitle, deliveryOffers } from '../deliveryModes'

const CONTENT_CHOICES: readonly NotificationContent[] = ['nameAndContent', 'nameOnly', 'none']

function contentLabel(content: NotificationContent): string {
  switch (content) {
    case 'nameAndContent':
      return tr('notificationsContentShowNameAndContent')
    case 'nameOnly':
      return tr('notificationsContentShowNameOnly')
    case 'none':
      return tr('notificationsContentShowNoNameOrContent')
  }
}

/** Desktop's longer wording for each choice, as legacy desktop shows under its radios. */
function contentDescription(content: NotificationContent): string {
  switch (content) {
    case 'nameAndContent':
      return tr('notificationSenderNameAndPreview')
    case 'nameOnly':
      return tr('notificationSenderNameOnly')
    case 'none':
      return tr('notificationsGenericOnly')
  }
}

/**
 * What Preview Notification posts: what a message notification shows with `content`, as the push
 * handler would draw it.
 */
export function previewSample(content: NotificationContent): { title: string; body: string } {
  const generic = singular('messageNewYouveGot')
  if (content === 'none') return { title: tr('appName'), body: generic }
  if (content === 'nameOnly') return { title: tr('preview'), body: generic }
  return { title: tr('preview'), body: PENDING_COPY.previewNotificationBody }
}

/** In legacy iOS's order: no sound, then the default, then the rest by name. */
const NOTIFICATION_SOUNDS: readonly NotificationSound[] = [
  'none',
  'note',
  'aurora',
  'bamboo',
  'chord',
  'circles',
  'complete',
  'hello',
  'input',
  'keys',
  'popcorn',
  'pulse',
  'synth',
]

const DEFAULT_SOUND: NotificationSound = 'note'

function soundName(sound: NotificationSound): string {
  return sound === 'none' ? tr('none') : PENDING_COPY.notificationSoundNames[sound]
}

/**
 * The mode in effect: Only while open until one is chosen, since without a choice nothing is
 * subscribed and nothing runs in the background.
 */
function effectiveDeliveryMode(chosen: DeliveryMode | null): DeliveryMode {
  return chosen ?? 'while-open'
}

/** The background modes Android can pause to save battery, which the exemption is for. */
function needsBackgroundActivity(mode: DeliveryMode | null): boolean {
  return mode === 'always-connected' || mode === 'periodic'
}

/** OS state the page shows, read when it opens and again whenever the app comes back. */
interface OsState {
  notificationsAllowed: boolean | null
  backgroundAllowed: boolean | null
  backgroundRefreshOn: boolean | null
}

function useOsState(notifications: NotificationsPort): OsState {
  const [state, setState] = useState<OsState>({
    notificationsAllowed: null,
    backgroundAllowed: null,
    backgroundRefreshOn: null,
  })
  useEffect(() => {
    let live = true
    const read = async () => {
      const [allowed, background, refresh] = await Promise.all([
        notifications.notificationsAllowed?.() ?? null,
        notifications.backgroundActivity?.allowed() ?? null,
        notifications.backgroundRefreshOn?.() ?? null,
      ])
      if (live) {
        setState({
          notificationsAllowed: allowed,
          backgroundAllowed: background,
          backgroundRefreshOn: refresh,
        })
      }
    }
    void read()
    // Back from the OS's settings, which is where each of these is changed.
    const stop = requirePorts().window.onFocusChange((focused) => {
      if (focused) void read()
    })
    return () => {
      live = false
      stop()
    }
  }, [notifications])
  return state
}

/** The three content choices as radio rows; with `describe`, each with desktop's longer line. */
function ContentChoices({
  selected,
  describe = false,
  onSelect,
}: {
  selected: NotificationContent
  describe?: boolean
  onSelect: (content: NotificationContent) => void
}) {
  return (
    <SettingsGroup>
      {CONTENT_CHOICES.map((choice) => (
        <SettingsRow
          key={choice}
          label={contentLabel(choice)}
          {...(describe ? { subtitle: contentDescription(choice) } : {})}
          trailing={<RadioIndicator selected={choice === selected} />}
          onPress={() => onSelect(choice)}
          testID={ELEMENT.notificationSettings.contentOption(choice)}
        />
      ))}
    </SettingsGroup>
  )
}

/** Preview Notification, beside the content choices: what it shows is what they choose. */
function PreviewGroup({ onPreview }: { onPreview: () => void }) {
  return (
    <SettingsGroup>
      <SettingsRow
        label={tr('previewNotification')}
        onPress={onPreview}
        testID={ELEMENT.notificationSettings.preview}
      />
    </SettingsGroup>
  )
}

export interface NotificationContentChoiceProps {
  selected: NotificationContent
  canPreview: boolean
  onSelect: (content: NotificationContent) => void
  onPreview: () => void
}

/** The phones' Notification Content child screen, as drawn. */
export function NotificationContentChoice(props: NotificationContentChoiceProps) {
  return (
    <YStack padding="$md" gap="$lg">
      <ContentChoices selected={props.selected} onSelect={props.onSelect} />
      {props.canPreview ? <PreviewGroup onPreview={props.onPreview} /> : null}
    </YStack>
  )
}

export interface NotificationSoundChoiceProps {
  selected: NotificationSound
  onSelect: (sound: NotificationSound) => void
}

/** iOS's Sound child screen, as drawn: the sounds as radio rows, the default marked. */
export function NotificationSoundChoice(props: NotificationSoundChoiceProps) {
  return (
    <YStack padding="$md" gap="$lg" testID={ELEMENT.notificationSettings.soundScreen}>
      <SettingsGroup>
        {NOTIFICATION_SOUNDS.map((sound) => (
          <SettingsRow
            key={sound}
            label={soundName(sound)}
            {...(sound === DEFAULT_SOUND ? { subtitle: tr('theDefault') } : {})}
            trailing={<RadioIndicator selected={sound === props.selected} />}
            onPress={() => props.onSelect(sound)}
            testID={ELEMENT.notificationSettings.soundOption(sound)}
          />
        ))}
      </SettingsGroup>
    </YStack>
  )
}

export interface MobileNotificationsContentProps {
  /** The mode in effect, named: Only while open until one is chosen, since nothing else runs. */
  deliveryTitle: string
  content: NotificationContent
  /** The sound notifications play; null where it is not chosen in the app, which hides the row. */
  sound: NotificationSound | null
  soundWhenOpen: boolean
  /** False shows the warning; null when the OS cannot be asked. */
  notificationsAllowed: boolean | null
  channels: boolean
  canOpenSettings: boolean
  onDelivery: () => void
  onContent: () => void
  onSound: () => void
  onSoundWhenOpen: (on: boolean) => void
  onChannel: (channel: NotificationChannel) => void
  onOpenSettings: () => void
}

/** The phones' and tablets' Notifications page, as drawn. */
export function MobileNotificationsContent(props: MobileNotificationsContentProps) {
  return (
    <YStack padding="$md" gap="$lg" testID={ELEMENT.notificationSettings.screen}>
      {props.notificationsAllowed === false ? (
        <SettingsGroup>
          <SettingsNote
            text={PENDING_COPY.notificationsOffForSession}
            testID={ELEMENT.notificationSettings.permissionWarning}
          />
          {props.canOpenSettings ? (
            <SettingsRow
              label={tr('notificationsGoToDevice')}
              leadsTo="outside"
              onPress={props.onOpenSettings}
              testID={ELEMENT.notificationSettings.deviceSettings}
            />
          ) : null}
        </SettingsGroup>
      ) : null}
      <SettingsGroup>
        <SettingsRow
          label={PENDING_COPY.messageDelivery}
          subtitle={props.deliveryTitle}
          leadsTo="screen"
          onPress={props.onDelivery}
          testID={ELEMENT.notificationSettings.deliveryRow}
        />
      </SettingsGroup>
      <SettingsGroup>
        <SettingsRow
          label={tr('notificationsContent')}
          subtitle={contentLabel(props.content)}
          leadsTo="screen"
          onPress={props.onContent}
          testID={ELEMENT.notificationSettings.contentRow}
        />
        {props.sound === null ? null : (
          <SettingsRow
            label={tr('notificationsSound')}
            subtitle={soundName(props.sound)}
            leadsTo="screen"
            onPress={props.onSound}
            testID={ELEMENT.notificationSettings.soundRow}
          />
        )}
        <SettingsRow
          label={tr('notificationsSoundDescription')}
          trailing={
            <Switch
              value={props.soundWhenOpen}
              onValueChange={props.onSoundWhenOpen}
              accessibilityLabel={tr('notificationsSoundDescription')}
              testID={ELEMENT.notificationSettings.soundWhenOpen}
            />
          }
          testID={ELEMENT.notificationSettings.soundWhenOpen}
        />
      </SettingsGroup>
      {props.channels ? (
        <SettingsGroup>
          <SettingsRow
            label={tr('messages')}
            subtitle={tr('deviceSettingsConversationNotifications')}
            leadsTo="outside"
            onPress={() => props.onChannel('messages')}
            testID={ELEMENT.notificationSettings.channel('messages')}
          />
          <SettingsRow
            label={tr('sessionMessageRequests')}
            subtitle={PENDING_COPY.deviceSettingsMessageRequestNotifications}
            leadsTo="outside"
            onPress={() => props.onChannel('requests')}
            testID={ELEMENT.notificationSettings.channel('requests')}
          />
          {/* Shown disabled until calls exist, so the list keeps its order. */}
          <SettingsRow
            label={tr('callsSettings')}
            subtitle={tr('deviceSettingsCallNotifications')}
            leadsTo="outside"
            disabled
            testID={ELEMENT.notificationSettings.channel('calls')}
          />
        </SettingsGroup>
      ) : null}
      {props.canOpenSettings && props.notificationsAllowed !== false ? (
        <SettingsGroup>
          <SettingsRow
            label={tr('notificationsGoToDevice')}
            leadsTo="outside"
            onPress={props.onOpenSettings}
            testID={ELEMENT.notificationSettings.deviceSettings}
          />
        </SettingsGroup>
      ) : null}
    </YStack>
  )
}

export interface DesktopNotificationsContentProps {
  shown: boolean
  content: NotificationContent
  audio: boolean
  canPreview: boolean
  onShown: (on: boolean) => void
  onContent: (content: NotificationContent) => void
  onAudio: (on: boolean) => void
  onPreview: () => void
}

/**
 * Desktop's Notifications page, as legacy desktop has it: whether to show notifications at all,
 * what they show, and their sound. It keeps running, so there is no delivery to choose.
 */
export function DesktopNotificationsContent(props: DesktopNotificationsContentProps) {
  return (
    <YStack padding="$md" gap="$lg" testID={ELEMENT.notificationSettings.screen}>
      <SettingsGroup>
        <SettingsRow
          label={tr('sessionNotifications')}
          subtitle={tr('enableNotifications')}
          trailing={
            <Switch
              value={props.shown}
              onValueChange={props.onShown}
              accessibilityLabel={tr('sessionNotifications')}
              testID={ELEMENT.notificationSettings.shown}
            />
          }
          testID={ELEMENT.notificationSettings.shown}
        />
      </SettingsGroup>
      {/* Everything else is about notifications that are shown, so goes with them. */}
      {props.shown ? (
        <>
          <YStack>
            <SettingsSection label={tr('notificationDisplay')} />
            <YStack gap="$lg">
              <ContentChoices selected={props.content} describe onSelect={props.onContent} />
              {props.canPreview ? <PreviewGroup onPreview={props.onPreview} /> : null}
            </YStack>
          </YStack>
          <SettingsGroup>
            <SettingsRow
              label={tr('notificationsSoundDesktop')}
              subtitle={tr('notificationsMakeSound')}
              trailing={
                <Switch
                  value={props.audio}
                  onValueChange={props.onAudio}
                  accessibilityLabel={tr('notificationsSoundDesktop')}
                  testID={ELEMENT.notificationSettings.audio}
                />
              }
              testID={ELEMENT.notificationSettings.audio}
            />
          </SettingsGroup>
        </>
      ) : null}
    </YStack>
  )
}

export interface MessageDeliveryContentProps {
  offers: readonly DeliveryModeOffer[]
  pushService: NotificationsPort['pushService']
  selected: DeliveryMode | null
  /** Android's battery exemption: null where the platform has none. */
  backgroundAllowed: boolean | null
  /** iOS's Background App Refresh: null where the platform has none or cannot say. */
  backgroundRefreshOn: boolean | null
  onSelect: (mode: DeliveryMode) => void
  onBackgroundActivity: () => void
  onOpenSettings: () => void
}

/** The Message delivery child screen, as drawn: one choice, each saying all it does. */
export function MessageDeliveryContent(props: MessageDeliveryContentProps) {
  const refreshWarning =
    props.backgroundRefreshOn === false &&
    (props.selected === 'instant' || props.selected === 'periodic')
      ? props.selected === 'instant'
        ? PENDING_COPY.backgroundRefreshOffInstant
        : PENDING_COPY.backgroundRefreshOffPeriodic
      : null
  return (
    <YStack padding="$md" gap="$lg" testID={ELEMENT.notificationSettings.deliveryScreen}>
      <SettingsGroup>
        {props.offers.map((offer) => {
          const usable = offer.unavailable === null
          const description = deliveryModeDescription(offer, props.pushService)
          return (
            <SettingsRow
              key={offer.mode}
              label={deliveryModeTitle(offer.mode, props.pushService)}
              subtitle={description}
              note={
                offer.mode === 'instant' && usable
                  ? PENDING_COPY.deliveryInstantCommunities
                  : undefined
              }
              trailing={
                <RadioIndicator selected={offer.mode === props.selected} disabled={!usable} />
              }
              disabled={!usable}
              onPress={() => props.onSelect(offer.mode)}
              testID={ELEMENT.notificationSettings.deliveryOption(offer.mode)}
            />
          )
        })}
      </SettingsGroup>
      {props.backgroundAllowed !== null && needsBackgroundActivity(props.selected) ? (
        <SettingsGroup>
          <SettingsRow
            label={tr('runAppBackground')}
            subtitle={PENDING_COPY.backgroundActivityDescription}
            trailing={
              <Switch
                value={props.backgroundAllowed}
                // Android decides, in its own dialog or its list; the switch follows when the app
                // comes back.
                onValueChange={props.onBackgroundActivity}
                accessibilityLabel={tr('runAppBackground')}
                testID={ELEMENT.notificationSettings.backgroundActivity}
              />
            }
            testID={ELEMENT.notificationSettings.backgroundActivity}
          />
        </SettingsGroup>
      ) : null}
      {refreshWarning === null ? null : (
        <SettingsGroup>
          <SettingsNote
            text={refreshWarning}
            testID={ELEMENT.notificationSettings.backgroundRefreshWarning}
          />
          {/* Background App Refresh is on the app's page in Settings, not under notifications. */}
          <SettingsRow
            label={tr('openSettings')}
            leadsTo="outside"
            onPress={props.onOpenSettings}
            testID={ELEMENT.notificationSettings.deviceSettings}
          />
        </SettingsGroup>
      )}
    </YStack>
  )
}

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
