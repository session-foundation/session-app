import { PageStatusRow, type PageStatusRowProps } from '@session/screens'
import { defineStory, type AnyStory } from '@session/ui/catalog'

const ignore = () => undefined

/** A transcript's width at its narrowest, where the failure's sentence and Retry wrap. */
const ROW_WIDTH = 320

/** What a transcript draws past an end while a page is read, and once one failed. */
export const PAGE_STATUS_SCENARIOS: readonly AnyStory[] = [
  defineStory<PageStatusRowProps>({
    component: 'pageStatus',
    story: 'states',
    width: ROW_WIDTH,
    sensitive: { rtl: true },
    variants: {
      loading: { state: 'loading', onRetry: ignore, testID: 'catalog-page-status-loading' },
      failed: { state: 'failed', onRetry: ignore, testID: 'catalog-page-status-failed' },
    },
    render: (props) => <PageStatusRow {...props} />,
  }),
]
