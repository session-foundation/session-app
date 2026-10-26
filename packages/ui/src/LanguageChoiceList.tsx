import { useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, type ScrollViewInstance } from 'react-native'
import { XStack, YStack } from 'tamagui'

import { Icon } from './Icon'
import { filterLanguages } from './languageFilter'
import { Input } from './Input'
import { Text } from './Text'
import { GLYPH_MAX_SCALE, LABEL_MAX_SCALE } from './fontScaleCaps'
import type { LanguageChoice, LanguagePickerTestIDs } from './LanguagePicker.types'

interface LanguageChoiceListProps {
  value: string
  options: readonly LanguageChoice[]
  onChange: (value: string) => void
  searchPlaceholder: string
  emptyLabel: string
  testIDs: Pick<LanguagePickerTestIDs, 'search' | 'option'>
}

/**
 * A row's height at the default text size, and its floor: a larger system text size grows a row
 * whose name wraps. The selected row is scrolled to by arithmetic on this rather than by measuring
 * every row above it, so at a large text size it lands near the row rather than on it. Tall enough
 * for a comfortable target and for the scripts with tall ascenders.
 */
const ROW_HEIGHT = 40

/**
 * The searchable list of languages.
 *
 * Split out from the picker rather than written inline because the picker shows it only on the
 * branch where the app owns the setting, and that branch already has enough going on around it:
 * a panel, a backdrop and the decision about which branch to take. This is the part that just
 * lists languages.
 */
export function LanguageChoiceList({
  value,
  options,
  onChange,
  searchPlaceholder,
  emptyLabel,
  testIDs,
}: LanguageChoiceListProps) {
  const [query, setQuery] = useState('')
  // React Native's ScrollView rather than tamagui's: tamagui types its ref as the component rather
  // than the instance, so `scrollTo` is not on it.
  const scroller = useRef<ScrollViewInstance>(null)

  const matches = useMemo(() => filterLanguages(options, query), [options, query])

  /**
   * Opens with the current language in view.
   *
   * Scrolled to rather than pinned to the top, which is what a native `<select>` does and what a
   * person scanning an alphabetical list expects: moving the selected row out of its alphabetical
   * place makes the list harder to scan for everyone in order to help the one row that is already
   * marked with a tick.
   *
   * Nudged up by one row so there is something above it -- a selected row flush against the top
   * edge looks like the start of the list rather than a position within it.
   */
  useEffect(() => {
    const index = matches.findIndex((option) => option.value === value)
    if (index < 0) return
    scroller.current?.scrollTo({ y: Math.max(0, (index - 1) * ROW_HEIGHT), animated: false })
    // Deliberately empty: this runs once, when the panel opens. Re-running it as somebody types
    // would drag the list back to the selected row after every keystroke.
  }, [])

  return (
    // **Shrinks into whatever the panel has left.** The height is the panel's to decide -- see the
    // cap there -- and `minHeight: 0` is what lets this go below its content's natural height,
    // which a flex child will not do without it.
    <YStack gap="$xs" flexShrink={1} minHeight={0}>
      <XStack alignItems="center" gap="$xs">
        <Icon name="search" size="md" color="$textSecondary" />
        <Input
          grow
          compact
          value={query}
          onChangeText={setQuery}
          placeholder={searchPlaceholder}
          autoCapitalize="none"
          testID={testIDs.search}
        />
      </XStack>

      {matches.length === 0 ? (
        <YStack paddingVertical="$md" alignItems="center">
          <Text tone="secondary" size="$body">
            {emptyLabel}
          </Text>
        </YStack>
      ) : (
        <ScrollView ref={scroller} style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
          <YStack>
            {matches.map((option) => {
              const selected = option.value === value
              return (
                <XStack
                  key={option.value}
                  role="button"
                  alignItems="center"
                  gap="$sm"
                  minHeight={ROW_HEIGHT}
                  paddingHorizontal="$sm"
                  borderRadius="$sm"
                  $platform-web={{ cursor: 'pointer' }}
                  backgroundColor={selected ? '$backgroundTertiary' : 'transparent'}
                  pressStyle={{ backgroundColor: '$backgroundTertiary' }}
                  onPress={() => {
                    onChange(option.value)
                  }}
                  aria-selected={selected}
                  testID={testIDs.option(option.value)}
                >
                  {/* The flag is decoration: it repeats across rows and is absent on three of
                      them, so it is hidden from screen readers and the name carries the row. */}
                  <Text size="$title" aria-hidden maxFontSizeMultiplier={GLYPH_MAX_SCALE}>
                    {option.flag}
                  </Text>
                  <Text
                    flex={1}
                    size="$body"
                    weight={selected ? 'semibold' : 'regular'}
                    maxFontSizeMultiplier={LABEL_MAX_SCALE}
                  >
                    {option.label}
                  </Text>
                  {selected ? <Icon name="check" size="md" color="$primaryColor" /> : null}
                </XStack>
              )
            })}
          </YStack>
        </ScrollView>
      )}
    </YStack>
  )
}
