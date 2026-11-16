import type { QuoteLabels } from '../quotePreview'

/**
 * The catalogue's English for a quote, which the quote's stories and tests are drawn with: the
 * apps fill `QuoteLabels` from the catalogue itself, which `ui` cannot import.
 */
export const QUOTE_LABELS: QuoteLabels = {
  image: 'Image',
  gif: 'GIF',
  video: 'Video',
  audio: 'Audio',
  voice: 'Voice Message',
  file: 'Document',
  andMore: (count) => `+${String(count)}`,
  notFound: 'Original message not found',
}
