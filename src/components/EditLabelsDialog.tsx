import { useState } from 'react'
import {
  Check,
  Plus,
  Trash2,
  RotateCcw,
  TriangleAlert,
  LoaderCircle,
  Palette,
  X,
} from 'lucide-react'
import {
  type LabelOption,
  DEFAULT_STATUS_OPTIONS,
  DEFAULT_PRIORITY_OPTIONS,
} from '../../shared/domain'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog'
import { Button } from './ui/button'

const MONDAY_PALETTE = [
  { name: 'Verde (Feito)', hex: '#00c875' },
  { name: 'Laranja (Em andamento)', hex: '#fdab3d' },
  { name: 'Vermelho (Parado)', hex: '#e2445c' },
  { name: 'Cinza ardósia', hex: '#798099' },
  { name: 'Azul Ciano', hex: '#00a0e9' },
  { name: 'Roxo Orquídea', hex: '#a25ddc' },
  { name: 'Roxo Alta', hex: '#553c9e' },
  { name: 'Azul Anil', hex: '#6c7be8' },
  { name: 'Azul Céu', hex: '#579bfc' },
  { name: 'Grafite Escuro', hex: '#555953' },
  { name: 'Rosa Vibrante', hex: '#ff5ac4' },
  { name: 'Amarelo Ouro', hex: '#ffcb00' },
  { name: 'Verde Menta', hex: '#00d2d3' },
  { name: 'Esmeralda Escura', hex: '#10ac84' },
  { name: 'Índigo Profundo', hex: '#5f27cd' },
  { name: 'Coral Quente', hex: '#ee5253' },
]

export function EditLabelsDialog({
  type,
  currentLabels,
  onClose,
  onSave,
}: {
  type: 'status' | 'priority'
  currentLabels: LabelOption[]
  onClose: () => void
  onSave: (type: 'status' | 'priority', updatedLabels: LabelOption[]) => Promise<void>
}) {
  const [labels, setLabels] = useState<LabelOption[]>(() =>
    currentLabels && currentLabels.length
      ? currentLabels.map((l) => ({ ...l }))
      : (type === 'status' ? DEFAULT_STATUS_OPTIONS : DEFAULT_PRIORITY_OPTIONS).map((l) => ({
          ...l,
        })),
  )
  const [activePickerIndex, setActivePickerIndex] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const isStatus = type === 'status'
  const titleText = isStatus ? 'Editar etiquetas de Status' : 'Editar etiquetas de Prioridade'

  function updateLabel(index: number, changes: Partial<LabelOption>) {
    setLabels((prev) => prev.map((item, i) => (i === index ? { ...item, ...changes } : item)))
  }

  function addLabel() {
    const nextColor = MONDAY_PALETTE[labels.length % MONDAY_PALETTE.length].hex
    const nextItem: LabelOption = {
      id: `${type}-${Date.now()}`,
      label: isStatus ? 'Novo status' : 'Nova prioridade',
      color: nextColor,
      hasWarning: false,
    }
    setLabels((prev) => [...prev, nextItem])
    setActivePickerIndex(labels.length)
  }

  function removeLabel(index: number) {
    if (labels.length <= 1) {
      setError('O quadro precisa ter pelo menos uma etiqueta.')
      return
    }
    setError('')
    setLabels((prev) => prev.filter((_, i) => i !== index))
    if (activePickerIndex === index) setActivePickerIndex(null)
  }

  function restoreDefaults() {
    setError('')
    setLabels((isStatus ? DEFAULT_STATUS_OPTIONS : DEFAULT_PRIORITY_OPTIONS).map((l) => ({ ...l })))
    setActivePickerIndex(null)
  }

  async function handleSave() {
    // Validate that labels have non-empty names
    const empty = labels.some((l) => !l.label.trim())
    if (empty) {
      setError('Todas as etiquetas precisam ter um nome.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await onSave(type, labels)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar as etiquetas.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent
        className="label-editor max-w-xl max-h-[90vh] flex flex-col p-6 rounded-xl bg-white shadow-2xl border border-slate-200"
        showCloseButton={false}
        aria-describedby="edit-labels-desc"
      >
        <DialogHeader className="border-b border-slate-100 pb-3">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Palette size={20} className="text-blue-600" />
                {titleText}
              </DialogTitle>
              <DialogDescription id="edit-labels-desc" className="text-xs text-slate-500 mt-1">
                Personalize os nomes, adicione novas etiquetas e escolha a cor que desejar.
              </DialogDescription>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              aria-label="Fechar"
            >
              <X size={18} />
            </button>
          </div>
        </DialogHeader>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 rounded-md my-2 flex items-center gap-2">
            <TriangleAlert size={15} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto py-3 space-y-3 pr-1">
          {labels.map((item, index) => (
            <div
              key={item.id || index}
              className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 hover:bg-slate-50 transition-colors flex flex-col gap-2"
            >
              <div className="flex items-center gap-3">
                {/* Color Button with Color Popover Trigger */}
                <button
                  type="button"
                  title="Alterar cor"
                  onClick={() => setActivePickerIndex(activePickerIndex === index ? null : index)}
                  className="w-9 h-9 rounded-md shrink-0 shadow-sm border-2 border-white ring-1 ring-slate-200 flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
                  style={{ backgroundColor: item.color }}
                >
                  <Palette size={14} className="text-white drop-shadow" />
                </button>

                {/* Name Input */}
                <input
                  type="text"
                  aria-label={`Nome da etiqueta ${index + 1}`}
                  value={item.label}
                  maxLength={300}
                  placeholder="Nome da etiqueta"
                  onChange={(e) => updateLabel(index, { label: e.target.value })}
                  className="flex-1 h-9 px-3 text-sm font-medium border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
                />

                {/* Warning Icon toggle for priorities */}
                {!isStatus && (
                  <button
                    type="button"
                    onClick={() => updateLabel(index, { hasWarning: !item.hasWarning })}
                    title={item.hasWarning ? 'Remover ícone de aviso' : 'Adicionar ícone de aviso'}
                    className={`h-9 px-2.5 rounded-md border text-xs font-medium flex items-center gap-1.5 transition-colors ${
                      item.hasWarning
                        ? 'bg-amber-100 border-amber-300 text-amber-800'
                        : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-100'
                    }`}
                  >
                    <TriangleAlert
                      size={14}
                      className={item.hasWarning ? 'text-amber-600' : 'text-slate-400'}
                    />
                    <span className="hidden sm:inline">Aviso</span>
                  </button>
                )}

                {/* Live Preview Pill */}
                {isStatus && (
                  <button
                    type="button"
                    className="label-completion-toggle"
                    aria-label={`Considerar ${item.label} como concluído`}
                    aria-pressed={item.isDone ?? item.label === 'Feito'}
                    onClick={() =>
                      updateLabel(index, { isDone: !(item.isDone ?? item.label === 'Feito') })
                    }
                  >
                    <Check size={14} />
                    <span>Concluído</span>
                  </button>
                )}
                <div
                  className="hidden md:flex h-8 px-4 rounded items-center justify-center text-xs font-semibold text-white shadow-sm shrink-0 min-w-[85px] max-w-[120px] truncate"
                  style={{ backgroundColor: item.color, color: '#ffffff' }}
                  title="Pré-visualização da etiqueta"
                >
                  <span className="truncate">{item.label || 'Vazio'}</span>
                  {item.hasWarning && (
                    <TriangleAlert size={12} className="ml-1 shrink-0 text-amber-300" />
                  )}
                </div>

                {/* Delete Button */}
                <button
                  type="button"
                  title="Excluir etiqueta"
                  onClick={() => removeLabel(index)}
                  disabled={labels.length <= 1}
                  className="w-9 h-9 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <Trash2 size={16} />
                </button>
              </div>

              {/* Color Picker Drawer / Palette when active */}
              {activePickerIndex === index && (
                <div className="mt-2 p-3 bg-white border border-slate-200 rounded-lg shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-700">
                      Escolha uma cor ou personalize:
                    </span>
                    <button
                      type="button"
                      onClick={() => setActivePickerIndex(null)}
                      className="text-xs text-slate-600 hover:text-slate-800"
                    >
                      Fechar
                    </button>
                  </div>

                  {/* Swatches Grid */}
                  <div className="grid grid-cols-8 gap-1.5 mb-3">
                    {MONDAY_PALETTE.map((swatch) => (
                      <button
                        key={swatch.hex}
                        type="button"
                        title={swatch.name}
                        onClick={() => updateLabel(index, { color: swatch.hex })}
                        className={`w-7 h-7 rounded-md transition-transform hover:scale-110 flex items-center justify-center ${
                          item.color.toLowerCase() === swatch.hex.toLowerCase()
                            ? 'ring-2 ring-offset-1 ring-slate-800 scale-105'
                            : ''
                        }`}
                        style={{ backgroundColor: swatch.hex }}
                      >
                        {item.color.toLowerCase() === swatch.hex.toLowerCase() && (
                          <Check size={14} className="text-white drop-shadow" />
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Custom Hex / Color Input */}
                  <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                    <span className="text-xs text-slate-500">Cor personalizada:</span>
                    <input
                      type="color"
                      aria-label={`Cor da etiqueta ${index + 1}`}
                      value={item.color}
                      onChange={(e) => updateLabel(index, { color: e.target.value })}
                      className="w-7 h-7 p-0 border border-slate-300 rounded cursor-pointer"
                    />
                    <input
                      type="text"
                      aria-label={`Código da cor da etiqueta ${index + 1}`}
                      value={item.color}
                      maxLength={7}
                      onChange={(e) => updateLabel(index, { color: e.target.value })}
                      className="w-24 h-7 px-2 text-xs font-mono uppercase border border-slate-300 rounded bg-slate-50"
                    />
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Add Label Button */}
          <button
            type="button"
            onClick={addLabel}
            className="w-full py-2.5 px-3 rounded-lg border-2 border-dashed border-slate-300 hover:border-blue-500 hover:bg-blue-50/50 text-slate-600 hover:text-blue-700 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
          >
            <Plus size={16} />
            <span>Adicionar nova etiqueta</span>
          </button>
        </div>

        <DialogFooter className="border-t border-slate-100 pt-3 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={restoreDefaults}
            disabled={busy}
            className="text-slate-500 hover:text-slate-700 text-xs"
          >
            <RotateCcw size={13} className="mr-1" />
            Restaurar padrões
          </Button>

          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={busy}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleSave}
              disabled={busy}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium"
            >
              {busy ? (
                <>
                  <LoaderCircle size={14} className="animate-spin mr-1" />
                  Salvando…
                </>
              ) : (
                <>
                  <Check size={14} className="mr-1" />
                  Salvar etiquetas
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
