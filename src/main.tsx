import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { TooltipProvider } from './components/ui/tooltip'
import './theme.css'
import './styles.css'
import './workflow.css'
import './controls.css'
import './automations.css'
import './interface.css'
import './column-values.css'
import './task-updates.css'
import './refresh.css'
import './dark.generated.css'
import './dark.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </React.StrictMode>,
)
