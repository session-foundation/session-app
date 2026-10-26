import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import { flag, useCamera } from '@session/app'
import {
  Button,
  Icon,
  InputField,
  type InputFieldHandle,
  RecoveryPasswordMark,
  SlidePager,
  TopTabs,
  useFontScale,
  useMedia,
  XStack,
  YStack,
} from '@session/ui'
import { useRef, useState, type RefObject } from 'react'

import { WideBackButton } from './OnboardingBackButton'
import { OnboardingChrome, useStepPadding } from './OnboardingChrome'
import { OnboardingStepBody } from './OnboardingStep'
import { ScanQrPane } from './ScanQrPane'
import { phraseIsTooShort, phraseWords } from './recoveryPhrase'
import type { RecoveryInput } from './flow'

/** Room reserved inside the field for the reveal toggle. The desktop client reserves 48. */
const TOGGLE_WIDTH = 48

interface LoadAccountScreenProps {
  onBack: () => void
  /** Refuses back while the phrase is being checked, which cannot be called off. */
  backDisabled?: boolean
  onContinue: (from: RecoveryInput) => void
  /** Whether the bridge refused the last phrase. */
  rejected?: boolean
  busy?: boolean
}

/** The shield beside the title, at the client's own size rather than a rung. */
const TITLE_MARK_SIZE = 22

/**
 * Entering a recovery phrase.
 *
 * **Concealed by default, with a reveal toggle**, as the desktop client has it: a phrase is the
 * whole account in thirteen words and this screen is often reached with other people in the room,
 * but it is also the one field where a typo is invisible and fatal.
 *
 * Same error behaviour as the name field, which is `InputField`'s rather than either screen's.
 *
 * **The QR tab is here only where something can scan.** The mobile clients offer two ways into a
 * restore; a build with no camera port has one, and a tab bar of one tab offering a camera that
 * cannot exist is a worse answer than no tab. Gated on the port rather than on the width, because
 * a tablet is wide and has a camera -- the two questions are different and reading one off the
 * other is what put a scanner on a desktop.
 *
 * The other half of this exchange is a client *showing* a recovery QR for another device to read,
 * which is what the desktop client does. A desktop that scans is the wrong end of it.
 */
export function LoadAccountScreen({
  onBack,
  backDisabled = false,
  onContinue,
  rejected = false,
  busy = false,
}: LoadAccountScreenProps) {
  // Null where no platform put a camera in the tree, which is the desktop app today.
  const scanning = useCamera() !== null
  const wide = useMedia().gtSm
  const fontScale = useFontScale()
  // Above the default text size the wide column scrolls rather than holding a fixed height (see
  // `WideChrome`), so it has no height for the camera preview to fill.
  const fitsPage = wide && fontScale > 1
  const [tab, setTab] = useState<'phrase' | 'qr'>('phrase')
  const [phrase, setPhrase] = useState('')
  const [revealed, setRevealed] = useState(false)
  const field = useRef<InputFieldHandle>(null)

  const cut = flag('disableAnimations')
  // The chrome is not padding this step, so the pane does -- with the chrome's own figures.
  const stepPadding = useStepPadding()

  // Named rather than written twice: with a camera it is the first page of a pager, without one it
  // is the content, and two copies would drift.
  const phrasePane = (
    <PhrasePane
      padding={stepPadding}
      // Beside a camera the back control sits beside the pager (see below), so the pane draws none
      // of its own: one hanging off a page would show when the page is swiped past its edge.
      onBack={scanning ? undefined : onBack}
      backDisabled={backDisabled}
      busy={busy}
      rejected={rejected}
      phrase={phrase}
      onPhraseChange={setPhrase}
      revealed={revealed}
      onToggleReveal={() => {
        setRevealed((shown) => !shown)
      }}
      field={field}
      onContinue={onContinue}
    />
  )

  return (
    <OnboardingChrome
      backDisabled={backDisabled}
      testID={ELEMENT.onboarding.loadAccountScreen}
      onBack={onBack}
      barTitle={tr('loadAccount')}
      padContent={false}
      banner={
        scanning ? (
          <TopTabs
            active={tab}
            instant={cut}
            onChange={(next) => {
              setTab(next === 'qr' ? 'qr' : 'phrase')
            }}
            tabs={[
              {
                key: 'phrase',
                label: tr('sessionRecoveryPassword'),
                testID: ELEMENT.onboarding.recoveryPhraseTab,
              },
              { key: 'qr', label: tr('qrScan'), testID: ELEMENT.onboarding.scanQrTab },
            ]}
          />
        ) : undefined
      }
    >
      {scanning ? (
        /* Stretching, deliberately: the pager takes the row's height, and `alignItems="flex-start"`
           would collapse it. The back control keeps its own height and so does not stretch with
           it. */
        <XStack flex={1}>
          {/* **The back control sits beside the pager, not inside a pane.** The pager has to clip
              -- a page at rest is one column-width to the side, which on a tablet is still on
              screen -- and this control hangs off the column's leading edge, so inside it would
              be clipped away. Beside it, it is also the same control on both tabs, which is what
              switching a tab means: a tab is not a screen, so each one owning its own back would
              be wrong.

              On a phone the chrome's bar draws it, so this is the wide design's only. */}
          {wide ? <WideBackButton onPress={onBack} disabled={backDisabled} /> : null}
          {/* One chrome and two panes rather than two screens: the bar, the title and the tabs
              stay put and only what is under them slides, which is what makes the indicator and
              the pane read as one movement. */}
          <SlidePager
            index={tab === 'qr' ? 1 : 0}
            onIndexChange={(page) => {
              setTab(page === 1 ? 'qr' : 'phrase')
            }}
            instant={cut}
            clip={wide}
          >
            {phrasePane}
            <ScanQrPane
              showing={tab === 'qr'}
              fitsPage={fitsPage}
              onScan={(value) => {
                // Handed over as it was read. Whether it decodes to a seed is libsession's to say,
                // and its refusal comes back the same way a typed phrase's does.
                onContinue({ hexSeed: value })
              }}
              error={rejected ? tr('qrNotRecoveryPassword') : null}
            />
          </SlidePager>
        </XStack>
      ) : (
        phrasePane
      )}
    </OnboardingChrome>
  )
}

interface PhrasePaneProps {
  /** The chrome's own step padding, which this pane applies because the chrome is told not to. */
  padding: ReturnType<typeof useStepPadding>
  /** The wide design's back control, drawn by the pane only where nothing else draws one. */
  onBack?: (() => void) | undefined
  backDisabled: boolean
  busy: boolean
  rejected: boolean
  phrase: string
  onPhraseChange: (next: string) => void
  revealed: boolean
  onToggleReveal: () => void
  field: RefObject<InputFieldHandle | null>
  onContinue: (from: RecoveryInput) => void
}

/**
 * The field, which is the whole screen where nothing can scan.
 *
 * It insets itself, which is why the chrome is told not to: beside a camera the two panes
 * disagree, since the field belongs in the reading column and the camera fills the width.
 *
 * **Its state is the screen's, not its own.** A pager may unmount the page it is not showing, and a
 * phrase half-typed before a look at the QR tab has to still be there on the way back.
 */
function PhrasePane({
  padding,
  onBack,
  backDisabled,
  busy,
  rejected,
  phrase,
  onPhraseChange,
  revealed,
  onToggleReveal,
  field,
  onContinue,
}: PhrasePaneProps) {
  return (
    <YStack flex={1} {...padding}>
      <OnboardingStepBody
        title={tr('sessionRecoveryPassword')}
        titleMark={<RecoveryPasswordMark size={TITLE_MARK_SIZE} color="$textPrimary" />}
        description={tr('recoveryPasswordRestoreDescription')}
        onBack={onBack}
        backDisabled={backDisabled}
        footer={
          <Button
            // Outlined in the accent, like the landing screen's second button: the legacy
            // clients draw every onboarding Continue that way, stroke and label in the primary
            // colour.
            variant="outlineAccent"
            testID={ELEMENT.onboarding.continueButton}
            loading={busy}
            disabled={phrase.trim().length === 0}
            // Through the field, so the button refuses what the keyboard would refuse.
            onPress={() => field.current?.submit()}
          >
            {tr('theContinue')}
          </Button>
        }
      >
        <InputField
          ref={field}
          value={phrase}
          onChangeText={onPhraseChange}
          // The button is inert while the check runs; the keyboard's own submit is a second
          // way in, and pressing it twice sends the same phrase twice -- the first `finally`
          // then clears `busy` while the second is still running.
          disabled={busy}
          // Checked on submit rather than as it is typed: a phrase is too short for as long as
          // it is half-entered, and saying so on every word is noise.
          validate={(next) =>
            phraseIsTooShort(next) ? tr('recoveryPasswordErrorMessageShort') : null
          }
          // Generic rather than "incorrect": the bridge flattens libsession's several refusals
          // into one message, so this cannot tell which it was.
          error={rejected ? tr('recoveryPasswordErrorMessageGeneric') : null}
          onSubmit={(typed) => {
            onContinue({ words: phraseWords(typed) })
          }}
          reserveErrorSpace
          errorTestID={ELEMENT.onboarding.recoveryPhraseError}
          placeholder={tr('recoveryPasswordEnter')}
          autoCapitalize="none"
          // The phrase is words from a list, so a keyboard treats it as prose and learns it.
          // See `private`.
          private
          autoFocus
          // Concealed until asked for. The toggle is the only way to read it back, which is the
          // point -- a phrase typed blind cannot be checked over.
          secureTextEntry={!revealed}
          testID={ELEMENT.onboarding.recoveryPhraseInput}
          endWidth={TOGGLE_WIDTH}
          // A function, because the toggle turns red with the text around it and whether a
          // message is showing is the field's to know.
          end={(showing) => (
            <Button
              variant="ghost"
              size="xs"
              circular
              accessibilityLabel={revealed ? tr('hide') : tr('show')}
              testID={ELEMENT.onboarding.recoveryPhraseReveal}
              onPress={onToggleReveal}
              icon={
                <Icon
                  name={revealed ? 'eyeOff' : 'eye'}
                  size="lg"
                  color={showing ? '$dangerColor' : '$textSecondary'}
                />
              }
            />
          )}
        />
      </OnboardingStepBody>
    </YStack>
  )
}
