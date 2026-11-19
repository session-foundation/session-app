import { Button } from './Button'
import { useGlass } from './glass'
import { Icon } from './Icon'
import type { IconName } from './Icon.types'
import { PressArea } from './PressArea'
import { ROW_TOUCH_TARGET } from './rowTouchTarget'
import { SIZE_SCALE } from './scales'
import { touchReach } from './touchReach'
import { useThemeIsDark } from './UIProvider'
import { useTokenColor } from './useTokenColor'

export interface BarButtonProps {
  icon: IconName
  accessibilityLabel: string
  onPress: () => void
  disabled?: boolean
  /**
   * The glass's diameter, for a button lined up with one the system draws in its own bar. A `md`
   * circular button's when omitted, so glass and circle take the same room.
   */
  glassDiameter?: number | undefined
  testID?: string | undefined
}

const DIAMETER = SIZE_SCALE['2xl']

/**
 * A close or back beside a title, drawn as the platform draws its own: on glass on iOS 26, to
 * match the system's bar buttons; elsewhere the desktop's circle, which fills while held because
 * the glyph alone shows no press.
 */
export function BarButton({
  icon,
  accessibilityLabel,
  onPress,
  disabled = false,
  glassDiameter = DIAMETER,
  testID,
}: BarButtonProps) {
  const Glass = useGlass()
  const dark = useThemeIsDark()
  const hoverColor = useTokenColor('$hoverOverlay')
  const glyph = <Icon name={icon} size="lg" color={disabled ? '$textDisabled' : '$textPrimary'} />

  if (Glass === null)
    return (
      <Button
        variant="ghost"
        size="md"
        circular
        touchTarget={ROW_TOUCH_TARGET}
        accessibilityLabel={accessibilityLabel}
        {...(testID === undefined ? {} : { testID })}
        onPress={onPress}
        disabled={disabled}
        icon={glyph}
      />
    )

  return (
    <PressArea
      accessibilityLabel={accessibilityLabel}
      {...(testID === undefined ? {} : { testID })}
      onPress={onPress}
      disabled={disabled}
      reach={touchReach(glassDiameter, ROW_TOUCH_TARGET)}
    >
      {(_pressed, hovered) => (
        <Glass size={glassDiameter} dark={dark} highlight={hovered ? hoverColor : null}>
          {glyph}
        </Glass>
      )}
    </PressArea>
  )
}
