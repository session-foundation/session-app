import './platform'

import { setPageZoom } from '@session/ui'
import { createRoot } from 'react-dom/client'

import { App } from './App'

// Before the first render, so a saved zoom is how the page first draws rather than a jump after.
window.sessionDesktop.onZoom(setPageZoom)

const container = document.getElementById('root')
if (!container) throw new Error('index.html has no #root to render into')

createRoot(container).render(<App />)
