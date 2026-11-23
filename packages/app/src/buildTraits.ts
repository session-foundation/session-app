import { VARIANT_TRAITS, type VariantTraits } from './buildVariant'
import { requirePorts } from './ports'

/** The running build's traits, from the variant its ports report. */
export function buildTraits(): Readonly<VariantTraits> {
  return VARIANT_TRAITS[requirePorts().build.variant]
}
