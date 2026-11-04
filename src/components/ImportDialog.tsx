import { useEffect, useRef, useState, type DragEvent } from 'react'
import {
  Upload,
  ArrowRight,
  ArrowLeft,
  FileSpreadsheet,
  Check,
  CircleCheck,
  Link2,
  AlertCircle,
  Clock3,
  FolderInput,
  LoaderCircle,
  X,
  Plus,
  Download,
} from 'lucide-react'
import { api, json } from '../api'
import type {
  Workspace,
  ImportPreview,
  ImportMapping,
  ImportField,
  ImportCoverage,
  MondayBatch,
} from '../../shared/domain'
import { guessImportMapping } from '../../shared/imports'
import { COLUMN_TYPE_NAMES, columnList } from '../../shared/columns'
import { Modal, IconButton } from './ui'
import { FieldSelect } from './FieldSelect'

const fields: { value: ImportField; label: string }[] = [
  { value: 'title', label: 'Título da tarefa' },
  { value: 'group', label: 'Grupo' },
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Prioridade' },
  { value: 'dueDate', label: 'Prazo' },
  { value: 'owner', label: 'Responsável' },
  { value: 'description', label: 'Descrição' },
  { value: 'externalId', label: 'Identificador de origem' },
  { value: 'custom', label: 'Nova coluna de texto' },
  { value: 'ignore', label: 'Não importar' },
]
interface Result {
  boardId: string
  imported: number
  skipped: number
  warnings: string[]
  reportId?: string
  subitemsImported?: number
  commentsImported?: number
  filesImported?: number
  automationsImported?: number
  coverage?: ImportCoverage[]
}
export function ImportDialog({
  data,
  activeBoardId,
  onClose,
  onApplied,
  onOpenBoard,
}: {
  data: Workspace
  activeBoardId: string
  onClose: () => void
  onApplied: () => Promise<void>
  onOpenBoard: (id: string) => void
}) {
  const [mode, setMode] = useState<'file' | 'monday' | 'history'>('file')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [mapping, setMapping] = useState<ImportMapping>({})
  const [destination, setDestination] = useState('new')
  const [importPeople, setImportPeople] = useState(true)
  const [importAutomations, setImportAutomations] = useState(true)
  const sessionRef = useRef<string | null>(null)
  useEffect(
    () => () => {
      if (sessionRef.current)
        void api(`/monday/previews/${sessionRef.current}`, { method: 'DELETE' }).catch(
          () => undefined,
        )
    },
    [],
  )
  const [boardName, setBoardName] = useState('')
  const [token, setToken] = useState('')
  const [boards, setBoards] = useState<{ id: string; name: string; archived?: boolean }[]>([])
  const [mondayId, setMondayId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [batch, setBatch] = useState<MondayBatch | null>(null)
  const [showBatch, setShowBatch] = useState(false)
  const runningBatchId = batch?.status === 'running' ? batch.id : null
  useEffect(() => {
    if (mode !== 'monday') return
    let closed = false
    void api<{ batch: MondayBatch | null }>('/monday/batch')
      .then(({ batch: latest }) => {
        if (closed || !latest) return
        setBatch((current) => current ?? latest)
        if (latest.status === 'running') setShowBatch(true)
        else if (latest.results.some((item) => item.boardId)) return onApplied()
      })
      .catch(() => undefined)
    return () => {
      closed = true
    }
  }, [mode, onApplied])
  useEffect(() => {
    if (!runningBatchId) return
    let closed = false
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const { batch: latest } = await api<{ batch: MondayBatch | null }>('/monday/batch')
        if (closed) return
        if (!latest) {
          setBatch(
            (current) =>
              current && {
                ...current,
                status: 'failed',
                error:
                  'A execução não está mais disponível. Inicie um novo lote para retomar a importação.',
              },
          )
          void onApplied().catch(() =>
            setError('Atualize a página para ver os quadros já gravados.'),
          )
          return
        }
        setBatch(latest)
        setError('')
        if (latest.status === 'running') timer = setTimeout(poll, 1000)
        else
          void onApplied().catch(() =>
            setError('Atualize a página para ver os quadros importados.'),
          )
      } catch {
        if (closed) return
        setError(
          'O servidor está indisponível. A tela mostra o último progresso recebido e vai tentar reconectar.',
        )
        timer = setTimeout(poll, 2500)
      }
    }
    timer = setTimeout(poll, 1000)
    return () => {
      closed = true
      clearTimeout(timer)
    }
  }, [runningBatchId, onApplied])
  const fileRef = useRef<HTMLInputElement>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const fail = (e: unknown) => {
    setError(e instanceof Error ? e.message : 'Não foi possível importar.')
    requestAnimationFrame(() => errorRef.current?.focus())
  }
  const acceptPreview = (value: ImportPreview) => {
    if (sessionRef.current && sessionRef.current !== value.sessionId)
      void api(`/monday/previews/${sessionRef.current}`, { method: 'DELETE' }).catch(
        () => undefined,
      )
    sessionRef.current = value.sessionId || null
    setPreview(value)
    setMapping(guessImportMapping(value))
    setBoardName(value.source === 'file' ? value.name.replace(/\.[^.]+$/, '') : value.name)
    setError('')
  }
  async function upload(file?: File) {
    if (!file) return
    setError('')
    if (file.size > 5 * 1024 * 1024) {
      fail(new Error('Escolha um arquivo de até 5 MB.'))
      return
    }
    setBusy(true)
    try {
      const body = new FormData()
      body.append('file', file)
      acceptPreview(await api<ImportPreview>('/imports/preview', { method: 'POST', body }))
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }
  async function connect() {
    setBusy(true)
    setError('')
    try {
      const list = await api<typeof boards>('/monday/boards', {
        method: 'POST',
        body: json({ token }),
      })
      setBoards(list)
      setMondayId(list[0]?.id || '')
      if (!list.length) fail(new Error('Nenhum quadro acessível foi encontrado para este token.'))
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }
  async function fetchBoard() {
    setBusy(true)
    setError('')
    try {
      acceptPreview(
        await api<ImportPreview>('/monday/preview', {
          method: 'POST',
          body: json({ token, boardId: mondayId }),
        }),
      )
      setToken('')
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }
  async function startBatch(resumeId?: string) {
    setBusy(true)
    setError('')
    try {
      const job = await api<MondayBatch>('/monday/batch', {
        method: 'POST',
        body: json({ token, resumeId }),
      })
      setBatch(job)
      setShowBatch(true)
      setToken('')
      setBoards([])
      setMondayId('')
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }
  async function apply() {
    setBusy(true)
    setError('')
    try {
      const imported = await api<Result>('/imports/apply', {
        method: 'POST',
        body: json({
          preview: preview?.sessionId ? { sessionId: preview.sessionId } : preview,
          mapping,
          importPeople,
          importAutomations,
          ...(destination === 'new' ? { boardName } : { boardId: destination }),
        }),
      })
      setResult(imported)
      sessionRef.current = null
      await onApplied()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }
  const selectedFields = Object.values(mapping).filter((f) => !['custom', 'ignore'].includes(f))
  const duplicated = selectedFields.length !== new Set(selectedFields).size
  const canImport =
    selectedFields.includes('title') && !duplicated && (destination !== 'new' || boardName.trim())
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (!busy) void upload(e.dataTransfer.files[0])
  }
  return (
    <Modal
      title="Importar dados"
      subtitle="Traga tarefas de uma planilha ou conecte um quadro do monday.com."
      onClose={onClose}
      className="import-modal"
    >
      {showBatch && batch ? (
        <section className="grid gap-4 px-6 py-5" aria-label="Importação em lote do Monday">
          <div role="status">
            <h3>
              {batch.status === 'running'
                ? 'Importação em andamento'
                : batch.status !== 'complete'
                  ? 'Importação interrompida'
                  : 'Importação concluída'}
            </h3>
            {batch.total === null ? (
              batch.status === 'running' && <p>Buscando quadros no Monday…</p>
            ) : (
              <p>
                {batch.results.length} de {batch.total} quadros processados
                {batch.status !== 'running' &&
                  ` · ${batch.results.filter((item) => item.error).length} com falha`}
              </p>
            )}
            {batch.currentBoard && <p>Importando {batch.currentBoard}…</p>}
            {batch.status === 'running' && (
              <p>Você pode fechar a janela e acompanhar o lote na aba Monday.</p>
            )}
          </div>
          {batch.status === 'running' && (
            <progress
              className="w-full accent-primary"
              aria-label="Progresso da importação"
              max={batch.total || 1}
              value={batch.total === null ? undefined : batch.results.length}
            />
          )}
          {(batch.error || error) && (
            <p className="form-error" role="alert">
              {batch.error || error}
            </p>
          )}
          {batch.total === 0 && <p>Nenhum quadro acessível foi encontrado para este token.</p>}
          {batch.results.length > 0 && (
            <ul className="grid gap-2">
              {batch.results.map((item) => (
                <li className="notice" key={item.sourceBoardId}>
                  <div className="grid min-w-0 gap-1">
                    <strong className="break-words">{item.name}</strong>
                    {item.error ? (
                      <p>{item.error}</p>
                    ) : (
                      <>
                        <p>
                          {item.imported} itens importados · {item.skipped} já existentes
                        </p>
                        {!!item.warnings?.length && <p>{item.warnings.join(' ')}</p>}
                        {item.reportId && (
                          <a href={`/api/imports/${item.reportId}/report`} download>
                            Baixar relatório
                          </a>
                        )}
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {batch.status !== 'running' && (
            <footer className="modal-footer">
              <button
                className="button secondary"
                onClick={() => {
                  setShowBatch(false)
                  setError('')
                }}
              >
                Voltar às opções de importação
              </button>
            </footer>
          )}
        </section>
      ) : result ? (
        <div className="import-success">
          <span className="success-symbol">
            <Check size={30} />
          </span>
          <h3>Pronto para um novo começo.</h3>
          <p>
            <strong>
              {result.imported} {result.reportId ? 'itens importados' : 'tarefas importadas'}
            </strong>
            {result.skipped > 0 &&
              ` · ${result.skipped} linhas ignoradas (vazias ou já importadas)`}
          </p>
          {result.reportId && (
            <>
              <div className="import-resource-counts">
                <span>{result.subitemsImported || 0} subitens</span>
                <span>{result.commentsImported || 0} comentários</span>
                <span>{result.filesImported || 0} arquivos</span>
                <span>{result.automationsImported || 0} automações</span>
              </div>
              <a
                className="button secondary"
                href={`/api/imports/${result.reportId}/report`}
                download
              >
                <Download size={15} />
                Baixar relatório e dados originais
              </a>
              {!!result.coverage?.some(
                (entry) => entry.mode === 'snapshot' || entry.mode === 'unavailable',
              ) && (
                <p className="import-review-note">
                  Alguns recursos exigem revisão. Confira o relatório para ver o que foi convertido,
                  preservado como referência ou não pôde ser copiado.
                </p>
              )}
            </>
          )}
          {result.warnings.length > 0 && (
            <div className="notice">
              <strong>Detalhes da importação</strong>
              <ul>
                {result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          <button
            className="button primary"
            onClick={() => {
              onOpenBoard(result.boardId)
              onClose()
            }}
          >
            Abrir meu quadro
            <ArrowRight size={16} />
          </button>
        </div>
      ) : (
        <>
          {!preview && (
            <div className="import-tabs view-tabs" role="tablist" aria-label="Origem da importação">
              {(
                [
                  { id: 'file', icon: FileSpreadsheet, label: 'Arquivo' },
                  { id: 'monday', icon: Link2, label: 'monday.com' },
                  { id: 'history', icon: Clock3, label: 'Histórico' },
                ] as const
              ).map(({ id, icon: Icon, label }) => (
                <button
                  role="tab"
                  aria-selected={mode === id}
                  key={id}
                  className={mode === id ? 'active' : ''}
                  disabled={busy}
                  onClick={() => {
                    setMode(id)
                    setError('')
                  }}
                >
                  <Icon size={16} />
                  {label}
                </button>
              ))}
            </div>
          )}
          {error && (
            <p className="form-error" role="alert" ref={errorRef} tabIndex={-1}>
              <AlertCircle size={17} />
              {error}
            </p>
          )}
          {!preview && mode === 'file' && (
            <div className="import-source">
              <div
                className={`dropzone ${dragging ? 'dragging' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
              >
                <span className="upload-symbol">
                  {busy ? <LoaderCircle size={25} className="spin" /> : <Upload size={25} />}
                </span>
                <h3>{busy ? 'Preparando a prévia…' : 'Um arquivo. Muitas possibilidades.'}</h3>
                <p>Arraste sua planilha até aqui ou escolha um arquivo.</p>
                <button
                  className="button primary"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                >
                  Selecionar arquivo
                  <ArrowRight size={15} />
                </button>
                <span className="file-hint">CSV ou Excel (.xlsx) · Até 5 MB e 2.000 linhas</span>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.xlsx"
                  aria-label="Arquivo para importação"
                  className="sr-only"
                  onChange={(e) => void upload(e.target.files?.[0])}
                  disabled={busy}
                />
              </div>
              <div className="import-tip">
                <FileSpreadsheet size={22} />
                <div>
                  <strong>Vindo do monday?</strong>
                  <p>
                    No seu quadro, abra o menu de três pontos e escolha “Exportar quadro para
                    Excel”. Depois, envie o arquivo aqui.
                  </p>
                </div>
              </div>
              <p className="muted small-text">
                Você confere as colunas e uma prévia antes de importar qualquer dado.
              </p>
            </div>
          )}
          {!preview && mode === 'monday' && (
            <div className="import-source">
              <div className="monday-connect">
                <span className="connect-symbol">
                  <Link2 size={24} />
                </span>
                <h3>Conecte seu monday.com</h3>
                <p>Importe todos os quadros acessíveis ou prepare um quadro individualmente.</p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    void connect()
                  }}
                >
                  <label htmlFor="monday-token">Token de acesso</label>
                  <input
                    id="monday-token"
                    type="password"
                    value={token}
                    onChange={(e) => {
                      setToken(e.target.value)
                      setBoards([])
                    }}
                    placeholder="Cole seu token de API"
                    autoComplete="off"
                    required
                    minLength={10}
                    maxLength={5000}
                    disabled={busy}
                  />
                  <span className="field-hint">
                    O token é usado apenas nesta importação e não é salvo.
                  </span>
                  {!boards.length && (
                    <button
                      className="button primary"
                      type="submit"
                      disabled={busy || token.length < 10}
                    >
                      {busy ? <LoaderCircle size={16} className="spin" /> : <Link2 size={16} />}
                      Buscar meus quadros
                    </button>
                  )}
                </form>
                {boards.length > 0 && (
                  <div className="board-selection">
                    {batch?.status === 'interrupted' && (
                      <button
                        type="button"
                        className="button primary"
                        disabled={busy}
                        onClick={() => void startBatch(batch.id)}
                      >
                        Retomar importação em lote
                      </button>
                    )}
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy}
                      onClick={() => void startBatch()}
                    >
                      <FolderInput size={16} />
                      Importar todos os quadros ({boards.length})
                    </button>
                    <p className="field-hint">
                      O lote usa o mapeamento automático e atualiza os quadros que já foram
                      importados.
                    </p>
                    <label htmlFor="monday-board">Quadro de origem</label>
                    <FieldSelect
                      id="monday-board"
                      label="Quadro de origem"
                      value={mondayId}
                      onChange={setMondayId}
                      disabled={busy}
                      options={boards.map((b) => ({
                        value: b.id,
                        label: b.archived ? `${b.name} (arquivado)` : b.name,
                      }))}
                    />
                    <button
                      className="button primary"
                      onClick={() => void fetchBoard()}
                      disabled={busy || !mondayId}
                    >
                      {busy ? (
                        <LoaderCircle size={16} className="spin" />
                      ) : (
                        <ArrowRight size={16} />
                      )}
                      Preparar importação
                    </button>
                  </div>
                )}
                {batch && !showBatch && (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setShowBatch(true)}
                  >
                    Ver última importação em lote
                  </button>
                )}
                <a
                  href="https://developer.monday.com/api-reference/docs/authentication"
                  target="_blank"
                  rel="noreferrer"
                >
                  Onde encontro meu token?
                </a>
              </div>
              <div className="notice">
                A prévia verifica tarefas, subitens, conversas, arquivos, tipos de coluna e
                automações. Você verá a cobertura e os recursos que precisam de revisão antes de
                importar.
              </div>
            </div>
          )}
          {!preview && mode === 'history' && (
            <div className="import-history">
              {!data.imports.length ? (
                <div className="empty-state">
                  <Clock3 size={32} />
                  <h3>Uma página em branco.</h3>
                  <p>Suas importações aparecerão aqui quando você trouxer o primeiro quadro.</p>
                  <button className="button secondary" onClick={() => setMode('file')}>
                    Importar um arquivo
                  </button>
                </div>
              ) : (
                [...data.imports].reverse().map((run) => (
                  <div className="history-row" key={run.id}>
                    <span className="history-icon">
                      <CircleCheck size={20} />
                    </span>
                    <div>
                      <strong>{run.name}</strong>
                      <p>
                        {run.imported} tarefas ·{' '}
                        {data.boards.find((b) => b.id === run.boardId)?.name}
                      </p>
                      <span>{new Date(run.createdAt).toLocaleString('pt-BR')}</span>
                    </div>
                    {run.reportId && (
                      <a
                        className="button ghost"
                        href={`/api/imports/${run.reportId}/report`}
                        download
                        aria-label={'Relatório de ' + run.name}
                      >
                        <Download size={15} />
                      </a>
                    )}
                    <button
                      className="button ghost"
                      onClick={() => {
                        onOpenBoard(run.boardId)
                        onClose()
                      }}
                    >
                      Abrir
                      <ArrowRight size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
          {preview && (
            <div className="mapping-stage">
              <div className="import-steps">
                <span className="step done">
                  <Check size={12} />
                  Origem
                </span>
                <i />
                <span className="step current">
                  2<span>Conferir e importar</span>
                </span>
              </div>
              {preview.counts && (
                <div className="import-resource-counts">
                  <span>{preview.counts.tasks} tarefas</span>
                  <span>{preview.counts.subitems} subitens</span>
                  <span>{preview.counts.comments} comentários</span>
                  <span>{preview.counts.files} arquivos</span>
                </div>
              )}
              <div className="file-summary">
                <span>
                  <FileSpreadsheet size={20} />
                </span>
                <div>
                  <strong>{preview.name}</strong>
                  {!!preview.mondayFolderPath?.length && (
                    <p>
                      Pasta no Monday:{' '}
                      {preview.mondayFolderPath.map((folder) => folder.name).join(' / ')}
                    </p>
                  )}
                  <p>
                    {preview.rows.length} tarefas encontradas · {preview.headers.length} colunas
                  </p>
                </div>
                <IconButton
                  label="Escolher outra origem"
                  disabled={busy}
                  onClick={() => {
                    setPreview(null)
                    setError('')
                  }}
                >
                  <X size={17} />
                </IconButton>
              </div>
              <div className="destination-fields">
                <label>
                  Importar para
                  <FieldSelect
                    label="Importar para"
                    value={destination}
                    onChange={setDestination}
                    disabled={busy}
                    options={[
                      { value: 'new', label: 'Um novo quadro', icon: <Plus size={15} /> },
                      ...data.boards.map((board) => ({
                        value: board.id,
                        label: board.name + (board.id === activeBoardId ? ' (atual)' : ''),
                        color: board.color,
                      })),
                    ]}
                  />
                </label>
                {destination === 'new' && (
                  <label>
                    Nome do novo quadro
                    <input
                      value={boardName}
                      onChange={(e) => setBoardName(e.target.value)}
                      maxLength={300}
                      disabled={busy}
                    />
                  </label>
                )}
              </div>
              {!!preview.people?.length && (
                <label className="import-people-choice">
                  <input
                    type="checkbox"
                    checked={importPeople}
                    disabled={busy}
                    onChange={(event) => setImportPeople(event.target.checked)}
                  />
                  <span>
                    <strong>Preservar os responsáveis do monday</strong>
                    <small>
                      Cria os contatos que faltarem no QuadroOS. Pessoas existentes são relacionadas
                      por e-mail ou nome.
                    </small>
                  </span>
                </label>
              )}
              {preview.sessionId && (
                <label className="import-people-choice">
                  <input
                    type="checkbox"
                    checked={importAutomations}
                    disabled={busy}
                    onChange={(event) => setImportAutomations(event.target.checked)}
                  />
                  <span>
                    <strong>Preservar automações compatíveis</strong>
                    <small>
                      Recria as regras com gatilhos e ações equivalentes. As demais receitas ficam
                      documentadas para revisão.
                    </small>
                  </span>
                </label>
              )}
              <div className="section-heading">
                <h3>Combine as colunas</h3>
                <span>Você está no controle</span>
              </div>
              {!!preview.subitemColumns?.length && (
                <details className="preview-details">
                  <summary>Colunas dos subitens ({preview.subitemColumns.length})</summary>
                  <div className="import-subitem-columns">
                    {preview.subitemColumns.map((column) => (
                      <span key={column.header}>
                        <strong>{column.name}</strong>
                        {COLUMN_TYPE_NAMES[column.type]}
                      </span>
                    ))}
                  </div>
                  <p className="muted small-text">
                    Os subitens mantêm sua própria estrutura de colunas, etiquetas e cores.
                  </p>
                </details>
              )}
              {!!preview.coverage?.length && (
                <details
                  className="preview-details import-coverage"
                  open={preview.coverage.some(
                    (entry) => entry.mode === 'snapshot' || entry.mode === 'unavailable',
                  )}
                >
                  <summary>Cobertura da importação</summary>
                  <div>
                    {preview.coverage.map((entry, index) => (
                      <article key={index} data-mode={entry.mode}>
                        <span>
                          {entry.mode === 'native'
                            ? 'Suporte local'
                            : entry.mode === 'converted'
                              ? 'Adaptação'
                              : entry.mode === 'snapshot'
                                ? 'Revisar'
                                : 'Indisponível'}
                        </span>
                        <div>
                          <strong>{entry.name}</strong>
                          <p>{entry.detail}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                </details>
              )}
              <div className="mapping-list">
                {preview.headers.map((header, index) => {
                  const source = preview.columns?.find((column) => column.header === header)
                  const sample = preview.rows[0]?.[index] || ''
                  return (
                    <div className="mapping-row" key={header}>
                      <div>
                        <strong>{source?.name || header}</strong>
                        {source && (
                          <span className="import-column-type">
                            {COLUMN_TYPE_NAMES[source.type]}
                            {source.options?.length ? ` · ${source.options.length} etiquetas` : ''}
                          </span>
                        )}
                        <span>
                          {sample
                            ? source && ['dropdown', 'people'].includes(source.type)
                              ? columnList(sample)
                                  .map(
                                    (value) =>
                                      preview.people?.find(
                                        (p) => `monday-person:${p.sourceId}` === value,
                                      )?.name || value,
                                  )
                                  .join(', ')
                              : sample
                            : 'Sem valor de exemplo'}
                        </span>
                        {source?.options?.length ? (
                          <div
                            className="import-label-preview"
                            aria-label={`Etiquetas de ${source.name}`}
                          >
                            {source.options.slice(0, 7).map((option) => (
                              <span key={option.id} title={option.label}>
                                <i style={{ backgroundColor: option.color }} />
                                {option.label}
                              </span>
                            ))}
                            {source.options.length > 7 && (
                              <small>+{source.options.length - 7}</small>
                            )}
                          </div>
                        ) : null}
                      </div>
                      <ArrowRight size={15} aria-hidden="true" />
                      <FieldSelect
                        label={`Importar ${header} como`}
                        value={mapping[header] || 'custom'}
                        disabled={busy}
                        onChange={(value) =>
                          setMapping({ ...mapping, [header]: value as ImportField })
                        }
                        options={fields.map((field) =>
                          field.value === 'custom' && source
                            ? { ...field, label: `Manter tipo: ${COLUMN_TYPE_NAMES[source.type]}` }
                            : field,
                        )}
                      />
                    </div>
                  )
                })}
              </div>
              {duplicated && (
                <p className="form-error" role="alert">
                  Cada campo principal deve corresponder a uma única coluna.
                </p>
              )}
              {!selectedFields.includes('title') && (
                <p className="form-error" role="alert">
                  Escolha uma coluna para o título das tarefas.
                </p>
              )}
              <details className="preview-details">
                <summary>Ver primeiras linhas do arquivo</summary>
                <div className="preview-scroll">
                  <table>
                    <thead>
                      <tr>
                        {preview.headers.map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.slice(0, 3).map((row, i) => (
                        <tr key={i}>
                          {row.map((cell, j) => (
                            <td key={j}>{cell || '—'}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
              <div className="notice">
                <AlertCircle size={16} />
                <div>
                  <p>
                    Datas aceitas: dia/mês/ano ou ano-mês-dia. Pessoas existentes são relacionadas
                    pelo nome ou e-mail. Sem a opção de preservar responsáveis, valores sem
                    correspondência ficam na descrição.
                  </p>
                  <p>
                    Itens já importados para o mesmo quadro serão ignorados. Sem um identificador,
                    arquivos usam o conteúdo completo da linha para reconhecer repetições; linhas
                    idênticas contam como uma tarefa.
                  </p>
                  {preview.warnings.map((w) => (
                    <p key={w}>{w}</p>
                  ))}
                </div>
              </div>
              <footer className="modal-footer">
                <button className="button ghost" disabled={busy} onClick={() => setPreview(null)}>
                  <ArrowLeft size={16} />
                  Voltar
                </button>
                <button
                  className="button primary"
                  disabled={busy || !canImport || (!preview.rows.length && !preview.sessionId)}
                  onClick={() => void apply()}
                >
                  {busy ? <LoaderCircle size={16} className="spin" /> : <FolderInput size={16} />}
                  {busy
                    ? 'Importando suas tarefas…'
                    : !preview.rows.length && preview.sessionId
                      ? 'Importar estrutura do quadro'
                      : `Importar ${preview.rows.length} tarefas`}
                </button>
              </footer>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}
