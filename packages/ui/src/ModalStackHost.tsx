import { Fragment } from 'react'
import { Modal as NativeModal, Platform } from 'react-native'
import { ScrollView, useMedia, XStack, YStack } from 'tamagui'

import { useBackdropBlur } from './backdropBlur'
import { backChevron } from './backChevron'
import { BarButton } from './BarButton'
import { AlertBox, AlertFrame } from './Modal'
import {
  ACTION_HEIGHT,
  HEADER_HEIGHT,
  PANEL_INSET_RATIO,
  PANEL_RADIUS,
  PANEL_SHADOW_BLUR,
  PANEL_WIDTH,
} from './modalPanelMetrics'
import { useModalEntries, useModals, type OpenModal } from './ModalsProvider'
import { Text } from './Text'
import { LABEL_MAX_SCALE } from './fontScaleCaps'
import { useThemeIsDark } from './UIProvider'
import { useScreenInsets } from './screenInsets'
import { useTokenColor } from './useTokenColor'
import { useWindowSize } from './useWindowSize'

/** The web style that takes a held screen out of focus and the accessibility tree. */
function hiddenUnless(showing: boolean): { visibility: 'visible' | 'hidden' } {
  return { visibility: showing ? 'visible' : 'hidden' }
}

interface ModalStackHostProps {
  /** Names the close control for a screen reader, since it is drawn as a cross. */
  closeLabel: string
  /** Names the back control, which is drawn as a chevron. */
  backLabel: string
  testID?: string
  closeTestID?: string
  backTestID?: string
  /** Which open modals to draw; defaults to all. See `ModalStackRoot.native.tsx`. */
  entries?: readonly OpenModal[]
}

/**
 * Draws whatever `ModalStackProvider` holds, as layers inside one react-native `Modal`. Nested
 * native modals are separate windows on iOS, which animate and dismiss independently of
 * `modalStack.ts`. Mount once, beside the app rather than inside it.
 */
export function ModalStackHost({
  closeLabel,
  backLabel,
  testID,
  closeTestID,
  backTestID,
  entries: only,
}: ModalStackHostProps) {
  const all = useModalEntries()
  const entries = only ?? all
  const modals = useModals()
  const Blur = useBackdropBlur()
  const dark = useThemeIsDark()
  const wide = useMedia().gtSm
  const shadowColor = useTokenColor('$shadow')

  // In pixels, because a percentage padding resolves against the width.
  const { height: windowHeight } = useWindowSize()
  const inset = Math.round(windowHeight * PANEL_INSET_RATIO)
  const panelHeight = windowHeight - 2 * inset

  const top = entries.at(-1)
  const screenInsets = useScreenInsets()
  // Decided by the bottom entry, so an alert with nothing under it fades on every width.
  const slides = !wide && entries[0]?.kind === 'panel'

  return (
    <NativeModal
      visible={entries.length > 0}
      transparent
      animationType={slides ? 'slide' : 'fade'}
      // Escape on the web, the hardware button on Android: one level, per `backAction`.
      onRequestClose={modals.back}
    >
      {Blur === null ? (
        <YStack fullscreen backgroundColor="$scrim" />
      ) : (
        <YStack fullscreen>
          <Blur dark={dark} />
        </YStack>
      )}

      {entries.map((entry, index) => {
        const screen = entry.stack.at(-1)
        const frontmost = entry === top
        const dismiss = entry.dismissible
          ? () => {
              modals.dismiss(entry.id)
            }
          : undefined

        // Each layer above the first dims what it covers. A sibling drawn before the modal, not a
        // child: on the web an absolute child paints over its in-flow siblings, so it would cover
        // the dialog.
        const layerScrim =
          index === 0 ? null : Blur === null ? (
            <YStack fullscreen backgroundColor="$scrim" pointerEvents="none" />
          ) : (
            <YStack fullscreen pointerEvents="none">
              <Blur dark={dark} />
            </YStack>
          )

        // Presses outside land on this layer rather than on a pressable container: on native a
        // pressable container claims drags that start in gaps or on disabled rows, so they do
        // not scroll. The layer above passes outside touches through with `box-none`.
        const backdrop = (
          <YStack
            fullscreen
            pointerEvents={frontmost && dismiss !== undefined ? 'auto' : 'none'}
            {...(dismiss === undefined ? {} : { onPress: dismiss })}
          />
        )

        if (entry.kind === 'alert')
          return (
            <Fragment key={entry.id}>
              {layerScrim}
              {backdrop}
              <AlertFrame pointerEvents={frontmost ? 'box-none' : 'none'}>
                <AlertBox
                  title={screen?.title ?? ''}
                  closeLabel={closeLabel}
                  // Independent of `dismissible`; see `ModalPresentation.showClose`.
                  showClose={entry.showClose}
                  onClose={() => {
                    modals.dismiss(entry.id)
                  }}
                  actions={screen?.footer?.()}
                  testID={entry.testID ?? testID ?? ''}
                  closeTestID={entry.closeTestID ?? closeTestID ?? ''}
                >
                  {screen?.render() ?? null}
                </AlertBox>
              </AlertFrame>
            </Fragment>
          )

        return (
          <Fragment key={entry.id}>
            {layerScrim}
            {backdrop}
            <YStack
              fullscreen
              alignItems="center"
              {...(wide ? { paddingHorizontal: '$lg', paddingTop: inset } : {})}
              // Only the frontmost layer takes presses, or a tap on the top scrim reaches a row
              // underneath. `box-none` passes a touch outside the panel down to the backdrop.
              pointerEvents={frontmost ? 'box-none' : 'none'}
            >
              <YStack
                width="100%"
                {...(wide
                  ? {
                      maxWidth: PANEL_WIDTH[entry.width],
                      // One height for every screen, anchored to the top, so a push does not
                      // move the panel's edges.
                      height: panelHeight,
                      borderRadius: PANEL_RADIUS,
                      borderWidth: 1,
                      borderColor: '$bordersColor',
                      boxShadow: `0px 0px ${String(PANEL_SHADOW_BLUR[dark ? 'dark' : 'light'])}px 0px ${shadowColor}`,
                    }
                  : // Full screen on a narrow window; a height, since a `flex` share depends on
                    // the layer's other children.
                    {
                      height: '100%',
                      paddingTop: screenInsets.top,
                      paddingBottom: screenInsets.bottom,
                    })}
                // The page's own surface, lifted by border and shadow.
                backgroundColor="$backgroundPrimary"
                // Keeps a pressed row's highlight inside the rounded corners.
                overflow="hidden"
                testID={testID}
              >
                <XStack height={HEADER_HEIGHT} alignItems="center" paddingHorizontal="$xs">
                  {/* Both control columns keep their width when empty, so the title stays put
                      as a screen is pushed. */}
                  <YStack width={HEADER_HEIGHT}>
                    {entry.stack.length <= 1 ? (
                      // Narrow: close leads, on the first screen only. Wide: it trails.
                      wide || !entry.dismissible ? null : (
                        <BarButton
                          icon="x"
                          accessibilityLabel={closeLabel}
                          testID={closeTestID}
                          onPress={() => {
                            modals.dismiss(entry.id)
                          }}
                        />
                      )
                    ) : (
                      <BarButton
                        icon={backChevron()}
                        accessibilityLabel={backLabel}
                        testID={backTestID}
                        onPress={modals.back}
                      />
                    )}
                  </YStack>

                  {/* Held to the label cap and one line, since the bar is a fixed height: past it
                      a large system text size cuts the title off at the top. */}
                  <Text
                    flex={1}
                    size="$title"
                    weight="semibold"
                    textAlign="center"
                    userSelect="none"
                    numberOfLines={1}
                    maxFontSizeMultiplier={LABEL_MAX_SCALE}
                  >
                    {screen?.title ?? ''}
                  </Text>

                  <YStack width={HEADER_HEIGHT} alignItems="flex-end">
                    {!wide || !entry.dismissible ? null : (
                      <BarButton
                        icon="x"
                        accessibilityLabel={closeLabel}
                        testID={closeTestID}
                        onPress={() => {
                          modals.dismiss(entry.id)
                        }}
                      />
                    )}
                  </YStack>
                </XStack>

                {/* Every screen stays mounted so back returns to it as it was left (scroll,
                    state); only the frontmost is visible. */}
                {/* `relative`: on the web a stack is `static` by default, so absolute children
                    would resolve against the page. See `containingBlock.contract.test.ts`. */}
                <YStack flex={1} position="relative">
                  {entry.stack.map((held, at) => {
                    const showing = at === entry.stack.length - 1
                    return (
                      <YStack
                        key={held.key}
                        fullscreen
                        opacity={showing ? 1 : 0}
                        pointerEvents={showing ? 'auto' : 'none'}
                        aria-hidden={!showing}
                        // On the web neither of the two above takes a screen out of the Tab order,
                        // so focus would walk the hidden screens behind the top one. `visibility`
                        // does, and keeps the scroll position back returns to, where `display:
                        // none` would lose it. Native has no such property, nor the problem.
                        {...(Platform.OS === 'web' ? { style: hiddenUnless(showing) } : {})}
                      >
                        <ScrollView
                          flex={1}
                          // On the web the modal focuses this scroller on open and the browser
                          // rings the whole body. The style, not the width: `outline-style: auto`
                          // ignores the width. It stays focusable and keyboard-scrollable.
                          focusStyle={{ outlineStyle: 'none' }}
                        >
                          {held.render()}
                        </ScrollView>
                      </YStack>
                    )
                  })}
                </YStack>

                {screen?.footer === undefined ? null : (
                  /* A row is required: the actions take an equal share with `fill`, which
                     collapses to nothing in a column. */
                  <XStack alignItems="stretch" height={ACTION_HEIGHT}>
                    {screen.footer()}
                  </XStack>
                )}
              </YStack>
            </YStack>
          </Fragment>
        )
      })}
    </NativeModal>
  )
}
