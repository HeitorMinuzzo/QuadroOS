import type { ImportPreview, ImportMapping, ImportField } from './domain.ts'

export function importKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}
export const STATUS_ALIASES: Record<string, string> = {
  done: 'Feito',
  completed: 'Feito',
  finished: 'Feito',
  concluido: 'Feito',
  feito: 'Feito',
  'working on it': 'Em andamento',
  'in progress': 'Em andamento',
  'em andamento': 'Em andamento',
  stuck: 'Parado',
  parado: 'Parado',
  aguardando: 'Aguardando',
  waiting: 'Aguardando',
  pending: 'Aguardando',
  'not started': 'Não iniciado',
  'nao iniciado': 'Não iniciado',
  'em revisao': 'Aguardando',
  'in review': 'Aguardando',
  review: 'Aguardando',
  continuo: 'Contínuo',
  continuous: 'Contínuo',
  ongoing: 'Contínuo',
  recurring: 'Contínuo',
}
export const PRIORITY_ALIASES: Record<string, string> = {
  low: 'Baixa',
  baixa: 'Baixa',
  medium: 'Média',
  media: 'Média',
  high: 'Alta',
  alta: 'Alta',
  critical: 'Crítico',
  critico: 'Crítico',
  urgent: 'Urgente',
  urgente: 'Urgente',
  'sem prioridade': 'Sem prioridade',
}
export function importLabel(value: string, field: 'status' | 'priority') {
  return (field === 'status' ? STATUS_ALIASES : PRIORITY_ALIASES)[importKey(value)] || value
}

export function guessImportMapping(preview: ImportPreview): ImportMapping {
  const taken = new Set<ImportField>()
  return Object.fromEntries(
    preview.headers.map((header) => {
      const source = preview.columns?.find((column) => column.header === header)
      const key = (source?.name || header)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s*\[.*\]$/, '')
        .toLowerCase()
        .trim()
      let field: ImportField =
        /^(tarefa|nome|name|item|item name|elemento|titulo|task|assunto)$/.test(key)
          ? 'title'
          : (source ? /^(status|situacao|andamento)$/ : /status|situacao/).test(key)
            ? 'status'
            : /priorit|priorid/.test(key)
              ? 'priority'
              : /prazo|data|date|vencimento/.test(key)
                ? 'dueDate'
                : /respons|^pessoas?$|owner|people|person/.test(key)
                  ? 'owner'
                  : /^(grupo|group)$/.test(key)
                    ? 'group'
                    : /descri|notes|notas/.test(key)
                      ? 'description'
                      : /^(id|id monday|item id|identificador)$/.test(key)
                        ? 'externalId'
                        : 'custom'
      // A second status column such as SETOR is independent of the task's status.
      if (source) {
        if (
          field === 'title' ||
          field === 'group' ||
          field === 'externalId' ||
          field === 'description'
        )
          field = 'custom'
        if ((field === 'status' || field === 'priority') && source.type !== 'status')
          field = 'custom'
        if (field === 'dueDate' && source.type !== 'date') field = 'custom'
        if (field === 'owner' && source.type !== 'people') field = 'custom'
      }
      if (field !== 'custom' && taken.has(field)) field = 'custom'
      taken.add(field)
      return [header, field]
    }),
  )
}
