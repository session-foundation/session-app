import type { ReactNode } from 'react'

/**
 * The props both Input variants accept.
 *
 * It lives in a third file so neither variant can quietly grow a prop the other does not
 * have: each one imports this, and a screen typechecks against whichever the bundler
 * resolves. Without it the two drift and only the platform you did not run notices.
 */
export interface InputProps {
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  /** Mapped to inputMode on the web and keyboardType on native. */
  keyboardType?: 'default' | 'email' | 'numeric' | 'phone'
  autoCapitalize?: 'none' | 'sentences' | 'words'
  secureTextEntry?: boolean
  /**
   * Whether the platform may correct, suggest, remember or offer to save what is typed here.
   *
   * **Off is for a field whose contents must not leave it.** A recovery phrase is words from a
   * list, so a keyboard treats it as prose: it learns the words into the personal dictionary and
   * the prediction cache, offers them back in other apps, and on the web a browser spell-checks
   * the value and offers to save it. `secureTextEntry` suppresses most of that and the field
   * turns it off to be read back, which is the moment the phrase is ordinary text.
   *
   * One prop for all of it rather than four, because no caller wants them separately: the
   * question is whether this is a secret, and every platform answers it in its own vocabulary.
   */
  private?: boolean
  multiline?: boolean
  autoFocus?: boolean
  disabled?: boolean
  onSubmit?: () => void
  /**
   * Take the space the parent offers along its main axis.
   *
   * Off by default, and it has to be a choice rather than built in: `flex: 1` grows the width
   * inside a row and sets `flex-basis: 0` inside a column, where it collapses the field to the
   * height of its own text. A shared component cannot know which direction it was put in.
   */
  grow?: boolean
  /**
   * A list field's height rather than a form's: a search box above a list, where every row the
   * field gives back is another row of the list on screen.
   */
  compact?: boolean | undefined
  /**
   * Drawn inside the field, against its trailing edge.
   *
   * Inside rather than beside, because everything that goes here is *about* the field -- a
   * character count, a reveal toggle -- and a control under a field pushes whatever follows it down
   * the moment it appears. The field's own trailing padding grows to make room.
   */
  end?: ReactNode
  /** How much room to leave for `end`. Given by the caller, which is the only thing that knows. */
  endWidth?: number
  /**
   * Whether the field is in an error state, which is a different thing from what the error says.
   *
   * Three rules, all the desktop client's: the border turns red, the typed text turns red, and the
   * placeholder turns red. The fourth is the one that is not obvious -- **the border stays red
   * after the text is corrected**, until the field is submitted again. So the caller keeps two
   * pieces of state and this takes both.
   */
  error?: boolean
  /** True while the typed text should be red too. Cleared as soon as the value changes. */
  errorText?: boolean
  testID?: string
}
