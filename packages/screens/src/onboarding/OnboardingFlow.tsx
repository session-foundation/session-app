import { flag, requirePorts } from '@session/app'
import { useAccount, useSessionActions } from '@session/state'
import { StepTransition, useMedia } from '@session/ui'
import { useEffect, useReducer, useRef, useState } from 'react'

import { ConfirmUrlProvider } from './ConfirmUrl'
import { LandingScreen } from './LandingScreen'
import { LoadAccountScreen } from './LoadAccountScreen'
import { LoadingScreen } from './LoadingScreen'
import { MessageNotificationsScreen } from './MessageNotificationsScreen'
import { PickDisplayNameScreen } from './PickDisplayNameScreen'
import {
  backDiscardsAccount,
  backAction,
  backPath,
  committingStep,
  isWideDesign,
  initialOnboarding,
  onboardingReducer,
  type OnboardingDesign,
  type OnboardingEvent,
  type OnboardingState,
  type OnboardingStep,
  type RecoveryInput,
} from './flow'

/**
 * How often the restore wait asks whether the profile has landed.
 *
 * A second is far below anything anybody perceives against a fifteen-second wait, and well above
 * what a local database read costs.
 */
const PROFILE_POLL_MS = 1000

interface OnboardingFlowProps {
  /**
   * Whether onboarding still owns the screen.
   *
   * The apps choose onboarding by asking whether there is an account, which stops being the right
   * question the moment a restore succeeds: the account exists from the instant the phrase is
   * accepted, but the flow still has a profile to wait for and, on a phone, a question to ask.
   * Without this the conversation list swaps in underneath a restore that is still running.
   *
   * True from the first step past the landing screen until everything has been committed.
   */
  onRunningChange?: (running: boolean) => void
}

interface OnboardingScreenProps {
  step: OnboardingStep
  state: OnboardingState
  dispatch: (event: OnboardingEvent) => void
  busy: boolean
  /** Past the last question: the account is being made under the step still on screen. */
  committing: boolean
  rejected: boolean
  profileArrived: boolean
  onBack: () => void
  onAbandonPhrase: () => void
  onSubmitPhrase: (from: RecoveryInput) => void
}

function OnboardingScreen({
  step,
  state,
  dispatch,
  busy,
  committing,
  rejected,
  profileArrived,
  onBack,
  onAbandonPhrase,
  onSubmitPhrase,
}: OnboardingScreenProps) {
  switch (step) {
    case 'landing':
      return (
        <LandingScreen
          onCreate={() => {
            dispatch({ type: 'chooseCreate' })
          }}
          onRestore={() => {
            dispatch({ type: 'chooseRestore' })
          }}
        />
      )

    case 'pickDisplayName':
      return (
        <PickDisplayNameScreen
          afterFailedRestore={state.afterFailedRestore}
          initialName={state.displayName ?? ''}
          rejected={state.commitFailed}
          busy={busy}
          onBack={onBack}
          onContinue={(name) => {
            dispatch({ type: 'nameEntered', name })
          }}
        />
      )

    case 'loadAccount':
      return (
        <LoadAccountScreen
          busy={busy}
          rejected={rejected}
          backDisabled={busy}
          onBack={onAbandonPhrase}
          onContinue={onSubmitPhrase}
        />
      )

    case 'messageNotifications':
      return (
        <MessageNotificationsScreen
          busy={busy}
          onBack={onBack}
          onContinue={(mode) => {
            dispatch({ type: 'notificationsChosen', mode, profileArrived })
          }}
        />
      )

    case 'loading':
      return (
        <LoadingScreen
          onBack={onBack}
          backDisabled={busy}
          onGaveUp={
            // Null once the account is being made: the wait is over, and a deadline still
            // running would announce a timeout on top of a restore that already arrived.
            committing
              ? null
              : () => {
                  dispatch({ type: 'restoreGaveUp' })
                }
          }
        />
      )

    case 'done':
      // Unreachable: `done` renders the step it was reached from. Here because the switch is
      // exhaustive over the step type, which is what makes a new step a compile error.
      return null
  }
}

/**
 * Onboarding, from the first screen to an account.
 *
 * One route and an internal step, rather than a route per screen. Both apps choose onboarding from
 * state rather than by navigating -- until an identity exists this is all the app can show -- and
 * the legacy clients treat back the same way, offering to quit rather than popping a stack.
 *
 * The bridge calls live here and nowhere else, so "when is the account actually made" stays
 * answerable by reading one file. `flow.ts` only decides which screen is next.
 */
export function OnboardingFlow({ onRunningChange }: OnboardingFlowProps = {}) {
  const actions = useSessionActions()
  const design = useOnboardingDesign()
  const [state, dispatch] = useReducer(onboardingReducer, design, initialOnboarding)
  const [busy, setBusy] = useState(false)
  const [rejected, setRejected] = useState(false)
  const account = useAccount()

  /**
   * Going back, with whatever has been minted thrown away first.
   *
   * The account is real by the time the restore branch is past its phrase screen, so backing out
   * of it is not a navigation -- it is a decision to be rid of an account. `discardAccount` deletes
   * the database and opens a fresh one, which is what lets back go back at all rather than offering
   * to quit.
   */
  const goBack = () => {
    if (!backDiscardsAccount(state)) {
      dispatch({ type: 'back' })
      return
    }
    setBusy(true)
    void actions
      .discardAccount()
      .catch(() => {
        // Nothing to tell the person: the screen they are going back to is the one that starts
        // again from nothing, and a discard that failed leaves an account they are about to
        // replace anyway. Logged by the store.
      })
      .finally(() => {
        setBusy(false)
        dispatch({ type: 'back' })
      })
  }

  /** Whether there is a profile on its way at all. Nothing is fetched in the create branch. */
  const restoring = state.branch === 'restore'

  /**
   * Whether the restored profile has landed -- an account with a name on it.
   *
   * The name is the whole test: the account exists from the moment the phrase is accepted, so
   * `haveAccount` says nothing about whether the swarm has answered yet.
   */
  const profileArrived =
    account?.haveAccount === true &&
    account.displayName !== undefined &&
    account.displayName.length > 0

  /**
   * The profile arriving is what ends the wait early.
   *
   * Without it the wait runs its full fifteen seconds and then asks for a name the swarm has
   * already supplied, renaming anybody patient enough to sit through it.
   *
   * Polled rather than waited on: libsession pushes conversations and messages but has no event for
   * the account. Once a second, at most fifteen times, only while this step is on screen.
   */
  useEffect(() => {
    // The question before the wait counts too: the fetch is already running behind it, and asking
    // only during the wait means the answer is always stale by exactly the time somebody spent
    // reading the question -- which is the time that decides whether the wait is needed at all.
    if (state.step !== 'loading' && !(state.step === 'messageNotifications' && restoring)) return
    const timer = setInterval(() => {
      void actions.refreshAccount().catch(() => {
        // The wait's own timeout covers this: a refresh that fails is one the next tick repeats,
        // and if they all fail the step ends the way it would have anyway.
      })
    }, PROFILE_POLL_MS)
    return () => {
      clearInterval(timer)
    }
  }, [state.step, restoring, actions])

  useEffect(() => {
    if (state.step !== 'loading') return
    if (!profileArrived) return
    dispatch({ type: 'restoreArrived' })
  }, [state.step, profileArrived])

  useEffect(() => {
    // A rotation or a resize mid-flow changes what comes next, so the reducer is told rather than
    // left holding whichever design the window happened to be when this started.
    if (state.design !== design) dispatch({ type: 'designChanged', design })
  }, [design, state.design])

  // Reported rather than derived, because only the flow knows the difference between "there is an
  // account now" and "this is over".
  useEffect(() => {
    onRunningChange?.(state.step !== 'landing')
  }, [state.step, onRunningChange])

  /**
   * That the account is made once, however many times this effect is asked to run.
   *
   * The effect has to read the whole state -- the branch, the name and the phrase are all in it --
   * and `designChanged` hands back a new object with the step still `done`, so a window crossing
   * the breakpoint or a tablet turning over runs the body again. A second `createAccount` beside
   * the first is two identities, and `setDisplayName` and `keepAccount` twice over.
   */
  const committing = useRef(false)

  /**
   * Which attempt at the phrase screen the flow is on.
   *
   * **A restore outlives the screen that started it.** `check` and `restoreAccount` are two round
   * trips and back is a single press, so the flow can be at the landing screen -- reset, and back
   * on the create branch -- when `phraseEntered` arrives from the attempt that was abandoned.
   * That pulls somebody off the landing screen into a create branch on a device where a restore
   * has already succeeded, and the account it restored is never confirmed.
   *
   * The back control refuses while the work is in flight, which is what stops this being reached
   * at all. This is the half that does not depend on a control being disabled.
   */
  const attempt = useRef(0)

  useEffect(() => {
    if (state.step !== 'done') {
      committing.current = false
      return
    }
    if (committing.current) return
    committing.current = true
    // `done` is reached from two places and means something different at each: the end of create,
    // where there is no account yet, and the end of a restore that had to ask for a name.
    void commit(state, actions, setBusy).then(
      () => {
        onRunningChange?.(false)
      },
      () => {
        dispatch({ type: 'commitFailed' })
      },
    )
  }, [state, actions, onRunningChange])

  /** Back from the phrase screen, which abandons whatever attempt is in flight. */
  const abandonRestore = () => {
    // The refusal described the attempt that was just abandoned. Left standing, coming back to this
    // screen shows an error over an empty field, and switching to the QR tab shows one over a
    // camera that has scanned nothing.
    setRejected(false)
    // Whoever abandons the attempt clears its flag: the resolution will not, because by then it
    // belongs to an attempt nobody is waiting for.
    attempt.current += 1
    setBusy(false)
    dispatch({ type: 'back' })
  }

  /**
   * **Checked, then taken over, both before leaving the phrase screen.**
   *
   * Checked first so that a phrase with a typo in it never mints anything: the refusal puts
   * somebody back on the screen with what they typed still on it, and nothing has happened. Taken
   * over immediately after, so that fetching the profile runs while the next screen is being read
   * -- on a phone that is the notification question, and the wait after it is often over before it
   * is drawn. Minting late spends that overlap, which is the one both mobile clients take.
   *
   * Going back from there on is a discard rather than a navigation. See `goBack`.
   */
  const submitPhrase = (from: RecoveryInput) => {
    const mine = ++attempt.current
    setBusy(true)
    setRejected(false)
    void check(from, actions)
      .then(() => actions.restoreAccount(from))
      .then(() => {
        if (attempt.current !== mine) return
        dispatch({ type: 'phraseEntered', from })
      })
      .catch(() => {
        if (attempt.current !== mine) return
        setRejected(true)
      })
      .finally(() => {
        if (attempt.current !== mine) return
        setBusy(false)
      })
  }

  // At `done` the last step stays on screen while the account is made -- see `committingStep`.
  const committingNow = state.step === 'done'
  /**
   * Whether the step on screen should refuse input.
   *
   * `committingNow` as well as `busy`, because the two do not start together: `busy` is set
   * inside the effect that commits, which runs after the frame that put this screen up. In that
   * frame the control that got us here is live again, so a second press lands on it -- and the
   * screens that stay up at `done` are exactly the ones whose button was just pressed.
   */
  const working = busy || committingNow
  const shownStep = committingNow ? committingStep(state) : state.step
  /** What back does from the shown step, as the stack's swipe offers it. See `backAction`. */
  const swipeBack = (() => {
    const action = backAction(shownStep, working)
    if (action === 'back') return goBack
    if (action === 'abandonRestore') return abandonRestore
    return undefined
  })()
  const body = (
    <OnboardingScreen
      step={shownStep}
      state={state}
      dispatch={dispatch}
      busy={working}
      committing={committingNow}
      rejected={rejected}
      profileArrived={profileArrived}
      onBack={goBack}
      onAbandonPhrase={abandonRestore}
      onSubmitPhrase={submitPhrase}
    />
  )

  return (
    <ConfirmUrlProvider>
      {/* **Phone only.** The wide designs cross-fade inside the chrome, which is what the desktop
          client does; a horizontal push is a mobile idiom. */}
      {!isWideDesign(design) ? (
        <StepTransition
          // The step the commit is drawn over, not `done` -- `body` is that step's screen, and
          // a key change here pushes a new screen, which remounts it and restarts the wait it is
          // showing.
          path={backPath({ ...state, step: shownStep })}
          instant={flag('disableAnimations')}
          onBack={swipeBack}
        >
          {body}
        </StepTransition>
      ) : (
        body
      )}
    </ConfirmUrlProvider>
  )
}

/**
 * Which of the three onboardings this is.
 *
 * Two inputs, because they are two questions. The window's width says which layout -- `gtSm` is
 * >700px, so a tablet takes the desktop frame rather than a stretched phone one, and a resize or a
 * rotation changes the answer. The notifications port says whether there is a delivery mode to
 * choose, which is an OS fact and does not change at all.
 */
function useOnboardingDesign(): OnboardingDesign {
  const wide = useMedia().gtSm
  // The flag is an override for looking at it, not a second source of truth: see its entry in the
  // flag table for why the tablet design is otherwise unreachable on the machines it is built on.
  const asks =
    requirePorts().notifications.notificationModesApply || flag('forceOnboardingTabletDesign')
  // Both questions, independently. Consulting `asks` only on the wide branch is what put the
  // phone's notification step on a narrowed desktop window, offering a mode it cannot deliver.
  if (wide) return asks ? 'tablet' : 'desktop'
  return asks ? 'phone' : 'desktopNarrow'
}

/**
 * Whether a phrase would restore, asked without restoring it.
 *
 * A raw seed has nothing to check that the restore does not check anyway, so it goes straight
 * through -- there is no phrase to put back on a screen and no word list involved.
 */
async function check(
  from: RecoveryInput,
  actions: ReturnType<typeof useSessionActions>,
): Promise<void> {
  if ('hexSeed' in from) return
  await actions.checkRecoveryPhrase(from.words, from.language)
}

/**
 * Everything that has to happen before the app has an account, once the questions are answered.
 *
 * Create mints the identity here, at the end, because that is where the legacy clients do it: a
 * name typed and then abandoned should leave nothing behind. Restore has minted one by this point
 * too -- at the wait, which is the step that exists to cover it -- so this only names it, and only
 * when the swarm never sent one.
 */
async function commit(
  state: OnboardingState,
  actions: ReturnType<typeof useSessionActions>,
  setBusy: (busy: boolean) => void,
): Promise<void> {
  setBusy(true)
  try {
    if (state.branch === 'create') await actions.createAccount()
    if (state.displayName !== null) await actions.setDisplayName(state.displayName)
    // Last, and only once the rest has worked. Until this lands the account is provisional and a
    // restart throws it away -- which is exactly what should happen if onboarding died before
    // reaching here, and exactly what must not happen now that it has.
    await actions.keepAccount()
    // After the account is kept, as the store only saves it for an account. Null where onboarding
    // didn't ask: desktop, which keeps polling and has nothing to choose.
    if (state.notifications !== null) await actions.setNotificationMode(state.notifications)
  } finally {
    setBusy(false)
  }
}
