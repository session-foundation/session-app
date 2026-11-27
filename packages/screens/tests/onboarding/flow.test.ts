import { describe, expect, it } from 'vitest'

import {
  asksAboutNotifications,
  backAction,
  backPath,
  committingStep,
  backDiscardsAccount,
  isWideDesign,
  initialOnboarding,
  onboardingReducer,
  type OnboardingDesign,
  type OnboardingEvent,
  type OnboardingState,
} from '#src/onboarding/flow'

/**
 * The sequences, as the legacy clients run them. Ported rather than designed, so the tests that
 * matter pin what a redesign would quietly get wrong: when the account is made, when notifications
 * are asked about, where a failed restore lands -- and that the two designs are different flows
 * rather than one flow laid out two ways.
 */
function run(events: OnboardingEvent[], design: OnboardingDesign = 'phone'): OnboardingState {
  return events.reduce(onboardingReducer, initialOnboarding(design))
}

const NAME: OnboardingEvent = { type: 'nameEntered', name: 'Ada' }
const PHRASE: OnboardingEvent = { type: 'phraseEntered', from: { words: ['one', 'two'] } }
const FAST: OnboardingEvent = { type: 'notificationsChosen', mode: 'instant' }
const CREATE: OnboardingEvent = { type: 'chooseCreate' }
const RESTORE: OnboardingEvent = { type: 'chooseRestore' }

describe('the phone sequences', () => {
  it('creates: landing, name, notifications, done', () => {
    expect(run([CREATE]).step).toBe('pickDisplayName')
    expect(run([CREATE, NAME]).step).toBe('messageNotifications')
    expect(run([CREATE, NAME, FAST]).step).toBe('done')
  })

  it('restores: landing, phrase, notifications, loading', () => {
    expect(run([RESTORE]).step).toBe('loadAccount')
    expect(run([RESTORE, PHRASE]).step).toBe('messageNotifications')
    expect(run([RESTORE, PHRASE, FAST]).step).toBe('loading')
  })

  it('asks about notifications before the wait, not after', () => {
    // Restoring can take fifteen seconds. Asking afterwards means fifteen seconds of nothing and
    // then a question, which is the order this test exists to prevent.
    const state = run([RESTORE, PHRASE])
    expect(state.step).toBe('messageNotifications')
    expect(state.notifications).toBeNull()
  })
})

describe('the desktop sequences', () => {
  it('never asks about notification mode', () => {
    // Fast mode is a push service and desktop has none, so the question has no answer worth
    // asking for. A different flow, not the phone flow in a wider column.
    expect(run([CREATE, NAME], 'desktop').step).toBe('done')
    expect(run([RESTORE, PHRASE], 'desktop').step).toBe('loading')
  })

  it('never records a notification mode either', () => {
    expect(run([CREATE, NAME], 'desktop').notifications).toBeNull()
  })
})

describe('what the create branch does with the name', () => {
  it('holds it rather than applying it, because there is no account yet', () => {
    // The account is minted at the end of create. A name applied at the name step would be a name
    // applied to nothing, and backing out would leave a half-made account behind.
    const held = run([CREATE, NAME])
    expect(held.displayName).toBe('Ada')
    expect(held.step).toBe('messageNotifications')
  })
})

describe('a restore that gives up', () => {
  const gaveUp = run([RESTORE, PHRASE, FAST, { type: 'restoreGaveUp' }])

  it('lands in the name picker, not back at the phrase', () => {
    // The phrase decoded -- the profile simply never arrived. There is nothing to retype, and
    // sending someone back to the phrase field says there is.
    expect(gaveUp.step).toBe('pickDisplayName')
    expect(gaveUp.afterFailedRestore).toBe(true)
  })

  it('finishes at the name, because the account already exists', () => {
    expect(onboardingReducer(gaveUp, NAME).step).toBe('done')
  })

  it('does the same on the desktop design', () => {
    const desktop = run([RESTORE, PHRASE, { type: 'restoreGaveUp' }], 'desktop')
    expect(desktop.step).toBe('pickDisplayName')
    expect(onboardingReducer(desktop, NAME).step).toBe('done')
  })
})

describe('going back', () => {
  it('returns to the landing screen from either branch’s first step', () => {
    expect(run([CREATE, { type: 'back' }]).step).toBe('landing')
    expect(run([RESTORE, { type: 'back' }]).step).toBe('landing')
  })

  it('returns to whichever step led to notifications', () => {
    expect(run([CREATE, NAME, { type: 'back' }]).step).toBe('pickDisplayName')
    expect(run([RESTORE, PHRASE, { type: 'back' }]).step).toBe('loadAccount')
  })

  it('does nothing at the landing screen', () => {
    expect(run([{ type: 'back' }])).toEqual(initialOnboarding('phone'))
  })

  it('goes back to the phrase from naming an account whose restore gave up', () => {
    // Not to the start. Somebody whose restore timed out and who then presses back is far more
    // likely to want to try the phrase again -- on a better connection, say -- than to begin from
    // nothing. The account that was taken over is discarded on the way, which is what makes this
    // possible at all.
    const gaveUp = run([RESTORE, PHRASE, FAST, { type: 'restoreGaveUp' }])
    expect(onboardingReducer(gaveUp, { type: 'back' }).step).toBe('loadAccount')
  })

  it('goes back to the start from naming a newly created account', () => {
    // The other way into this screen has nothing behind it but the beginning.
    const named = run([CREATE])
    expect(onboardingReducer(named, { type: 'back' }).step).toBe('landing')
  })

  it('leaves the wait rather than sitting out the full fifteen seconds', () => {
    // Offered because the bridge can discard an account, so there is a way out even though one
    // exists by this point. The legacy Android client offers back here for the same reason.
    expect(onboardingReducer(run([RESTORE, PHRASE], 'desktop'), { type: 'back' }).step).toBe(
      'loadAccount',
    )
    expect(onboardingReducer(run([RESTORE, PHRASE, FAST]), { type: 'back' }).step).toBe(
      'messageNotifications',
    )
  })

  it('throws the account away when leaving the wait', () => {
    expect(backDiscardsAccount(run([RESTORE, PHRASE, FAST]))).toBe(true)
  })

  it('forgets everything collected when it reaches the landing screen', () => {
    // The leak one level above the database: a display name or a phrase carried into the next
    // attempt would belong to the account just abandoned.
    // Two steps in with a name typed, then all the way out.
    const backedOut = run([CREATE, NAME, { type: 'back' }, { type: 'back' }])
    expect(backedOut.step).toBe('landing')
    expect(backedOut.displayName).toBeNull()
    expect(backedOut.afterFailedRestore).toBe(false)
  })

  it('forgets a phrase that was actually entered', () => {
    // The create branch never sets `recovery`, so asserting it is null after backing out of that
    // branch says nothing -- it was null the whole way. This takes the branch that holds one.
    const entered = run([RESTORE, PHRASE])
    expect(entered.recovery).not.toBeNull()

    const backedOut = run([RESTORE, PHRASE, FAST, { type: 'restoreGaveUp' }])
    expect(backedOut.recovery).toBeNull()

    const gone = run([RESTORE, PHRASE, FAST, { type: 'restoreArrived' }])
    expect(gone.recovery).toBeNull()
  })

  it('throws the account away wherever one has been minted', () => {
    // Restoring mints as it leaves the phrase screen, so every step after it is backing out of a
    // real account -- which is a discard rather than a navigation.
    expect(backDiscardsAccount(run([RESTORE, PHRASE]))).toBe(true)
    expect(backDiscardsAccount(run([RESTORE, PHRASE, FAST, { type: 'restoreGaveUp' }]))).toBe(true)

    // Creating holds the name and mints at the very end, so backing out of it has nothing to undo.
    expect(backDiscardsAccount(run([CREATE]))).toBe(false)
    expect(backDiscardsAccount(run([CREATE, NAME]))).toBe(false)
    // And the phrase screen itself: checked but not yet taken over.
    expect(backDiscardsAccount(run([RESTORE]))).toBe(false)
    expect(backDiscardsAccount(initialOnboarding('phone'))).toBe(false)
  })
})

describe('the window changing width mid-flow', () => {
  it('switches which sequence the remaining steps follow', () => {
    // A tablet rotated, or a desktop window dragged narrow. The design follows the width, so what
    // comes next follows it too, rather than finishing in a shape the window no longer is.
    const rotated = run([CREATE, { type: 'designChanged', design: 'desktop' }])
    expect(onboardingReducer(rotated, NAME).step).toBe('done')
  })

  it('leaves everything already collected alone', () => {
    const rotated = run([CREATE, NAME, { type: 'designChanged', design: 'desktop' }])
    expect(rotated.displayName).toBe('Ada')
    expect(rotated.step).toBe('messageNotifications')
  })
})

describe('changing branch', () => {
  it('clears the failed-restore copy if the landing screen is reached again', () => {
    // Otherwise the create branch inherits "your account could not be restored" from a previous
    // attempt, which is both wrong and alarming.
    const again = run([RESTORE, PHRASE, FAST, { type: 'restoreGaveUp' }, CREATE])
    expect(again.afterFailedRestore).toBe(false)
  })
})

describe('a bridge that refuses the last step', () => {
  const FAILED: OnboardingEvent = { type: 'commitFailed' }

  it('goes back to the name picker rather than staying on a step that draws nothing', () => {
    // `done` renders null, so a rejection left there is an empty window: no message, no way on,
    // and nothing to press. Found by running the flow against real libsession.
    const stuck = run([CREATE, NAME, FAST, FAILED])
    expect(stuck.step).toBe('pickDisplayName')
    expect(stuck.commitFailed).toBe(true)
  })

  it('keeps the name that was typed, so it does not have to be typed again', () => {
    expect(run([CREATE, NAME, FAST, FAILED]).displayName).toBe('Ada')
  })

  it('does the same on the desktop design, where done follows the name directly', () => {
    expect(run([CREATE, NAME, FAILED], 'desktop').step).toBe('pickDisplayName')
  })

  it('lands there after a restore that had to ask for a name too', () => {
    const failed = run([RESTORE, PHRASE, FAST, { type: 'restoreGaveUp' }, NAME, FAILED])
    expect(failed.step).toBe('pickDisplayName')
    // Still the restore branch's copy: what failed was naming the account, not restoring it.
    expect(failed.afterFailedRestore).toBe(true)
  })

  it('clears the refusal when the name is submitted again', () => {
    expect(run([CREATE, NAME, FAST, FAILED, NAME]).commitFailed).toBe(false)
  })
})

describe('the wait for a restored profile', () => {
  it('ends as soon as the name arrives, rather than always running out', () => {
    // Without this the timeout is the only way out, so a swarm that answers in two seconds still
    // costs fifteen and then asks somebody to rename themselves.
    expect(run([RESTORE, PHRASE, FAST, { type: 'restoreArrived' }]).step).toBe('done')
  })

  it('goes back to the phrase if libsession will not take the account over', () => {
    // Not a typo - the phrase decoded a moment earlier - but that screen owns the field, so it is
    // the only one that can be tried again.
    expect(run([RESTORE, PHRASE, FAST, { type: 'restoreFailed' }]).step).toBe('loadAccount')
  })

  it('still holds the phrase, so going back does not mean retyping it', () => {
    expect(run([RESTORE, PHRASE, FAST, { type: 'restoreFailed' }]).recovery).toEqual({
      words: ['one', 'two'],
    })
  })
})

describe('the tablet sequences', () => {
  // The desktop layout with the phone's notification step. The two are separate questions: the
  // width decides the frame, and whether the OS suspends the app decides whether there is a
  // delivery mode to choose at all.
  it('creates: landing, name, notifications, done - the phone sequence', () => {
    expect(run([CREATE], 'tablet').step).toBe('pickDisplayName')
    expect(run([CREATE, NAME], 'tablet').step).toBe('messageNotifications')
    expect(run([CREATE, NAME, FAST], 'tablet').step).toBe('done')
  })

  it('restores: landing, phrase, notifications, loading', () => {
    expect(run([RESTORE, PHRASE], 'tablet').step).toBe('messageNotifications')
    expect(run([RESTORE, PHRASE, FAST], 'tablet').step).toBe('loading')
  })

  it('asks about notifications, where the desktop design does not', () => {
    expect(asksAboutNotifications('tablet')).toBe(true)
    expect(asksAboutNotifications('phone')).toBe(true)
    expect(asksAboutNotifications('desktop')).toBe(false)
  })

  it('draws the wide frame, where the phone design does not', () => {
    expect(isWideDesign('tablet')).toBe(true)
    expect(isWideDesign('desktop')).toBe(true)
    expect(isWideDesign('phone')).toBe(false)
  })
})

describe('the path back', () => {
  const BACK: OnboardingEvent = { type: 'back' }
  const GAVE_UP: OnboardingEvent = { type: 'restoreGaveUp' }
  const FAILED: OnboardingEvent = { type: 'commitFailed' }
  const ARRIVED: OnboardingEvent = {
    type: 'notificationsChosen',
    mode: 'instant',
    profileArrived: true,
  }

  /** What the phones' stack holds where a step stays on screen at `done`. */
  const shownPath = (state: OnboardingState) =>
    backPath(state.step === 'done' ? { ...state, step: committingStep(state) } : state)

  it('ends at the step on screen, and leads back to the landing screen', () => {
    expect(backPath(run([CREATE, NAME]))).toEqual([
      'landing',
      'pickDisplayName',
      'messageNotifications',
    ])
    expect(backPath(run([RESTORE, PHRASE, FAST]))).toEqual([
      'landing',
      'loadAccount',
      'messageNotifications',
      'loading',
    ])
  })

  it('goes back to the phrase, not the wait, after a restore whose wait ran out', () => {
    // History would put the finished loader under the name screen, and a swipe would drag it out.
    expect(backPath(run([RESTORE, PHRASE, FAST, GAVE_UP]))).toEqual([
      'landing',
      'loadAccount',
      'pickDisplayName',
    ])
  })

  it('goes back to the start, not the notification question, after a restore whose commit failed', () => {
    expect(backPath(run([RESTORE, PHRASE, ARRIVED, FAILED]))).toEqual([
      'landing',
      'pickDisplayName',
    ])
  })

  it('puts where back goes directly under the top, whatever the sequence', () => {
    const sequences: OnboardingEvent[][] = [
      [CREATE],
      [CREATE, NAME],
      [CREATE, NAME, FAST, FAILED],
      [RESTORE],
      [RESTORE, PHRASE],
      [RESTORE, PHRASE, FAST],
      [RESTORE, PHRASE, FAST, GAVE_UP],
      [RESTORE, PHRASE, ARRIVED, FAILED],
      [RESTORE, PHRASE, FAST, BACK],
    ]
    for (const events of sequences) {
      const state = run(events)
      expect(backPath(state).at(-2) ?? null, events.map((e) => e.type).join(' ')).toBe(
        onboardingReducer(state, BACK) === state ? null : onboardingReducer(state, BACK).step,
      )
    }
  })

  it('holds the step drawn at done on top while the account is made', () => {
    expect(shownPath(run([CREATE, NAME, FAST])).at(-1)).toBe('messageNotifications')
    expect(shownPath(run([RESTORE, PHRASE, FAST, GAVE_UP, NAME])).at(-1)).toBe('pickDisplayName')
  })
})

describe('what back does', () => {
  it('does nothing while work is running, from any step', () => {
    for (const step of [
      'landing',
      'loadAccount',
      'pickDisplayName',
      'messageNotifications',
      'loading',
      'done',
    ] as const) {
      expect(backAction(step, true), step).toBeNull()
    }
  })

  it('abandons the attempt from the phrase screen, and steps back elsewhere', () => {
    expect(backAction('loadAccount', false)).toBe('abandonRestore')
    expect(backAction('pickDisplayName', false)).toBe('back')
    expect(backAction('messageNotifications', false)).toBe('back')
    expect(backAction('loading', false)).toBe('back')
  })

  it('has nowhere to go before the landing screen or once the account is being made', () => {
    expect(backAction('landing', false)).toBeNull()
    expect(backAction('done', false)).toBeNull()
  })
})

describe('the wait is skipped when the profile is already here', () => {
  /**
   * The fetch starts at the phrase and runs behind the notification question, so on a good
   * connection the answer is often back before the question is answered. The legacy iOS client
   * skips the wait in that case, and a wait with nothing to wait for is a screen that appears and
   * vanishes.
   */
  it('goes straight to done when the profile arrived during the question', () => {
    const state = run([
      RESTORE,
      PHRASE,
      { type: 'notificationsChosen', mode: 'instant', profileArrived: true },
    ])

    expect(state.step).toBe('done')
    expect(state.notifications).toBe('instant')
  })

  it('still waits when it has not', () => {
    expect(run([RESTORE, PHRASE, FAST]).step).toBe('loading')
    expect(
      run([
        RESTORE,
        PHRASE,
        { type: 'notificationsChosen', mode: 'periodic', profileArrived: false },
      ]).step,
    ).toBe('loading')
  })

  /** Nothing is being fetched in the create branch, so an arrival there would be meaningless. */
  it('ignores it when creating', () => {
    expect(
      run([CREATE, NAME, { type: 'notificationsChosen', mode: 'instant', profileArrived: true }])
        .step,
    ).toBe('done')
  })
})

/**
 * Which screen stays up while the account is made.
 *
 * `done` draws nothing of its own, so it shows the step it was reached from. Every path into it
 * has exactly one step behind it, and getting this wrong is a blank window rather than a wrong
 * one -- which looks like a launch that never finished.
 */
describe('the step that stays on screen at done', () => {
  it('is the notification question where the flow asks one', () => {
    const state = run([CREATE, NAME, FAST], 'phone')
    expect(state.step).toBe('done')
    expect(committingStep(state)).toBe('messageNotifications')
    expect(committingStep(run([CREATE, NAME, FAST], 'tablet'))).toBe('messageNotifications')
  })

  it('is the name where it does not', () => {
    const state = run([CREATE, NAME], 'desktop')
    expect(state.step).toBe('done')
    expect(committingStep(state)).toBe('pickDisplayName')
  })

  it('is the wait, for a restore that arrived', () => {
    const state = run([RESTORE, PHRASE, FAST, { type: 'restoreArrived' }], 'phone')
    expect(state.step).toBe('done')
    expect(committingStep(state)).toBe('loading')
  })

  it('is the name, for a restore that gave up and was asked for one', () => {
    const state = run([RESTORE, PHRASE, FAST, { type: 'restoreGaveUp' }, NAME], 'phone')
    expect(state.step).toBe('done')
    expect(committingStep(state)).toBe('pickDisplayName')
  })

  it('names a step for every way into done, so none of them draws a blank', () => {
    // The guard on the whole idea: any path reaching `done` has to name something to keep up.
    const paths: OnboardingEvent[][] = [
      [CREATE, NAME, FAST],
      [RESTORE, PHRASE, FAST, { type: 'restoreArrived' }],
      [RESTORE, PHRASE, FAST, { type: 'restoreGaveUp' }, NAME],
    ]
    for (const design of ['phone', 'tablet', 'desktop'] as const) {
      for (const path of paths) {
        const state = run(path, design)
        if (state.step !== 'done') continue
        expect(
          committingStep(state),
          `${design}: ${path.map((e) => e.type).join(' -> ')}`,
        ).not.toBe('done')
      }
    }
  })
})

/**
 * The two questions the design answers, which are not the same question.
 *
 * Width decides the frame; the notifications port decides whether there is a delivery mode to
 * choose. Reading one off the other is how a desktop window narrowed past the breakpoint came to
 * be offered the phone's notification step -- a mode it has no push service to deliver.
 */
describe('the four designs', () => {
  it('asks about notifications at either width, and not at either without a service', () => {
    expect(asksAboutNotifications('phone')).toBe(true)
    expect(asksAboutNotifications('tablet')).toBe(true)
    expect(asksAboutNotifications('desktop')).toBe(false)
    expect(asksAboutNotifications('desktopNarrow')).toBe(false)
  })

  it('takes the narrow frame at either answer, and the wide one at either', () => {
    expect(isWideDesign('phone')).toBe(false)
    expect(isWideDesign('desktopNarrow')).toBe(false)
    expect(isWideDesign('tablet')).toBe(true)
    expect(isWideDesign('desktop')).toBe(true)
  })

  it('runs the desktop sequence in a narrowed window', () => {
    // The regression this exists for: the same events, and no notification step in sight.
    const narrow = run([CREATE, NAME], 'desktopNarrow')
    expect(narrow.step).toBe('done')
    expect(run([RESTORE, PHRASE], 'desktopNarrow').step).toBe('loading')
  })

  it('separates the frame from the sequence, so each design is its own pair', () => {
    const designs: OnboardingDesign[] = ['phone', 'tablet', 'desktop', 'desktopNarrow']
    const pairs = designs.map(
      (d) => `${String(isWideDesign(d))}/${String(asksAboutNotifications(d))}`,
    )
    expect(new Set(pairs).size).toBe(designs.length)
  })
})
