import { useState, type CSSProperties } from 'react'
import { Check, Plus, Trash2, RotateCcw, TriangleAlert, Palette } from 'lucide-react'
import {
  type LabelOption,
  DEFAULT_STATUS_OPTIONS,
  DEFAULT_PRIORITY_OPTIONS,
} from '../../shared/domain'
import { Modal, SubmitButton } from './ui'
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

/**
 * Names, colors and meaning of the status or priority labels. Every row has the same layout
 * (color, name, flag, delete), so names of any length never push the controls around.
 */
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
    if (labels.some((l) => !l.label.trim())) {
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
    <Modal
      title={isStatus ? 'Editar etiquetas de Status' : 'Editar etiquetas de Prioridade'}
      subtitle="Renomeie, escolha a cor e adicione as etiquetas desta coluna."
      className="column-editor-modal label-editor"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <form
        className="column-editor-form label-editor-form"
        onSubmit={(event) => {
          event.preventDefault()
          void handleSave()
        }}
      >
        <div className="label-editor-heading" aria-hidden="true">
          <span>Cor</span>
          <span>Nome</span>
          <span>{isStatus ? 'Conta como feito' : 'Aviso'}</span>
          <span />
        </div>
        <ul className="label-editor-list">
          {labels.map((item, index) => {
            const done = item.isDone ?? item.label === 'Feito'
            const name = item.label.trim() || `etiqueta ${index + 1}`
            return (
              <li key={item.id || index} data-open={activePickerIndex === index || undefined}>
                <div className="label-editor-row">
                  <button
                    type="button"
                    className="label-swatch"
                    title="Alterar cor"
                    aria-label={`Alterar cor de ${name}`}
                    aria-expanded={activePickerIndex === index}
                    onClick={() => setActivePickerIndex(activePickerIndex === index ? null : index)}
                    style={{ backgroundColor: item.color }}
                  >
                    <Palette size={14} aria-hidden="true" />
                  </button>
                  <input
                    type="text"
                    className="label-name"
                    aria-label={`Nome da etiqueta ${index + 1}`}
                    value={item.label}
                    maxLength={300}
                    placeholder="Nome da etiqueta"
                    onChange={(e) => updateLabel(index, { label: e.target.value })}
                    style={{ '--label-color': item.color } as CSSProperties}
                  />
                  {isStatus ? (
                    <button
                      type="button"
                      className="label-flag"
                      aria-label={`Considerar ${name} como concluído`}
                      aria-pressed={done}
                      title={
                        done
                          ? 'Tarefas com esta etiqueta contam como concluídas'
                          : 'Marcar como etiqueta de conclusão'
                      }
                      onClick={() => updateLabel(index, { isDone: !done })}
                    >
                      <Check size={14} aria-hidden="true" />
                      <span>Concluído</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="label-flag is-warning"
                      aria-label={`Ícone de aviso em ${name}`}
                      aria-pressed={!!item.hasWarning}
                      title={
                        item.hasWarning ? 'Remover ícone de aviso' : 'Adicionar ícone de aviso'
                      }
                      onClick={() => updateLabel(index, { hasWarning: !item.hasWarning })}
                    >
                      <TriangleAlert size={14} aria-hidden="true" />
                      <span>Aviso</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="label-delete"
                    title="Excluir etiqueta"
                    aria-label={`Excluir ${name}`}
                    onClick={() => removeLabel(index)}
                    disabled={labels.length <= 1}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
                {activePickerIndex === index && (
                  <div className="label-palette">
                    <div className="label-palette-swatches">
                      {MONDAY_PALETTE.map((swatch) => {
                        const chosen = item.color.toLowerCase() === swatch.hex.toLowerCase()
                        return (
                          <button
                            key={swatch.hex}
                            type="button"
                            title={swatch.name}
                            aria-label={swatch.name}
                            aria-pressed={chosen}
                            onClick={() => updateLabel(index, { color: swatch.hex })}
                            style={{ backgroundColor: swatch.hex }}
                          >
                            {chosen && <Check size={14} aria-hidden="true" />}
                          </button>
                        )
                      })}
                    </div>
                    <div className="label-palette-custom">
                      <span>Cor personalizada</span>
                      <input
                        type="color"
                        aria-label={`Cor da etiqueta ${index + 1}`}
                        value={item.color}
                        onChange={(e) => updateLabel(index, { color: e.target.value })}
                      />
                      <input
                        type="text"
                        aria-label={`Código da cor da etiqueta ${index + 1}`}
                        value={item.color}
                        maxLength={7}
                        onChange={(e) => updateLabel(index, { color: e.target.value })}
                      />
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        <button type="button" className="label-add" onClick={addLabel}>
          <Plus size={15} aria-hidden="true" />
          Adicionar nova etiqueta
        </button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer className="column-editor-footer">
          <div>
            <Button type="button" variant="ghost" onClick={restoreDefaults} disabled={busy}>
              <RotateCcw size={14} />
              Restaurar padrões
            </Button>
          </div>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <SubmitButton busy={busy} disabled={busy}>
            Salvar etiquetas
          </SubmitButton>
        </footer>
      </form>
    </Modal>
  )
}
