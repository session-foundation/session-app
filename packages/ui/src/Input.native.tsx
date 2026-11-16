import { Input as TamaguiInput, XStack } from 'tamagui'

import type { InputProps } from './Input.types'
import { useFocusSerial } from './useFocusSerial'
import { keyboardTypeToNative } from './nativeProps'
import { logical } from './logicalEdges'

/** What `$md` resolves to. The inset props take a dimension rather than a space token. */
const SLOT_INSET = 15

/**
 * The native flavour.
 *
 * Same props as the web one - they share Input.types.ts precisely so they cannot disagree -
 * but the keyboard is chosen with keyboardType, and returnKeyType is worth setting because
 * a soft keyboard has no enter key otherwise.
 */
export function Input({
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize,
  secureTextEntry,
  private: isPrivate,
  multiline,
  autoFocus,
  disabled,
  onSubmit,
  focusSerial,
  grow = false,
  compact = false,
  end,
  endWidth = 0,
  error = false,
  errorText = false,
  testID,
}: InputProps) {
  const input = useFocusSerial(focusSerial)

  const field = (
    <TamaguiInput
      ref={input as never}
      // Fills the wrapper, which is the thing the parent lays out -- so `grow` belongs there and
      // this is unconditional. Stretched as well as flexed, because the wrapper is a row: `flex`
      // gives it the width and `alignSelf` the height.
      flex={1}
      alignSelf="stretch"
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder ?? ''}
      keyboardType={keyboardTypeToNative(keyboardType) as never}
      autoCapitalize={autoCapitalize ?? 'sentences'}
      secureTextEntry={secureTextEntry ?? false}
      // Independent of `secureTextEntry`, which the reveal toggle turns off: the phrase is no
      // less a secret for being on screen, and these are what keep it out of the keyboard's
      // dictionary and prediction cache. `oneTimeCode` is the content type that tells iOS not to
      // offer a saved value and not to learn this one.
      {...(isPrivate === true
        ? {
            autoCorrect: false,
            spellCheck: false,
            autoComplete: 'off' as const,
            textContentType: 'oneTimeCode' as const,
          }
        : {})}
      multiline={multiline ?? false}
      autoFocus={autoFocus ?? false}
      disabled={disabled ?? false}
      {...(onSubmit ? { onSubmitEditing: () => onSubmit() } : {})}
      returnKeyType={onSubmit ? 'send' : 'default'}
      blurOnSubmit={false}
      testID={testID}
      // **No fill.** The legacy clients draw this field as a bordered box on the page, and a
      // surface behind it read as a different control -- one that belongs to a card rather than to
      // the screen.
      backgroundColor="transparent"
      borderColor={error ? '$dangerColor' : '$bordersColor'}
      // The focus ring wins while the field is focused, so the two are never drawn at once -- a
      // red border inside a green one reads as two separate states arguing. The red returns on
      // blur, because the value still has not been accepted.
      //
      // This exists only because there *is* a focus ring: the legacy client has none. If the ring
      // goes before this merges, delete this line and the red border becomes unconditional again.
      {...(error ? { focusStyle: { borderColor: '$primaryColor' } } : {})}
      color={errorText ? '$dangerColor' : '$textPrimary'}
      // The caret and the selection take the text colour. iOS tints both with the system blue by
      // default, which is the one colour on this screen that belongs to no theme.
      cursorColor="$textPrimary"
      selectionColor="$textPrimary"
      placeholderTextColor={error ? '$dangerColor' : '$textSecondary'}
      borderRadius="$lg"
      // Taller and more generously padded than a list field: the desktop client pads its
      // onboarding input by 20px on every side, which is most of why its fields read as roomy.
      // A floor when compact rather than a height: its text is not capped, and at the largest
      // sizes a fixed 48 clips it.
      {...(compact ? { minHeight: '$3xl' as const } : { height: '$5xl' as const })}
      paddingHorizontal={compact ? '$md' : '$lg'}
      // Room for whatever sits against the trailing edge, so the text does not run under it.
      {...logical({ paddingEnd: endWidth === 0 ? SLOT_INSET : endWidth })}
    />
  )

  /**
   * **The wrapper is always here, even with nothing to put in it.**
   *
   * Returning the bare field in one case and a wrapped one in the other changes the element type
   * at this position, so React unmounts the `TextInput` and mounts a new one -- which drops the
   * keyboard and the caret. That is invisible until something makes the slot appear *while* the
   * field is being typed in, which the display name's character counter does.
   */
  return (
    <XStack position="relative" {...(grow ? { flex: 1 } : {})}>
      {field}
      {/* Centred against the field rather than pinned to a corner: the field is one row tall and
          anything in it should sit on the same line as the text. */}
      {end === undefined ? null : (
        <XStack
          position="absolute"
          // The trailing edge, which is the right one only until the layout mirrors.
          // A number rather than `$2`: the inset props take a dimension and not a space
          // token, so this is `SPACE_SCALE[2]` written out.
          {...logical({ insetEnd: SLOT_INSET })}
          top={0}
          bottom={0}
          alignItems="center"
          pointerEvents="box-none"
        >
          {end}
        </XStack>
      )}
    </XStack>
  )
}
