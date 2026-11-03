import { useId, useRef, useState, type FormEvent } from 'react'
import {
  MessageSquare,
  Send,
  LoaderCircle,
  Reply,
  ThumbsUp,
  Paperclip,
  Download,
  FileText,
} from 'lucide-react'
import type { Comment, FileAttachment, Task, Workspace } from '../../shared/domain'
import { initials } from '../../shared/domain'
import { api, json } from '../api'
import { Avatar } from './ui'
import { Button } from './ui/button'
import { ImportedCommentBody } from './ImportedCommentBody'

function authorFor(comment: Comment, data: Workspace) {
  const local = data.people.find((person) => person.id === comment.authorId),
    source = comment.metadata?.sourceAuthor as { id?: string; name?: string } | undefined
  return source?.name && source.name !== local?.name
    ? {
        id: source.id || comment.authorId,
        name: source.name,
        initials: initials(source.name),
        email: '',
        color: '#798099',
      }
    : local
}
function CommentDate({ value }: { value: string }) {
  return (
    <time dateTime={value} title={new Date(value).toLocaleString('pt-BR')}>
      {new Date(value).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })}
    </time>
  )
}
export function UpdateAttachments({ files }: { files: FileAttachment[] }) {
  return (
    <div className="update-attachments comment-attachments">
      {files.map((file) => (
        <a
          key={file.id}
          href={`/api/files/${file.id}`}
          download={file.externalUrl ? undefined : file.name}
          target={file.externalUrl ? '_blank' : undefined}
          rel="noreferrer"
        >
          {!file.externalUrl && /\.(png|jpe?g|gif|webp)$/i.test(file.name) ? (
            <img src={`/api/files/${file.id}/preview`} alt={file.name} loading="lazy" />
          ) : (
            <span className="update-file-icon">
              <FileText size={22} />
            </span>
          )}
          <span>
            <strong>{file.name}</strong>
            <small>
              {file.externalUrl
                ? 'Link externo'
                : file.size < 1024
                  ? `${file.size} B`
                  : `${Math.round(file.size / 1024)} KB`}
            </small>
          </span>
          <Download size={15} />
        </a>
      ))}
    </div>
  )
}
function UpdateComposer({
  data,
  label = 'Novo comentário',
  placeholder = 'Escreva uma atualização para sua equipe…',
  reply = false,
  onSubmit,
}: {
  data: Workspace
  label?: string
  placeholder?: string
  reply?: boolean
  onSubmit: (body: string) => Promise<boolean>
}) {
  const [body, setBody] = useState(''),
    [sending, setSending] = useState(false),
    [error, setError] = useState(''),
    id = useId(),
    field = useRef<HTMLTextAreaElement>(null)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!body.trim() || sending) return
    setSending(true)
    setError('')
    try {
      if (await onSubmit(body.trim())) {
        setBody('')
        field.current?.focus()
      } else setError('Não foi possível publicar. Seu texto foi mantido para tentar novamente.')
    } catch {
      setError('Não foi possível publicar. Seu texto foi mantido para tentar novamente.')
    } finally {
      setSending(false)
    }
  }
  return (
    <form
      className={`update-composer ${reply ? 'is-reply' : ''}`}
      onSubmit={(event) => void submit(event)}
    >
      <div className="update-composer-field">
        <label className="sr-only" htmlFor={id}>
          {label}
        </label>
        <textarea
          id={id}
          ref={field}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={placeholder}
          rows={reply ? 2 : 3}
          maxLength={5000}
          required
          disabled={sending}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
        />
      </div>
      <footer>
        <div>
          <Avatar person={data.people.find((person) => person.id === 'person-you')} small />
          <span>{reply ? 'Responder à conversa' : 'Publicar no item'}</span>
        </div>
        <Button type="submit" size="sm" disabled={sending || !body.trim()}>
          {sending ? <LoaderCircle className="spin" /> : <Send size={14} />}Enviar
        </Button>
      </footer>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </form>
  )
}
export function TaskUpdates({
  task,
  data,
  onRefresh,
  onOpenTask,
}: {
  task: Task
  data: Workspace
  onRefresh: () => Promise<void>
  onOpenTask: (id: string) => void
}) {
  const comments = data.comments.filter((comment) => comment.taskId === task.id),
    byId = new Map(comments.map((comment) => [comment.id, comment]))
  const [replyTo, setReplyTo] = useState<string | null>(null),
    [liking, setLiking] = useState<string | null>(null),
    [error, setError] = useState('')
  function rootId(comment: Comment) {
    let current = comment
    const seen = new Set([comment.id])
    while (current.parentId && byId.has(current.parentId) && !seen.has(current.parentId)) {
      seen.add(current.parentId)
      current = byId.get(current.parentId)!
    }
    return current.id
  }
  const roots = comments
    .filter((comment) => rootId(comment) === comment.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  async function publish(body: string, parentId: string | null = null) {
    setError('')
    await api(`/tasks/${task.id}/comments`, { method: 'POST', body: json({ body, parentId }) })
    try {
      await onRefresh()
    } catch {
      setError('Atualização publicada. Recarregue o painel para atualizar a lista.')
    }
    return true
  }
  async function like(comment: Comment) {
    if (liking) return
    setLiking(comment.id)
    setError('')
    try {
      await api(`/comments/${comment.id}/like`, {
        method: 'PUT',
        body: json({
          liked: !(comment.metadata?.localLikes as string[] | undefined)?.includes('person-you'),
        }),
      })
      await onRefresh()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível salvar sua curtida.')
    } finally {
      setLiking(null)
    }
  }
  return (
    <section className="task-updates" aria-label="Atualizações do item">
      <UpdateComposer data={data} onSubmit={publish} />
      <div className="updates-feed-heading">
        <h3>{roots.length ? 'Todas as atualizações' : 'Comece uma conversa'}</h3>
        <span>
          {roots.length} {roots.length === 1 ? 'atualização' : 'atualizações'}
        </span>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!roots.length && (
        <div className="updates-empty">
          <span>
            <MessageSquare size={27} />
          </span>
          <h4>O próximo passo começa aqui</h4>
          <p>Compartilhe novidades, decisões e dúvidas sobre este item.</p>
        </div>
      )}
      <div className="updates-feed">
        {roots.map((comment) => {
          const author = authorFor(comment, data),
            replies = comments
              .filter((entry) => entry.id !== comment.id && rootId(entry) === comment.id)
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
            likes =
              (Array.isArray(comment.metadata?.likes) ? comment.metadata.likes.length : 0) +
              (Array.isArray(comment.metadata?.localLikes)
                ? comment.metadata.localLikes.length
                : 0),
            liked =
              (comment.metadata?.localLikes as string[] | undefined)?.includes('person-you') ||
              false
          return (
            <article
              className="update-card"
              key={comment.id}
              aria-label={`Atualização de ${author?.name || 'Pessoa removida'}`}
            >
              <header className="update-card-header">
                <Avatar person={author} />
                <div>
                  <strong>{author?.name || 'Pessoa removida'}</strong>
                  <CommentDate value={comment.createdAt} />
                </div>
              </header>
              <div className="update-card-body">
                <ImportedCommentBody comment={comment} tasks={data.tasks} onOpenTask={onOpenTask} />
                <UpdateAttachments
                  files={(data.attachments || []).filter((file) => file.commentId === comment.id)}
                />
              </div>
              <div className="update-card-meta">
                {!!likes && (
                  <span>
                    <ThumbsUp size={13} />
                    {likes} {likes === 1 ? 'curtida' : 'curtidas'}
                  </span>
                )}
                {!!replies.length && (
                  <span>
                    {replies.length} {replies.length === 1 ? 'resposta' : 'respostas'}
                  </span>
                )}
              </div>
              <footer className="update-card-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-pressed={liked}
                  disabled={liking === comment.id}
                  onClick={() => void like(comment)}
                >
                  <ThumbsUp size={16} />
                  {liked ? 'Curtido' : 'Curtir'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={replyTo === comment.id}
                  onClick={() => {
                    setReplyTo(comment.id)
                    requestAnimationFrame(() =>
                      document
                        .getElementById(`reply-${comment.id}`)
                        ?.querySelector('textarea')
                        ?.focus(),
                    )
                  }}
                >
                  <Reply size={17} />
                  Responder
                </Button>
              </footer>
              {(replies.length > 0 || replyTo === comment.id) && (
                <div className="update-replies">
                  {replies.map((reply) => {
                    const person = authorFor(reply, data)
                    return (
                      <div className="update-reply" key={reply.id}>
                        <Avatar person={person} small />
                        <div>
                          <header>
                            <strong>{person?.name || 'Pessoa removida'}</strong>
                            <CommentDate value={reply.createdAt} />
                          </header>
                          <ImportedCommentBody
                            comment={reply}
                            tasks={data.tasks}
                            onOpenTask={onOpenTask}
                          />
                          <UpdateAttachments
                            files={(data.attachments || []).filter(
                              (file) => file.commentId === reply.id,
                            )}
                          />
                        </div>
                      </div>
                    )
                  })}
                  {replyTo === comment.id && (
                    <div id={`reply-${comment.id}`} className="update-reply-editor">
                      <UpdateComposer
                        data={data}
                        label="Escrever resposta"
                        placeholder="Escreva uma resposta…"
                        reply
                        onSubmit={(body) => publish(body, comment.id)}
                      />
                      <Button variant="ghost" size="sm" onClick={() => setReplyTo(null)}>
                        Cancelar resposta
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
export function TaskFiles({ task, data }: { task: Task; data: Workspace }) {
  const files = (data.attachments || []).filter((file) => file.taskId === task.id)
  return (
    <section className="task-updates task-update-files" aria-label="Arquivos do item">
      <header>
        <h3>Arquivos deste item</h3>
        <span>
          {files.length} {files.length === 1 ? 'arquivo' : 'arquivos'}
        </span>
      </header>
      {files.length ? (
        <UpdateAttachments files={files} />
      ) : (
        <div className="updates-empty">
          <span>
            <Paperclip size={27} />
          </span>
          <h4>Nenhum arquivo por aqui</h4>
          <p>Os anexos das colunas e das conversas aparecem juntos nesta aba.</p>
        </div>
      )}
    </section>
  )
}
