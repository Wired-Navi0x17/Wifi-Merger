import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// Feature 3: the material level is a root attribute the stylesheet keys off, set before the first
// paint so the saved level never flashes a different one (same idea as InitialState itself).
document.documentElement.dataset.material = window.plexo.initialState.windowMaterial

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
