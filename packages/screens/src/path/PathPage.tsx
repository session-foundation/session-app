import { URLS } from '@session/app'
import { PENDING_COPY, tr } from '@session/localization'
import { useConversations, useSessionActions } from '@session/state'
import { ELEMENT } from '@session/test-ids'
import {
  LABEL_MAX_SCALE,
  PathFlow,
  pathFlowTripMs,
  SettingsGroup,
  SettingsRow,
  Text,
  useModals,
  YStack,
  type PathFlowPacket,
  type PathFlowPath,
} from '@session/ui'
import { useEffect, useRef, useState } from 'react'

import {
  ANY_DESTINATION,
  EMPTY_TRACKER,
  expectedPathCount,
  hopMsFor,
  inUse,
  pathStats,
  trackSnapshot,
  type PathKind,
  type PathTracker,
} from './pathActivity'
import { PathStatsCard } from './PathStatsCard'
import { confirmLink } from '../settings/confirmLink'

/**
 * The legacy clients' "Learn More". libsession's URL table has the FAQ but not this anchor in it.
 * TODO: take it from URLS once libsession's link list carries the onion-routing anchor.
 */
const LEARN_MORE_URL = `${URLS.faq}/#onion-routing`

/** How often the screen asks for a fresh snapshot while it is showing. */
const POLL_MS = 1_000

/**
 * Anything that set off this long ago is home, however slow its path: longer than a path can wait
 * to be drawn (a layout, at most every 30 s) plus the slowest trip, since a request waits with it.
 */
const PACKET_LIFE_MS = 60_000

/** What each colour of path is for, worded on each render so a language change reaches it. */
function kindLabels(): Record<PathKind, string> {
  return {
    swarm: PENDING_COPY.onionRoutingPathYourMessages,
    node: PENDING_COPY.onionRoutingPathContactsGroups,
    community: tr('conversationsCommunities'),
    file: PENDING_COPY.onionRoutingPathFileServer,
  }
}

/**
 * A bar's label: the country's code on every platform, which fits every column at every width, and
 * the file server by name. An unknown country is its `?`; an onion request's destination, which
 * each request names for itself, has none.
 */
function labelFor(country: string): string {
  if (country === ANY_DESTINATION) return ''
  return country === 'FS' ? PENDING_COPY.onionRoutingPathFileServer : country
}

/**
 * Every path the client is using, drawn as a country flow: from you through the country of each
 * relay to the destination, with each request travelling its path and back at a speed taken from
 * that path's measured round trip, and the router's pings as fainter traffic between them. A child
 * screen; the settings modal supplies the chrome.
 *
 * Polls libsession once a second while open, and not at all otherwise.
 */
export function PathPage() {
  const actions = useSessionActions()
  const conversations = useConversations()
  const modals = useModals()
  const [tracker, setTracker] = useState<PathTracker>(EMPTY_TRACKER)
  const [packets, setPackets] = useState<PathFlowPacket[]>([])
  const [nowMs, setNowMs] = useState(() => Date.now())
  const trackerRef = useRef(tracker)

  useEffect(() => {
    let live = true
    const poll = async () => {
      const snapshot = await actions.getNetworkPaths().catch(() => null)
      if (!live || snapshot === null) return
      const now = Date.now()
      const { tracker: next, requests } = trackSnapshot(trackerRef.current, snapshot, now, POLL_MS)
      trackerRef.current = next
      setTracker(next)
      setNowMs(now)
      if (requests.length > 0) {
        const latency = new Map(next.paths.map((p) => [p.key, p.latencyMs]))
        setPackets((was) => [
          ...was.filter((p) => now - p.startMs < PACKET_LIFE_MS),
          ...requests.map((r) => ({
            id: r.id,
            pathKey: r.pathKey,
            startMs: r.atMs,
            hopMs: hopMsFor(latency.get(r.pathKey) ?? 0),
            quiet: r.kind === 'ping',
          })),
        ])
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), POLL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [actions])

  const used = inUse(tracker, nowMs)
  const kinds = new Map(used.map((p) => [p.key, p.kind]))
  // A ping says only that a path is alive, so it never lights one.
  const busy = new Set(
    packets
      .filter((p) => {
        const kind = kinds.get(p.pathKey)
        return (
          p.quiet !== true &&
          kind !== undefined &&
          nowMs - p.startMs < pathFlowTripMs(p.hopMs, kind, true)
        )
      })
      .map((p) => p.pathKey),
  )
  const flowPaths: PathFlowPath[] = used.map((p) => ({
    key: p.key,
    kind: p.kind,
    countries: p.countries,
    standby: p.standby,
    lit: busy.has(p.key),
  }))
  const stats = pathStats(tracker, nowMs)

  return (
    <YStack padding="$md" gap="$lg" testID={ELEMENT.settings.pathScreen}>
      <Text size="$body" tone="secondary">
        {PENDING_COPY.onionRoutingPathIntro}
      </Text>
      {/* Not drawn until the first snapshot is in, a moment after opening, which already holds
          every path in use: the card opens at its height rather than growing into it. */}
      {tracker.lastPollMs === null ? null : (
        <YStack gap="$xs">
          <PathFlow
            paths={flowPaths}
            countryOrder={tracker.countryOrder}
            packets={packets.filter((p) => kinds.has(p.pathKey))}
            onionLayers
            columnTitles={[
              tr('you'),
              PENDING_COPY.onionRoutingPathEntry,
              PENDING_COPY.onionRoutingPathRelay,
              PENDING_COPY.onionRoutingPathRelay,
              tr('onionRoutingPathDestination'),
            ]}
            labelFor={labelFor}
            kindLabels={kindLabels()}
            buildingLabel={PENDING_COPY.onionRoutingPathBuilding}
            expectedPaths={expectedPathCount(conversations)}
            testID={ELEMENT.settings.pathFlow}
          />
          <PathStatsCard stats={stats} />
        </YStack>
      )}
      <SettingsGroup>
        <SettingsRow
          label={tr('learnMore')}
          leadsTo="outside"
          onPress={() => confirmLink(modals, LEARN_MORE_URL)}
          testID={ELEMENT.settings.pathLearnMore}
        />
      </SettingsGroup>
      {tracker.attribution.length === 0 ? null : (
        <Text
          size="$caption"
          tone="secondary"
          textAlign="center"
          maxFontSizeMultiplier={LABEL_MAX_SCALE}
        >
          {tracker.attribution}
        </Text>
      )}
    </YStack>
  )
}
