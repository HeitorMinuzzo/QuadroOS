import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { TooltipProvider } from './components/ui/tooltip'
import { Loading } from './components/ui'
import { SessionProvider } from './lib/session'
import {
  CompanyLoginScreen,
  ForcedPasswordScreen,
  LoginScreen,
  SetupScreen,
} from './components/AuthScreens'
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
import './motion.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TooltipProvider>
      <SessionProvider fallback={<Loading />}>
        {(session) =>
          session.mode === 'oidc' && !session.account ? (
            <CompanyLoginScreen />
          ) : session.mode === 'local' && !session.account ? (
            session.needsSetup ? (
              <SetupScreen />
            ) : (
              <LoginScreen />
            )
          ) : session.account?.mustChangePassword ? (
            <ForcedPasswordScreen />
          ) : (
            // A different account gets a fresh app, with nothing left from the previous one.
            <App key={session.account?.id ?? 'local'} />
          )
        }
      </SessionProvider>
    </TooltipProvider>
  </React.StrictMode>,
)
