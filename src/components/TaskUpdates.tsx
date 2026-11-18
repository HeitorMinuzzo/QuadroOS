import { useEffect, useId, useRef, useState, type ClipboardEvent, type FormEvent } from 'react'
import {
  MessageSquare,
  Send,
  LoaderCircle,
  Reply,
  ThumbsUp,
  Paperclip,
  Download,
  FileText,
  Link2,
  ExternalLink,
  ImagePlus,
  Maximize2,
  X,
} from 'lucide-react'
import type { Comment, FileAttachment, Task, Workspace } from '../../shared/domain'
import { initials, MAX_COMMENT_FILES, MAX_FILE_SIZE, MONDAY_ITEM_FILES } from '../../shared/domain'
import { api, json } from '../api'
import { Avatar } from './ui'
import { justCreated } from '../lib/motion'
import { Button } from './ui/button'
import { ImportedCommentBody } from './ImportedCommentBody'
import { useMe } from '../lib/session'
import { ImageViewer, isImageFile } from './ImageViewer'

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
  const images = files.filter(isImageFile)
  const [viewing, setViewing] = useState<number | null>(null)
  return (
    <div className="update-attachments comment-attachments">
      {files.map((file) => {
        const details = (
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
        )
        // Images open full screen; other files keep downloading (or open their link).
        return isImageFile(file) ? (
          <button
            type="button"
            key={file.id}
            title="Ver imagem"
            onClick={() => setViewing(images.indexOf(file))}
          >
            <img src={`/api/files/${file.id}/preview`} alt={file.name} loading="lazy" />
            {details}
          </button>
        ) : (
          <a
            key={file.id}
            href={`/api/files/${file.id}`}
            download={file.externalUrl ? undefined : file.name}
            target={file.externalUrl ? '_blank' : undefined}
            rel="noreferrer"
          >
            <span className="update-file-icon">
              <FileText size={22} />
            </span>
            {details}
            <Download size={15} />
          </a>
        )
      })}
      {viewing !== null && (
        <ImageViewer images={images} start={viewing} onClose={() => setViewing(null)} />
      )}
    </div>
  )
}
/** Pasted screenshots arrive as "image.png"; give them a name that says what they are. */
function pastedName(file: File, index: number) {
  if (file.name && file.name !== 'image.png') return file.name
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
  const extension = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
  return `imagem-colada-${stamp}${index ? `-${index + 1}` : ''}.${extension}`
}
function AttachmentDraft({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!file.type.startsWith('image/')) return
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])
  return (
    <li>
      {url ? (
        <img src={url} alt="" />
      ) : (
        <span className="update-file-icon" aria-hidden="true">
          <FileText size={18} />
        </span>
      )}
      <span>{file.name}</span>
      <button type="button" onClick={onRemove} aria-label={`Remover ${file.name}`}>
        <X size={14} aria-hidden="true" />
      </button>
    </li>
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
  onSubmit: (body: string, files: File[]) => Promise<boolean>
}) {
  const me = useMe()
  const [body, setBody] = useState(''),
    [files, setFiles] = useState<File[]>([]),
    [sending, setSending] = useState(false),
    [error, setError] = useState(''),
    id = useId(),
    field = useRef<HTMLTextAreaElement>(null),
    picker = useRef<HTMLInputElement>(null)
  const ready = !!body.trim() || files.length > 0
  function attach(added: File[]) {
    if (!added.length) return
    const tooBig = added.filter((file) => file.size > MAX_FILE_SIZE)
    const next = [...files, ...added.filter((file) => file.size <= MAX_FILE_SIZE)]
    setError(
      tooBig.length
        ? `${tooBig.map((file) => file.name).join(', ')}: cada arquivo pode ter até 5 MB.`
        : next.length > MAX_COMMENT_FILES
          ? `Anexe até ${MAX_COMMENT_FILES} arquivos por atualização.`
          : '',
    )
    setFiles(next.slice(0, MAX_COMMENT_FILES))
  }
  function paste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const images = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/'))
    if (!images.length) return
    event.preventDefault()
    attach(
      images.map((file, index) => new File([file], pastedName(file, index), { type: file.type })),
    )
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready || sending) return
    setSending(true)
    setError('')
    try {
      if (await onSubmit(body.trim(), files)) {
        setBody('')
        setFiles([])
        field.current?.focus()
      } else setError('Não foi possível publicar. Seu texto foi mantido para tentar novamente.')
    } catch (error) {
      setError(
        error instanceof Error && error.message
          ? `${error.message} Seu texto foi mantido para tentar novamente.`
          : 'Não foi possível publicar. Seu texto foi mantido para tentar novamente.',
      )
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
          disabled={sending}
          onPaste={paste}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
        />
        {files.length > 0 && (
          <ul className="update-drafts" aria-label="Anexos desta atualização">
            {files.map((file, index) => (
              <AttachmentDraft
                key={`${file.name}-${index}`}
                file={file}
                onRemove={() => setFiles(files.filter((_, i) => i !== index))}
              />
            ))}
          </ul>
        )}
      </div>
      <footer>
        <div>
          <Avatar person={data.people.find((person) => person.id === me)} small />
          <span>{reply ? 'Responder à conversa' : 'Publicar no item'}</span>
        </div>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            attach([...(event.target.files ?? [])])
            event.target.value = ''
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="update-attach"
          disabled={sending}
          onClick={() => picker.current?.click()}
          title="Anexar arquivo ou imagem (ou cole uma imagem no texto)"
        >
          <ImagePlus size={15} aria-hidden="true" />
          Anexar
        </Button>
        <Button type="submit" size="sm" disabled={sending || !ready}>
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
  const me = useMe()
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
  async function publish(body: string, files: File[], parentId: string | null = null) {
    setError('')
    let payload: string | FormData = json({ body, parentId })
    if (files.length) {
      payload = new FormData()
      payload.append('body', body)
      if (parentId) payload.append('parentId', parentId)
      for (const file of files) payload.append('files', file, file.name)
    }
    await api(`/tasks/${task.id}/comments`, { method: 'POST', body: payload })
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
          liked: !(comment.metadata?.localLikes as string[] | undefined)?.includes(me),
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
            liked = (comment.metadata?.localLikes as string[] | undefined)?.includes(me) || false
          return (
            <article
              className={`update-card ${justCreated(comment.createdAt) ? 'update-new' : ''}`}
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
                        onSubmit={(body, files) => publish(body, files, comment.id)}
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
function fileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}
function FileRow({ file, onView }: { file: FileAttachment; onView: () => void }) {
  const image = isImageFile(file)
  const extension = file.name.includes('.') ? file.name.split('.').pop()!.slice(0, 4) : ''
  return (
    <li>
      <a
        className="task-file"
        href={`/api/files/${file.id}`}
        download={file.externalUrl ? undefined : file.name}
        target={file.externalUrl ? '_blank' : undefined}
        rel="noreferrer"
        // Images open full screen; the link still downloads with a modifier or "Salvar link".
        onClick={(event) => {
          if (!image || event.ctrlKey || event.metaKey || event.shiftKey) return
          event.preventDefault()
          onView()
        }}
      >
        <span className="task-file-thumb" aria-hidden="true">
          {image ? (
            <img src={`/api/files/${file.id}/preview`} alt="" loading="lazy" />
          ) : file.externalUrl ? (
            <Link2 size={18} />
          ) : (
            <>
              <FileText size={18} />
              {extension && <small>{extension}</small>}
            </>
          )}
        </span>
        <span className="task-file-text">
          <strong>{file.name}</strong>
          <small>
            {file.externalUrl ? 'Link externo' : fileSize(file.size)}
            {' · '}
            {new Date(file.createdAt).toLocaleDateString('pt-BR', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })}
          </small>
        </span>
        <span className="task-file-action" aria-hidden="true">
          {file.externalUrl ? (
            <ExternalLink size={15} />
          ) : image ? (
            <Maximize2 size={15} />
          ) : (
            <Download size={15} />
          )}
        </span>
      </a>
    </li>
  )
}
export function TaskFiles({ task, data }: { task: Task; data: Workspace }) {
  const files = (data.attachments || []).filter((file) => file.taskId === task.id)
  const board = data.boards.find((b) => b.id === task.boardId)
  // Files from the board's file fields come first, one list per field; files that arrived
  // with an update close the tab.
  const sections: { key: string; title: string; files: FileAttachment[] }[] = []
  for (const file of files) {
    const key = file.commentId ? 'updates' : file.columnId || 'other'
    let section = sections.find((entry) => entry.key === key)
    if (!section) {
      const column = board?.columns.find((entry) => entry.id === file.columnId)
      section = {
        key,
        title: file.commentId
          ? 'Nas atualizações'
          : column
            ? column.name
            : file.columnId === MONDAY_ITEM_FILES
              ? 'Arquivos do item'
              : 'Outros arquivos',
        files: [],
      }
      sections.push(section)
    }
    section.files.push(file)
  }
  sections.sort((a, b) => Number(a.key === 'updates') - Number(b.key === 'updates'))
  // Arrows in the viewer follow the tab's order.
  const images = sections.flatMap((section) => section.files.filter(isImageFile))
  const [viewing, setViewing] = useState<number | null>(null)
  return (
    <section className="task-updates task-update-files" aria-label="Arquivos do item">
      <header>
        <h3>Arquivos</h3>
        <span>
          {files.length} {files.length === 1 ? 'arquivo' : 'arquivos'}
        </span>
      </header>
      {files.length ? (
        sections.map((section) => (
          <div className="task-file-group" key={section.key}>
            <h4>
              {section.key === 'updates' ? (
                <MessageSquare size={13} aria-hidden="true" />
              ) : (
                <Paperclip size={13} aria-hidden="true" />
              )}
              {section.title}
              <span>{section.files.length}</span>
            </h4>
            <ul>
              {section.files.map((file) => (
                <FileRow
                  key={file.id}
                  file={file}
                  onView={() => setViewing(images.indexOf(file))}
                />
              ))}
            </ul>
          </div>
        ))
      ) : (
        <div className="task-files-empty">
          <span aria-hidden="true">
            <Paperclip size={20} />
          </span>
          <div>
            <h4>Nenhum arquivo neste item</h4>
            <p>
              Os arquivos enviados nos campos de arquivo (aba Detalhes) e os anexos das atualizações
              aparecem aqui.
            </p>
          </div>
        </div>
      )}
      {viewing !== null && (
        <ImageViewer images={images} start={viewing} onClose={() => setViewing(null)} />
      )}
    </section>
  )
}
