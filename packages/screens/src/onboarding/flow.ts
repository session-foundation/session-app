import type { DeliveryMode } from '@session/state'

/**
 * Onboarding as a state machine, ported from the legacy clients.
 *
 *     PHONE    CREATE   landing -> pickDisplayName -> messageNotifications -> done
 *     PHONE    RESTORE  landing -> loadAccount     -> messageNotifications -> loading -> done
 *     TABLET   CREATE   landing -> pickDisplayName -> messageNotifications -> done
 *     TABLET   RESTORE  landing -> loadAccount     -> messageNotifications -> loading -> done
 *     DESKTOP  CREATE   landing -> pickDisplayName -> done
 *     DESKTOP  RESTORE  landing -> loadAccount     -> loading -> done
 *
 * A restore that gives up waiting inserts `pickDisplayName` before `done`, on every design: the
 * account exists and has no name yet, so it is asked for. See `afterFailedRestore`.
 *
 * **The two designs run different sequences, not the same one laid out differently.** Desktop has
 * no delivery-mode step: Instant is a push service and desktop has none to offer.
 *
 * A pure reducer rather than `useState` across five screens, because three things here are easy to
 * get subtly wrong and invisible afterwards:
 *
 * - **The account is minted at the end of create, not at the name step**, or backing out leaves a
 *   half-made account behind.
 * - **Notification mode is answered before the restore waits, not after.** Restoring can take
 *   fifteen seconds, and a question afterwards means fifteen seconds of nothing.
 * - **A failed restore does not go back to phrase entry.** The phrase was right and the profile
 *   never arrived, so there is nothing to retype.
 *
 * The reducer knows nothing about the bridge. `OnboardingFlow` turns `done` into the calls that
 * make an account.
 */

export type OnboardingStep =
  'landing' | 'pickDisplayName' | 'loadAccount' | 'messageNotifications' | 'loading' | 'done'

/** Which of the two sequences is running. Decided at the landing screen and never again. */
type OnboardingBranch = 'create' | 'restore'

/**
 * Which client's onboarding this is: a layout and a sequence, which are not the same question.
 *
 * A tablet is **the desktop layout with the phone's notification step**, because the OS suspends
 * it the way a phone's does. So the two inputs stay separate: the width says which layout, and the
 * notifications port says whether there is a mode to choose.
 *
 * **Both combinations of both answers exist, which is why there are four names and not three.**
 * A desktop window narrowed past the breakpoint is the fourth: `minWidth` on the window is 380
 * and the breakpoint is 701, so it is a window somebody can make. It takes the narrow frame,
 * because that is what fits, and it must not take the phone's notification question -- desktop
 * has no push service to offer, and whether it has one is not a fact about width.
 */
export type OnboardingDesign = 'phone' | 'desktop' | 'tablet' | 'desktopNarrow'

/** Whether this design draws the desktop client's two-column frame rather than filling a phone. */
export function isWideDesign(design: OnboardingDesign): boolean {
  return design === 'tablet' || design === 'desktop'
}

/** Whether this design asks which way notifications should arrive. */
export function asksAboutNotifications(design: OnboardingDesign): boolean {
  return design === 'phone' || design === 'tablet'
}

/** What the recovery screen collected, in the shape the bridge takes it. */
export type RecoveryInput = { words: string[]; language?: string } | { hexSeed: string }

export interface OnboardingState {
  step: OnboardingStep
  design: OnboardingDesign
  branch: OnboardingBranch
  /**
   * True only when the name picker was reached by a restore that gave up.
   *
   * Changes the copy, and what happens next: there is already an account by then, so naming it is
   * the last thing to do.
   */
  afterFailedRestore: boolean
  /** Held rather than applied, because in the create branch there is nothing to apply it to yet. */
  displayName: string | null
  recovery: RecoveryInput | null
  notifications: DeliveryMode | null
  /**
   * The bridge refused the last step, the one that actually makes the account.
   *
   * `done` renders nothing, so a rejection there has nowhere to show itself. This sends it back to
   * the name picker, the last screen that can be asked again.
   */
  commitFailed: boolean
}

export function initialOnboarding(design: OnboardingDesign): OnboardingState {
  return {
    step: 'landing',
    design,
    branch: 'create',
    afterFailedRestore: false,
    displayName: null,
    recovery: null,
    notifications: null,
    commitFailed: false,
  }
}

export type OnboardingEvent =
  | { type: 'chooseCreate' }
  | { type: 'chooseRestore' }
  | { type: 'nameEntered'; name: string }
  | { type: 'phraseEntered'; from: RecoveryInput }
  | {
      type: 'notificationsChosen'
      mode: DeliveryMode
      /**
       * Whether the restored profile is already here, which decides if there is anything to wait
       * for.
       *
       * Passed in rather than read, because this reducer knows nothing about the bridge.
       */
      profileArrived?: boolean
    }
  /** The restore wait ran out. See `afterFailedRestore`. */
  | { type: 'restoreGaveUp' }
  /** The restored profile came back from the swarm, so there is nothing left to ask. */
  | { type: 'restoreArrived' }
  /** libsession would not take the phrase over, after having said it was a phrase. */
  | { type: 'restoreFailed' }
  /** The bridge refused to make or name the account. See `commitFailed`. */
  | { type: 'commitFailed' }
  /**
   * The window crossed the width that decides which design is in use -- a rotation, or a resize.
   */
  | { type: 'designChanged'; design: OnboardingDesign }
  | { type: 'back' }

/**
 * Where `back` goes from each step, or null where there is nowhere to go.
 *
 * Null is not the same as "exit": backing out of naming a restored account would leave it nameless
 * rather than cancel anything.
 */
function previousStep(state: OnboardingState): OnboardingStep | null {
  switch (state.step) {
    case 'pickDisplayName':
      // **After a failed restore, back goes to the phrase rather than to the start**, which is
      // far more likely to be what somebody whose restore timed out wants. Creating still leads
      // back to the start, because there is nothing behind it.
      return state.afterFailedRestore ? 'loadAccount' : 'landing'
    case 'loadAccount':
      return 'landing'
    case 'messageNotifications':
      return state.branch === 'create' ? 'pickDisplayName' : 'loadAccount'
    case 'loading':
      // **The wait can be left.** An account exists by now, but the bridge can discard one, so
      // there is a way out to offer rather than fifteen seconds with none. The legacy Android
      // client offers back here too. It leads where it came from, so a second press reaches the
      // phrase.
      return asksAboutNotifications(state.design) ? 'messageNotifications' : 'loadAccount'
    default:
      return null
  }
}

/**
 * The step whose screen stays on screen while the account is made.
 *
 * `done` draws nothing of its own -- it is a call or two, and a screen of its own would read as a
 * step somebody has to get through. So the last step stays put, with its own control showing that
 * it is working. Without this the window is blank for the duration, which is a launch screen that
 * never ends if anything goes slowly.
 *
 * Every path into `done` has exactly one step behind it, which is what makes this answerable:
 * create ends at the notification question where one is asked and at the name where it is not,
 * and a restore ends at the wait -- except one that gave up waiting, which is asked for a name.
 */
export function committingStep(state: OnboardingState): OnboardingStep {
  if (state.afterFailedRestore) return 'pickDisplayName'
  if (state.branch === 'restore') return 'loading'
  return asksAboutNotifications(state.design) ? 'messageNotifications' : 'pickDisplayName'
}

/**
 * The steps back leads through from the one in `state`, oldest first, ending with it.
 *
 * What the phones' native stack holds, so the screen a back swipe uncovers is always the one back
 * goes to. The order the steps were visited in would disagree wherever back is a rule rather than
 * a return: after a restore whose wait ran out, back from the name goes to the phrase, not to the
 * wait that was on screen before it.
 */
export function backPath(state: OnboardingState): OnboardingStep[] {
  const path: OnboardingStep[] = [state.step]
  for (
    let step = previousStep(state);
    step !== null && !path.includes(step);
    step = previousStep({ ...state, step })
  ) {
    path.unshift(step)
  }
  return path
}

/**
 * What back does from the step on screen, or null where it does nothing.
 *
 * Nothing before the landing screen, and nothing while work is running -- the account being made,
 * a phrase being checked, or an account being discarded. A second back in that time runs a second
 * discard, or reveals a screen whose Continue restarts a commit that is still in flight. The phrase
 * screen's back abandons the attempt rather than stepping back through it.
 */
export function backAction(
  step: OnboardingStep,
  working: boolean,
): 'back' | 'abandonRestore' | null {
  if (working) return null
  switch (step) {
    case 'landing':
    case 'done':
      return null
    case 'loadAccount':
      return 'abandonRestore'
    case 'pickDisplayName':
    case 'messageNotifications':
    case 'loading':
      return 'back'
  }
}

/**
 * Whether going back from here has to throw an account away first.
 *
 * **True wherever one has been minted.** Restore mints at the phrase, so every step past it
 * qualifies; creating mints at the end, so backing out of it has nothing to undo.
 *
 * No step has to *ask* first: `discardAccount` can untake an account, so a warning dialog would
 * only stand in for something the bridge can perform.
 */
export function backDiscardsAccount(state: OnboardingState): boolean {
  if (state.branch !== 'restore') return false
  return (
    state.step === 'messageNotifications' ||
    state.step === 'pickDisplayName' ||
    // The wait is past the phrase, so an account exists behind it too.
    state.step === 'loading'
  )
}

export function onboardingReducer(state: OnboardingState, event: OnboardingEvent): OnboardingState {
  return advance(state, event)
}

function advance(state: OnboardingState, event: OnboardingEvent): OnboardingState {
  switch (event.type) {
    case 'chooseCreate':
      return { ...state, branch: 'create', step: 'pickDisplayName', afterFailedRestore: false }

    case 'chooseRestore':
      return { ...state, branch: 'restore', step: 'loadAccount', afterFailedRestore: false }

    case 'nameEntered':
      // Three endings, not two. After a failed restore the account already exists, so naming it is
      // the last thing. On the desktop design there is no notification question to go on to, so
      // create finishes here as well.
      return {
        ...state,
        displayName: event.name,
        commitFailed: false,
        step:
          state.afterFailedRestore || !asksAboutNotifications(state.design)
            ? 'done'
            : 'messageNotifications',
      }

    case 'phraseEntered':
      return {
        ...state,
        recovery: event.from,
        step: asksAboutNotifications(state.design) ? 'messageNotifications' : 'loading',
      }

    case 'notificationsChosen':
      // Create is finished here -- this is where the account gets made. Restore usually still has
      // to wait for the swarm, which is what `loading` is.
      //
      // **Unless the swarm already answered.** The fetch starts when the phrase is accepted, so
      // on a good connection the profile arrives while the question is being read, and a wait with
      // nothing to wait for is a screen that appears and vanishes. The legacy iOS client skips it
      // for the same reason.
      return {
        ...state,
        notifications: event.mode,
        step: state.branch === 'create' || event.profileArrived === true ? 'done' : 'loading',
      }

    case 'restoreGaveUp':
      // Not back to the phrase: it decoded, so there is nothing to retype. The account exists and
      // wants a name, which is the create branch's screen wearing different words.
      //
      // The words go here: the account is taken over, so holding them any longer keeps a copy of
      // the whole account in memory. They cannot be wiped, so dropping the reference is the most
      // that can be done.
      return { ...state, step: 'pickDisplayName', afterFailedRestore: true, recovery: null }

    case 'restoreArrived':
      // The name came with the account, so the flow is over: asking for one now would be asking
      // somebody to rename themselves. The words are dropped for the reason above.
      return { ...state, step: 'done', recovery: null }

    case 'restoreFailed':
      // Back to the phrase. It decoded a moment ago, so this is not a typo -- but this is the step
      // that owns the field, and it is the only one that can be tried again.
      return { ...state, step: 'loadAccount' }

    case 'commitFailed':
      // Back to the name picker whichever way `done` was reached: it is the only step left that
      // asks a question, and the name it collected is still held so nothing has to be retyped.
      return { ...state, step: 'pickDisplayName', commitFailed: true }

    case 'designChanged':
      return { ...state, design: event.design }

    case 'back': {
      const previous = previousStep(state)
      if (previous === null) return state
      // **Reaching the landing screen is starting over, not a step backwards.** Anything collected
      // belongs to an abandoned attempt, and after a discard to an account that no longer exists
      // here. Carrying a name or a phrase into the next attempt is the leak this flow exists to
      // prevent, one level above the database.
      if (previous === 'landing') return { ...initialOnboarding(state.design), step: 'landing' }
      return { ...state, step: previous }
    }
  }
}
