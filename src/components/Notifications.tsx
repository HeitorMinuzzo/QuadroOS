import { useCallback, useEffect, useState } from 'react'
import {
  AtSign,
  Bell,
  CheckCheck,
  ChevronRight,
  CircleCheck,
  MessageSquare,
  UserPlus,
  Workflow,
} from 'lucide-react'
import type { AppNotification, Board, Task, TaskPanelTab } from '../../shared/domain'
import { api, json } from '../api'
import { EmptyState } from './ui'
import { Button } from './ui/button'

interface NotificationList {
  items: AppNotification[]
  unread: number
}
const EMPTY: NotificationList = { items: [], unread: 0 }

/** The signed-in person's notifications, refreshed every minute and when the window regains focus. */
export function useNotifications() {
  const [list, setList] = useState<NotificationList>(EMPTY)
  const refresh = useCallback(async () => {
    try {
      setList(await api<NotificationList>('/notifications'))
    } catch {
      /* Offline or signed out: keep what is shown. */
    }
  }, [])
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 60_000)
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])
  const markRead = useCallback(async (ids?: string[]) => {
    const now = new Date().toISOString()
    setList((previous) => {
      const items = previous.items.map((item) =>
        !ids || ids.includes(item.id) ? { ...item, readAt: item.readAt || now } : item,
      )
      return { items, unread: items.filter((item) => !item.readAt).length }
    })
    try {
      await api('/notifications/read', { method: 'POST', body: json(ids ? { ids } : {}) })
    } catch {
      /* The next refresh shows the server's state. */
    }
  }, [])
  return { ...list, refresh, markRead }
}

const KIND_ICONS: Record<AppNotification['kind'], typeof Bell> = {
  assigned: UserPlus,
  comment: MessageSquare,
  reply: AtSign,
  automation: Workflow,
}
function timeAgo(value: string) {
  const minutes = Math.round((Date.now() - Date.parse(value)) / 60_000)
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `há ${hours} h`
  const days = Math.round(hours / 24)
  if (days < 7) return `há ${days} ${days === 1 ? 'dia' : 'dias'}`
  return new Date(value).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

export function NotificationsPanel({
  items,
  unread,
  overdue,
  boards,
  onMarkRead,
  onOpen,
}: {
  items: AppNotification[]
  unread: number
  overdue: Task[]
  boards: Board[]
  onMarkRead: (ids?: string[]) => void
  onOpen: (boardId: string, taskId: string, tab: TaskPanelTab) => void
}) {
  return (
    <div className="notifications-panel">
      <section aria-labelledby="notifications-recent">
        <header className="notifications-section-heading">
          <h3 id="notifications-recent">Recentes{unread > 0 && <span>{unread} não lidas</span>}</h3>
          {unread > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onMarkRead()}>
              <CheckCheck />
              Marcar todas como lidas
            </Button>
          )}
        </header>
        {items.length ? (
          <div className="notification-list">
            {items.map((item) => {
              const Icon = KIND_ICONS[item.kind] || Bell
              return (
                <button
                  key={item.id}
                  className={item.readAt ? '' : 'is-unread'}
                  onClick={() => {
                    if (!item.readAt) onMarkRead([item.id])
                    if (item.boardId && item.taskId)
                      onOpen(
                        item.boardId,
                        item.taskId,
                        item.kind === 'comment' || item.kind === 'reply' ? 'updates' : 'details',
                      )
                  }}
                >
                  <span className={`notification-icon kind-${item.kind}`}>
                    <Icon size={17} />
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {item.body && <>{item.body} · </>}
                      {timeAgo(item.createdAt)}
                    </small>
                  </span>
                  {!item.readAt && <i className="notification-unread" aria-label="Não lida" />}
                  <ChevronRight size={16} />
                </button>
              )
            })}
          </div>
        ) : (
          <p className="notifications-empty">
            Nada novo. Aqui aparecem atribuições, comentários nas suas tarefas e avisos de
            automações.
          </p>
        )}
      </section>
      <section aria-labelledby="notifications-overdue">
        <header className="notifications-section-heading">
          <h3 id="notifications-overdue">
            Atrasadas{overdue.length > 0 && <span>{overdue.length}</span>}
          </h3>
        </header>
        {overdue.length ? (
          <div className="notification-list">
            {overdue.map((t) => (
              <button key={t.id} onClick={() => onOpen(t.boardId, t.id, 'details')}>
                <span className="notification-icon">
                  <Bell size={17} />
                </span>
                <span>
                  <strong>{t.title}</strong>
                  <small>
                    {boards.find((b) => b.id === t.boardId)?.name} · Prazo{' '}
                    {new Date(`${t.dueDate}T12:00:00`).toLocaleDateString('pt-BR')}
                  </small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<CircleCheck size={30} />}
            title="Tudo em dia por aqui."
            description="Nenhuma tarefa com prazo vencido. Um respiro para o próximo passo."
          />
        )}
      </section>
    </div>
  )
}
