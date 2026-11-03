import type { ColumnType, ImportCoverage } from './domain.ts'
export interface MondayCapability {
  type: ColumnType | null
  mode: ImportCoverage['mode']
  name: string
  detail: string
}
const native = (
  type: ColumnType,
  name: string,
  detail = 'Valores e edição equivalentes disponíveis no QuadroOS.',
): MondayCapability => ({ type, mode: 'native', name, detail })
const converted = (name: string, detail: string): MondayCapability => ({
  type: 'external',
  mode: 'converted',
  name,
  detail,
})
const snapshot = (name: string, detail: string): MondayCapability => ({
  type: 'external',
  mode: 'snapshot',
  name,
  detail,
})
// Explicit coverage for every ColumnType in monday's 2026-10 public schema.
export const MONDAY_CAPABILITIES: Record<string, MondayCapability> = {
  name: {
    type: null,
    mode: 'native',
    name: 'Nome',
    detail: 'Título e ordem dos itens preservados.',
  },
  text: native('text', 'Texto'),
  long_text: native('text', 'Texto longo'),
  numbers: native('number', 'Números'),
  status: native(
    'status',
    'Status',
    'Etiquetas, IDs, cores, ordem e indicação de conclusão preservados.',
  ),
  people: native(
    'people',
    'Pessoas',
    'Pessoas são relacionadas a contatos locais; contatos sem acesso permanecem documentados.',
  ),
  person: native('people', 'Pessoa'),
  item_assignees: converted(
    'Responsáveis do item',
    'Estrutura original preservada; a resolução usa os responsáveis que a API disponibilizar.',
  ),
  dropdown: native(
    'dropdown',
    'Lista suspensa',
    'Seleção múltipla, etiquetas e cores preservadas.',
  ),
  date: native('date', 'Data'),
  timeline: native('timeline', 'Cronograma'),
  time_tracking: native('time_tracking', 'Controle de horas'),
  checkbox: native('checkbox', 'Checkbox'),
  file: native(
    'files',
    'Arquivos',
    'Binários acessíveis são copiados; links de documentos externos continuam como links. Falhas de download são identificadas individualmente.',
  ),
  formula: {
    type: 'formula',
    mode: 'converted',
    name: 'Fórmula',
    detail:
      'Expressões compatíveis são convertidas e comparadas com o resultado da origem. Divergências ficam como referência, com a expressão original.',
  },
  last_updated: native(
    'last_updated',
    'Última atualização',
    'Data original preservada; novas alterações locais atualizam a coluna.',
  ),
  subtasks: {
    type: null,
    mode: 'native',
    name: 'Subitens',
    detail: 'Hierarquia de até cinco níveis, colunas e valores próprios preservados.',
  },
  link: converted('Link', 'Endereço e legenda editáveis, com abertura segura do link.'),
  email: converted('E-mail', 'Endereço e nome editáveis, com abertura no aplicativo de e-mail.'),
  phone: converted('Telefone', 'Número e código do país preservados e editáveis.'),
  location: converted(
    'Localização',
    'Endereço e coordenadas preservados e editáveis, com abertura do mapa.',
  ),
  country: converted('País', 'Nome e código do país preservados e editáveis.'),
  rating: converted('Avaliação', 'Avaliação preservada e editável.'),
  hour: converted('Hora', 'Hora e minuto preservados e editáveis.'),
  week: converted('Semana', 'Início e fim da semana preservados e editáveis.'),
  world_clock: converted(
    'Relógio mundial',
    'Fuso horário preservado e editável; horário exibido no fuso selecionado.',
  ),
  color_picker: converted('Cor', 'Cor preservada e editável.'),
  board_relation: converted(
    'Conectar quadros',
    'IDs e referências preservados. Itens de quadros já importados podem ser abertos localmente; os demais continuam identificados para importação posterior.',
  ),
  dependency: snapshot(
    'Dependências',
    'Vínculos preservados. O reagendamento automático e as regras de dependência do monday exigem configuração local.',
  ),
  mirror: snapshot(
    'Espelho',
    'Valor exibido e configuração preservados. O espelhamento dinâmico exige que os quadros e a regra tenham equivalente local.',
  ),
  progress: snapshot(
    'Progresso',
    'Valor e configuração preservados. A agregação específica da coluna fica documentada para revisão.',
  ),
  creation_log: snapshot('Log de criação', 'Data e autor de criação preservados.'),
  item_id: snapshot('Identificador', 'Identificador original preservado.'),
  tags: snapshot(
    'Tags',
    'IDs, nomes, cores e seleção preservados; a taxonomia global da conta permanece documentada.',
  ),
  vote: snapshot(
    'Votos',
    'Contagem e IDs dos votantes preservados. Identidades e histórico da plataforma permanecem como referência.',
  ),
  button: snapshot(
    'Botão',
    'Configuração e valor preservados. A ação vinculada não é executada sem uma tradução confirmada da automação.',
  ),
  auto_number: snapshot(
    'Numeração automática',
    'Configuração preservada. O monday não expõe o valor calculado desta coluna pela API de valores.',
  ),
  group: snapshot(
    'Grupo',
    'Configuração da coluna preservada; os grupos dos itens são migrados pelo vínculo próprio.',
  ),
  team: snapshot(
    'Equipe',
    'IDs e nomes disponíveis preservados. Regras de participação de equipes exigem revisão local.',
  ),
  integration: snapshot(
    'Integração',
    'Configuração pública preservada, sem copiar credenciais ou ativar conexões externas.',
  ),
  doc: snapshot(
    'Documento monday',
    'Referência e metadados disponíveis preservados; a edição colaborativa do documento exige um editor equivalente.',
  ),
  direct_doc: snapshot('Documento', 'Referência e metadados disponíveis preservados.'),
  unsupported: snapshot(
    'Tipo não suportado pela API',
    'Dados que a API disponibilizou são preservados como referência estruturada.',
  ),
}
export function mondayCapability(type: string): MondayCapability {
  return (
    MONDAY_CAPABILITIES[type] ||
    snapshot(
      type,
      'Tipo novo ou específico de aplicativo. Estrutura original preservada para revisão, sem conversão silenciosa para texto.',
    )
  )
}
