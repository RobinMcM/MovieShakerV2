import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

import { initSuperTokens } from './config/supertokens'

const root = document.getElementById('root')!

async function bootstrap() {
    await initSuperTokens()
    ReactDOM.createRoot(root).render(
        <React.StrictMode>
            <App />
        </React.StrictMode>,
    )
}

bootstrap()
