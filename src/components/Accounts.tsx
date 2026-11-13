import { useEffect, useState, type FormEvent } from 'react'
import { Building2, Copy, KeyRound, LogOut, UserPlus, Users } from 'lucide-react'
import { api, json } from '../api'
import type { AccountInfo, AccountRole, Person } from '../../shared/domain'
import { useSession } from '../lib/session'
import { Avatar, Modal } from './ui'
import { ChangePasswordForm } from './AuthScreens'
import { FieldSelect } from './FieldSelect'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

export const ROLE_NAMES: Record<AccountRole, string> = {
  admin: 'Administrador',
  member: 'Membro',
  viewer: 'Leitor',
}
const ROLE_OPTIONS = (['admin', 'member', 'viewer'] as const).map((value) => ({
  value,
  label: ROLE_NAMES[value],
}))

/** The avatar in the top bar. With sign-in on it opens the account menu. */
export function AccountMenu({
  person,
  onUsers,
  onSectors,
  onPassword,
}: {
  person?: Person
  onUsers: () => void
  onSectors: () => void
  onPassword: () => void
}) {
  const { session, refresh } = useSession()
  const account = session.account
  if (!account) return <Avatar person={person} small />
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="account-trigger" aria-label={`Conta: ${account.name}`}>
          <Avatar person={person} small />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="account-menu">
        <DropdownMenuLabel className="account-menu-identity">
          <strong>{account.name}</strong>
          <span>{account.email}</span>
          <span>{ROLE_NAMES[account.role]}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onPassword}>
          <KeyRound />
          Alterar senha
        </DropdownMenuItem>
        {account.role === 'admin' && (
          <DropdownMenuItem onSelect={onUsers}>
            <Users />
            Usuários
          </DropdownMenuItem>
        )}
        {account.role === 'admin' && (
          <DropdownMenuItem onSelect={onSectors}>
            <Building2 />
            Setores
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            await api('/auth/logout', { method: 'POST' }).catch(() => undefined)
            await refresh()
          }}
        >
          <LogOut />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function PasswordDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="Alterar senha"
      subtitle="Outros dispositivos conectados serão desconectados."
      onClose={onClose}
    >
      <div className="account-dialog-body">
        <ChangePasswordForm onDone={onClose} />
      </div>
    </Modal>
  )
}

/** Admins invite people, change roles, deactivate accounts and reset passwords. */
export function UsersDialog({
  onClose,
  onChanged,
}: {
  onClose: () => void
  onChanged: () => void
}) {
  const { session } = useSession()
  const [accounts, setAccounts] = useState<AccountInfo[] | null>(null)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<AccountRole>('member')
  const [busy, setBusy] = useState(false)
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null)

  const load = async () => {
    try {
      setAccounts(await api<AccountInfo[]>('/accounts'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível carregar os usuários.')
    }
  }
  useEffect(() => {
    void load()
  }, [])

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
      await load()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível concluir.')
    } finally {
      setBusy(false)
    }
  }
  const invite = (event: FormEvent) => {
    event.preventDefault()
    void run(async () => {
      const result = await api<{ account: AccountInfo; temporaryPassword: string }>('/accounts', {
        method: 'POST',
        body: json({ name, email, role }),
      })
      setSecret({ email: result.account.email, password: result.temporaryPassword })
      setName('')
      setEmail('')
      setRole('member')
    })
  }

  return (
    <Modal
      title="Usuários"
      subtitle="Quem pode entrar no QuadroOS e o que cada pessoa pode fazer."
      onClose={onClose}
      className="users-modal"
    >
      <div className="account-dialog-body">
        {secret && (
          <div className="temporary-password" role="status">
            <p>
              Senha temporária de <strong>{secret.email}</strong>. Ela aparece só agora; a pessoa
              cria a própria senha no primeiro acesso.
            </p>
            <div>
              <code>{secret.password}</code>
              <button
                type="button"
                className="button secondary"
                onClick={() => void navigator.clipboard?.writeText(secret.password)}
              >
                <Copy size={15} />
                Copiar
              </button>
            </div>
          </div>
        )}
        <form className="invite-form" onSubmit={invite}>
          <h3>
            <UserPlus size={16} />
            Adicionar pessoa
          </h3>
          <label>
            <span>Nome</span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
          </label>
          <label>
            <span>E-mail</span>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={200}
            />
          </label>
          <div className="invite-role">
            <span>Papel</span>
            <FieldSelect
              label="Papel da nova conta"
              value={role}
              onChange={(value) => setRole(value as AccountRole)}
              options={ROLE_OPTIONS}
            />
          </div>
          <button className="button primary" type="submit" disabled={busy}>
            Criar conta
          </button>
        </form>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <ul className="account-list" aria-label="Contas">
          {(accounts ?? []).map((account) => (
            <li key={account.id} className={account.active ? '' : 'inactive'}>
              <div className="account-list-who">
                <strong>
                  {account.name}
                  {account.id === session.account?.id && <small> (você)</small>}
                </strong>
                <span>{account.email}</span>
                <span>
                  {!account.active
                    ? 'Desativada'
                    : account.mustChangePassword
                      ? 'Aguardando primeiro acesso'
                      : account.lastLoginAt
                        ? `Último acesso em ${new Date(account.lastLoginAt).toLocaleDateString('pt-BR')}`
                        : 'Nunca entrou'}
                </span>
              </div>
              <FieldSelect
                label={`Papel de ${account.name}`}
                value={account.role}
                disabled={busy || !account.active}
                onChange={(value) =>
                  void run(async () => {
                    await api(`/accounts/${account.id}`, {
                      method: 'PATCH',
                      body: json({ role: value }),
                    })
                  })
                }
                options={ROLE_OPTIONS}
              />
              <div className="account-list-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy || !account.active}
                  onClick={() =>
                    void run(async () => {
                      const result = await api<{ temporaryPassword: string }>(
                        `/accounts/${account.id}/reset-password`,
                        { method: 'POST' },
                      )
                      setSecret({ email: account.email, password: result.temporaryPassword })
                    })
                  }
                >
                  Redefinir senha
                </button>
                {account.id !== session.account?.id && (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api(`/accounts/${account.id}`, {
                          method: 'PATCH',
                          body: json({ active: !account.active }),
                        })
                      })
                    }
                  >
                    {account.active ? 'Desativar' : 'Reativar'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  )
}
