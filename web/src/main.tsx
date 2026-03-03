import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

import { initSuperTokens } from './config/supertokens'

const root = document.getElementById('root')!

if (!initSuperTokens()) {
    ReactDOM.createRoot(root).render(
        <div style={{ padding: '2rem', fontFamily: 'sans-serif', textAlign: 'center' }}>
        <h1>MovieShaker</h1>
        <p>Auth failed to load. Please refresh the page. If this continues, check the console for errors.</p>
        </div>,
    )
} else {
    ReactDOM.createRoot(root).render(
        <React.StrictMode>
            <App />
        </React.StrictMode>,
    )
}
