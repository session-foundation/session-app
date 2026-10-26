import { logical, useMedia, usePageZoom, useTokenColor, XStack, YStack } from '@session/ui'
import type { ReactNode } from 'react'

import { PaneProvider } from './pane'
import { DETAIL_PANE, LIST_PANE, SOLE_PANE } from './panes'

/**
 * One list, one detail, and the decision about how many of them fit.
 *
 * This is the only place that decides whether the app is showing one pane or two. Phones
 * and narrow windows get a single pane and lean on the router's back; anything wider keeps
 * the list beside the detail. The routes are identical either way - only what is drawn
 * changes - so a link, a notification tap and the back button all behave the same on every
 * device.
 */
export function AdaptiveShell({
  list,
  detail,
  hasDetail,
  placeholder,
}: {
  list: ReactNode
  detail: ReactNode
  hasDetail: boolean
  placeholder?: ReactNode
}) {
  const media = useMedia()
  const zoom = usePageZoom()
  const rule = useTokenColor('$bordersColor')
  const twoPanes = media.gtSm
  const showsList = twoPanes || !hasDetail
  const showsDetail = twoPanes || hasDetail

  // **One tree for both layouts**, the detail pane always the same element in the same place. A
  // second tree for one pane would remount whatever the detail holds whenever the window crosses
  // the breakpoint -- on mobile that is the router's `Slot`, which forgets the open conversation
  // when it remounts, so turning a tablet would close it. The list pane comes and goes beside it;
  // the detail pane is only hidden, never unmounted.
  return (
    <XStack flex={1} backgroundColor="$backgroundPrimary">
      {showsList ? (
        <YStack
          key="list"
          {...(twoPanes
            ? {
                // The window's, not the content's: divided by the desktop zoom so the list keeps
                // its share of the window however far the content is zoomed.
                width: (media.gtLg ? 380 : 320) / zoom,
                // The rule between the two panes sits on the edge the list ends at, which in
                // Arabic is its left: a physical right keeps the divider on the detail pane's outer
                // edge and leaves the two panes touching.
                ...logical({ borderEndWidth: 1, borderEndColor: rule }),
              }
            : { flex: 1 })}
        >
          <PaneProvider value={twoPanes ? LIST_PANE : SOLE_PANE}>{list}</PaneProvider>
        </YStack>
      ) : null}
      <YStack key="detail" flex={1} display={showsDetail ? 'flex' : 'none'}>
        <PaneProvider value={twoPanes ? DETAIL_PANE : SOLE_PANE}>
          {hasDetail ? detail : placeholder}
        </PaneProvider>
      </YStack>
    </XStack>
  )
}
