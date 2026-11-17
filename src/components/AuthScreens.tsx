import { useState, type FormEvent, type ReactNode } from 'react'
import {
  CircleAlert,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { api, json } from '../api'
import { useSession } from '../lib/session'

function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <main className="auth-screen">
      <div className="auth-column">
        <div className="auth-brand" aria-hidden="true">
          <span className="rail-brand">
            <span />
            <span />
            <span />
            <span />
          </span>
          <strong>
            quadro<span className="brand-os">OS</span>
          </strong>
        </div>
        <section className="auth-card" aria-labelledby="auth-title">
          <h1 id="auth-title">{title}</h1>
          <p className="auth-subtitle">{subtitle}</p>
          {children}
        </section>
        {footer && <p className="auth-footer">{footer}</p>}
      </div>
    </main>
  )
}

function useSubmit(action: () => Promise<void>) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível concluir. Tente novamente.')
      setBusy(false)
    }
  }
  return { busy, error, submit }
}

function Field({
  label,
  icon: Icon,
  type = 'text',
  ...input
}: { label: string; icon?: LucideIcon } & React.InputHTMLAttributes<HTMLInputElement>) {
  const [revealed, setRevealed] = useState(false)
  const secret = type === 'password'
  const classes = ['auth-input', Icon && 'has-icon', secret && 'has-reveal'].filter(Boolean)
  return (
    <label className="auth-field">
      <span>{label}</span>
      <span className={classes.join(' ')}>
        {Icon && <Icon size={17} className="auth-input-icon" aria-hidden="true" />}
        <input required type={secret && revealed ? 'text' : type} {...input} />
        {secret && (
          <button
            type="button"
            className="auth-reveal"
            aria-label={revealed ? 'Ocultar senha' : 'Mostrar senha'}
            aria-pressed={revealed}
            onClick={() => setRevealed((value) => !value)}
          >
            {revealed ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        )}
      </span>
    </label>
  )
}

function FormError({ message }: { message: string }) {
  if (!message) return null
  return (
    <p className="auth-error" role="alert">
      <CircleAlert size={16} aria-hidden="true" />
      <span>{message}</span>
    </p>
  )
}

function Submit({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button className="button primary auth-submit" type="submit" disabled={busy}>
      {busy && <LoaderCircle size={16} className="spin" />}
      {children}
    </button>
  )
}

/** First run in local mode: whoever opens the app creates the administrator account. */
export function SetupScreen() {
  const { refresh } = useSession()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { busy, error, submit } = useSubmit(async () => {
    await api('/auth/setup', { method: 'POST', body: json({ name, email, password }) })
    await refresh()
  })
  return (
    <AuthCard
      title="Configure o administrador"
      subtitle="É o primeiro acesso a este QuadroOS. Crie a conta que vai gerenciar os usuários."
    >
      <form className="auth-form" onSubmit={submit}>
        <Field
          label="Nome"
          icon={UserRound}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
        />
        <Field
          label="E-mail"
          icon={Mail}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
        <Field
          label="Senha"
          icon={LockKeyhole}
          type="password"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
        <p className="auth-hint">Use pelo menos 8 caracteres.</p>
        <FormError message={error} />
        <Submit busy={busy}>Criar administrador</Submit>
      </form>
    </AuthCard>
  )
}

export function LoginScreen() {
  const { refresh } = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { busy, error, submit } = useSubmit(async () => {
    await api('/auth/login', { method: 'POST', body: json({ email, password }) })
    await refresh()
  })
  return (
    <AuthCard
      title="Entrar"
      subtitle="Use o e-mail e a senha da sua conta do QuadroOS."
      footer="Esqueceu a senha? Peça a um administrador para redefini-la."
    >
      <form className="auth-form" onSubmit={submit}>
        <Field
          label="E-mail"
          icon={Mail}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          placeholder="voce@empresa.com.br"
          autoFocus
        />
        <Field
          label="Senha"
          icon={LockKeyhole}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        <FormError message={error} />
        <Submit busy={busy}>{busy ? 'Entrando…' : 'Entrar'}</Submit>
      </form>
    </AuthCard>
  )
}

/** Company account: the same network user and password, checked with Keycloak by the server. */
export function CompanyLoginScreen() {
  const { refresh } = useSession()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const { busy, error, submit } = useSubmit(async () => {
    await api('/auth/login', { method: 'POST', body: json({ username, password }) })
    await refresh()
  })
  return (
    <AuthCard
      title="Entrar"
      subtitle="Use o mesmo usuário e senha do computador da empresa."
      footer={
        <>
          Sem acesso? Peça à TI para incluir você no grupo <strong>QuadroOS</strong>.
        </>
      }
    >
      <form className="auth-form" onSubmit={submit}>
        <Field
          label="Usuário"
          icon={UserRound}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="nome-sobrenome"
          autoFocus
        />
        <Field
          label="Senha"
          icon={LockKeyhole}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        <FormError message={error} />
        <Submit busy={busy}>{busy ? 'Entrando…' : 'Entrar'}</Submit>
      </form>
    </AuthCard>
  )
}

/** Used after a temporary password and from the account menu. */
export function ChangePasswordForm({ onDone }: { onDone: () => void | Promise<void> }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const { busy, error, submit } = useSubmit(async () => {
    if (next !== confirm) throw new Error('A confirmação não confere com a nova senha.')
    await api('/auth/password', { method: 'POST', body: json({ current, next }) })
    await onDone()
  })
  return (
    <form className="auth-form" onSubmit={submit}>
      <Field
        label="Senha atual"
        type="password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        autoComplete="current-password"
      />
      <Field
        label="Nova senha"
        type="password"
        minLength={8}
        value={next}
        onChange={(e) => setNext(e.target.value)}
        autoComplete="new-password"
      />
      <Field
        label="Confirme a nova senha"
        type="password"
        minLength={8}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        autoComplete="new-password"
      />
      <FormError message={error} />
      <Submit busy={busy}>Salvar nova senha</Submit>
    </form>
  )
}

export function ForcedPasswordScreen() {
  const { refresh } = useSession()
  return (
    <AuthCard
      title="Crie sua senha"
      subtitle="Você entrou com uma senha temporária. Escolha uma senha pessoal para continuar."
    >
      <ChangePasswordForm onDone={refresh} />
    </AuthCard>
  )
}
