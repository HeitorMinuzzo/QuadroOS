import { useRef, useState } from 'react'
import { Download, File, LoaderCircle, Paperclip, Plus, Trash2, Upload } from 'lucide-react'
import {
  MAX_CELL_FILES,
  MAX_FILE_SIZE,
  type CustomColumn,
  type FileAttachment,
  type Task,
} from '../../shared/domain'
import { api } from '../api'
import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

function sizeLabel(bytes: number) {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${Math.ceil(bytes / 1024)} KB`
      : `${(bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
}
export function FilesCell({
  task,
  column,
  attachments,
  onRefresh,
}: {
  task: Task
  column: CustomColumn
  attachments: FileAttachment[]
  onRefresh: () => Promise<void>
}) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const files = attachments.filter((f) => f.taskId === task.id && f.columnId === column.id)
  async function upload(selected: globalThis.File[]) {
    if (!selected.length || busy) return
    setError('')
    if (files.length + selected.length > MAX_CELL_FILES) {
      setError(`Cada célula permite até ${MAX_CELL_FILES} arquivos.`)
      return
    }
    if (selected.some((f) => f.size > MAX_FILE_SIZE)) {
      setError('Cada arquivo pode ter até 5 MB.')
      return
    }
    setBusy(true)
    let changed = false
    try {
      for (const file of selected) {
        const body = new FormData()
        body.append('file', file)
        await api(`/tasks/${task.id}/files/${column.id}`, { method: 'POST', body })
        changed = true
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível enviar os arquivos.')
    } finally {
      if (changed) {
        try {
          await onRefresh()
        } catch {
          setError(
            'Os arquivos foram enviados, mas não foi possível atualizar a lista. Reabra o quadro.',
          )
        }
      }
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  async function remove(id: string) {
    setBusy(true)
    setError('')
    try {
      await api(`/files/${id}`, { method: 'DELETE' })
      await onRefresh()
      setDeleting(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível excluir o arquivo.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Popover
      onOpenChange={() => {
        setError('')
        setDeleting(null)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="files-cell-trigger"
          aria-label={`${column.name}: ${task.title}`}
        >
          <Paperclip size={15} />
          <span>
            {files.length ? `${files.length} arquivo${files.length > 1 ? 's' : ''}` : 'Adicionar'}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="files-popover"
        aria-label={`Arquivos em ${column.name}`}
      >
        <div className="picker-heading">
          <Paperclip size={16} />
          <strong>{column.name}</strong>
          <span>{files.length}</span>
        </div>
        <p className="picker-description">
          Até 5 MB por arquivo · {MAX_CELL_FILES} arquivos por célula
        </p>
        <div className="files-list">
          {files.map((file) => (
            <div className="file-entry" key={file.id}>
              <File size={19} aria-hidden />
              <a href={`/api/files/${file.id}`} download={file.name}>
                <strong>{file.name}</strong>
                <small>{sizeLabel(file.size)} · Baixar arquivo</small>
              </a>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Excluir ${file.name}`}
                disabled={busy}
                onClick={() => setDeleting(file.id)}
              >
                <Trash2 size={15} />
              </Button>
              {deleting === file.id && (
                <div className="file-delete-confirmation">
                  <span>Excluir este arquivo?</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleting(null)}
                    disabled={busy}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    onClick={() => void remove(file.id)}
                  >
                    Excluir arquivo
                  </Button>
                </div>
              )}
            </div>
          ))}
          {!files.length && (
            <div className="files-empty">
              <Upload size={24} />
              <span>Anexe documentos, imagens e outros arquivos.</span>
            </div>
          )}
        </div>
        <div
          className={`files-upload ${dragging ? 'is-dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            void upload(Array.from(e.dataTransfer.files))
          }}
        >
          <input
            ref={input}
            type="file"
            multiple
            className="sr-only"
            disabled={busy || files.length >= MAX_CELL_FILES}
            aria-label={`Adicionar arquivos em ${column.name}`}
            onChange={(e) => void upload(Array.from(e.target.files || []))}
          />
          <Button
            type="button"
            variant="outline"
            disabled={busy || files.length >= MAX_CELL_FILES}
            onClick={() => input.current?.click()}
          >
            {busy ? <LoaderCircle size={15} className="spin" /> : <Plus size={15} />}{' '}
            {busy ? 'Enviando…' : 'Adicionar arquivos'}
          </Button>
          <span>ou arraste e solte aqui</span>
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {!!files.length && (
          <div className="picker-footer">
            <Download size={14} />
            <span>Clique no nome de um arquivo para baixar.</span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
