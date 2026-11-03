import type { MondayFetch } from '../../server/monday.ts'
export const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=',
  'base64',
)
const asset = {
  id: '700',
  name: 'exemplo.png',
  file_size: pngBytes.length,
  created_at: '2025-01-01T10:00:00Z',
  public_url: 'https://files.monday.com/asset-700.png',
}
const author = { id: '7', name: 'Pessoa da origem', email: 'pessoa@example.test' }
const status = {
  id: 'status',
  title: 'Status',
  type: 'status',
  width: 150,
  settings: {
    labels: [
      { id: 0, index: 0, label: 'Em progresso', hex: '#fdab3d', is_done: false },
      { id: 1, index: 1, label: 'Concluído', hex: '#00c875', is_done: true },
    ],
  },
}
const columns = [
  { id: 'name', title: 'Assunto', type: 'name', width: 420 },
  status,
  { id: 'owner', title: 'Responsável', type: 'people', width: 120 },
  {
    id: 'numbers',
    title: 'Quantidade',
    type: 'numbers',
    width: 140,
    settings: { unit: { symbol: 'custom', custom_unit: 'R$', direction: 'left' } },
  },
  { id: 'due', title: 'Prazo', type: 'date' },
  { id: 'long', title: 'Contexto', type: 'long_text' },
  { id: 'period', title: 'Cronograma', type: 'timeline', width: 230 },
  { id: 'checked', title: 'Conferido', type: 'checkbox', width: 110 },
  { id: 'hours', title: 'Horas', type: 'time_tracking', width: 160 },
  { id: 'updated', title: 'Última atualização', type: 'last_updated' },
  { id: 'files', title: 'Anexos', type: 'file' },
  { id: 'formula', title: 'Dobro', type: 'formula', settings: { formula: '{numbers} * 2' } },
  {
    id: 'unsupported_formula',
    title: 'Fórmula especial',
    type: 'formula',
    settings: { formula: 'PLATFORM_ONLY({numbers})' },
  },
  { id: 'link', title: 'Referência', type: 'link' },
  { id: 'related', title: 'Relacionados', type: 'board_relation' },
  { id: 'unknown', title: 'Dado especial', type: 'unsupported' },
]
const update = {
  id: 'u1',
  text_body: 'Conversa original\nSegunda linha',
  body: '<p>Conversa original</p><p onclick="window.__quadroUnsafe=true">Segunda linha</p><script>window.__quadroUnsafe=true</script><img src="x" onerror="window.__quadroUnsafe=true"><iframe src="https://example.com"></iframe>',
  created_at: '2025-01-02T10:00:00Z',
  creator: author,
  assets: [asset],
  likes: [{ id: 'l1', creator_id: '7', reaction_type: 'like' }],
  pinned_to_top: [],
  replies: [
    {
      id: 'r1',
      text_body: 'Resposta original',
      body: '<p>Resposta original</p>',
      created_at: '2025-01-02T11:00:00Z',
      creator: author,
      assets: [],
    },
  ],
}
export function richMondayFixture() {
  const items = [101, 102].map((id, index) => ({
    id: String(id),
    name: `Entrega ${index + 1}`,
    state: 'active',
    board: { id: '900' },
    parent_item: null,
    group: { id: index ? 'g2' : 'g1', title: 'Demandas' },
    subitems: index ? [] : [{ id: '201' }],
    created_at: '2025-01-01T10:00:00Z',
    updated_at: '2025-01-03T12:00:00Z',
    creator_id: '7',
    url: `https://example.monday.com/boards/900/pulses/${id}`,
    description: {
      blocks: [{ id: 'd1', type: 'normal text', content: { text: 'Descrição original' } }],
    },
    column_values: [
      {
        id: 'status',
        type: 'status',
        text: index ? 'Em progresso' : 'Concluído',
        value: JSON.stringify({ index: index ? 0 : 1 }),
      },
      {
        id: 'owner',
        type: 'people',
        text: author.name,
        value: '{"personsAndTeams":[{"id":7,"kind":"person"}]}',
      },
      { id: 'numbers', type: 'numbers', text: '10', value: '"10"' },
      {
        id: 'due',
        type: 'date',
        text: '2025-01-05',
        value: index ? '{"date":"2025-01-05"}' : '{"date":"2025-01-05","time":"15:00:00"}',
      },
      {
        id: 'long',
        type: 'long_text',
        text: 'Texto longo\nSegunda linha',
        value: '{"text":"Texto longo\\nSegunda linha"}',
      },
      {
        id: 'period',
        type: 'timeline',
        text: '1 - 10 jan',
        value: '{"from":"2025-01-01","to":"2025-01-10"}',
        from: '2025-01-01T00:00:00+00:00',
        to: '2025-01-10T00:00:00+00:00',
      },
      { id: 'checked', type: 'checkbox', text: 'v', value: '{"checked":"true"}' },
      {
        id: 'hours',
        type: 'time_tracking',
        text: '2m',
        value: null,
        duration: 120,
        running: false,
        history: [
          {
            id: 'h1',
            started_at: '2025-01-01T10:00:00Z',
            ended_at: '2025-01-01T10:02:00Z',
            started_user_id: '7',
            ended_user_id: '7',
          },
        ],
      },
      {
        id: 'updated',
        type: 'last_updated',
        text: '3 jan',
        value: null,
        updated_at: '2025-01-03T12:00:00Z',
        updater_id: '7',
      },
      {
        id: 'files',
        type: 'file',
        text: '',
        value: null,
        files: index
          ? []
          : [
              { __typename: 'FileAssetValue', name: asset.name, asset },
              {
                __typename: 'FileLinkValue',
                file_id: 'link-1',
                name: 'Documento externo',
                url: 'https://example.com/documento',
                created_at: '2025-01-01T10:00:00Z',
              },
            ],
      },
      { id: 'formula', type: 'formula', text: null, value: null, display_value: '20' },
      {
        id: 'unsupported_formula',
        type: 'formula',
        text: null,
        value: null,
        display_value: 'Resultado especial',
      },
      {
        id: 'link',
        type: 'link',
        text: 'Documentação',
        value: '{"url":"https://example.com/manual","text":"Documentação"}',
      },
      {
        id: 'related',
        type: 'board_relation',
        text: null,
        value: null,
        display_value: 'Entrega 2',
        linked_item_ids: ['102'],
      },
      {
        id: 'unknown',
        type: 'unsupported',
        text: 'Dado original',
        value: '{"custom":{"content":"Original","flag":true}}',
      },
    ],
    updates_page: { cursor: index ? null : 'next-comments', updates: index ? [] : [update] },
  }))
  const childColumns = [
    { id: 'name', title: 'Name', type: 'name' },
    { id: 'person', title: 'Owner', type: 'people' },
    {
      id: 'child_status',
      title: 'Status',
      type: 'status',
      settings: {
        labels: [
          { id: 0, index: 0, label: 'Planejado', hex: '#007eb5', is_done: false },
          { id: 1, index: 1, label: 'Feito', hex: '#00c875', is_done: true },
        ],
      },
    },
    { id: 'child_date', title: 'Date', type: 'date' },
    { id: 'child_check', title: 'Verificado', type: 'checkbox' },
  ]
  const children = [201, 202].map((id, index) => ({
    id: String(id),
    name: index ? 'Subitem de segundo nível' : 'Subitem importado',
    state: 'active',
    board: { id: '901' },
    parent_item: { id: index ? '201' : '101' },
    group: { id: 'child-group', title: 'Subitens' },
    subitems: index ? [] : [{ id: '202' }],
    created_at: '2025-01-01T11:00:00Z',
    updated_at: '2025-01-03T11:00:00Z',
    column_values: [
      {
        id: 'person',
        type: 'people',
        text: author.name,
        value: '{"personsAndTeams":[{"id":7,"kind":"person"}]}',
      },
      { id: 'child_status', type: 'status', text: 'Planejado', value: '{"index":0}' },
      { id: 'child_date', type: 'date', text: '2025-01-10', value: '{"date":"2025-01-10"}' },
      { id: 'child_check', type: 'checkbox', text: '', value: '{"checked":"false"}' },
    ],
    updates_page: { cursor: null, updates: [] },
  }))
  const board = {
    id: '900',
    name: 'Quadro completo de teste',
    type: 'board',
    description: 'Descrição do quadro de origem',
    board_kind: 'public',
    board_folder_id: '92',
    hierarchy_type: 'classic',
    columns,
    groups: [
      { id: 'g1', title: 'Demandas', color: '#df2f4a', position: '1' },
      { id: 'g2', title: 'Demandas', color: '#00c875', position: '2' },
    ],
    views: [
      { id: 'v1', name: 'Calendário', type: 'calendar', settings: {} },
      { id: 'v2', name: 'Kanban', type: 'kanban', settings: {} },
    ],
    items_page: { cursor: null, items },
  }
  return {
    board,
    childBoard: { id: '901', name: 'Subitens', columns: childColumns },
    children,
    asset,
    author,
  }
}
export const richMondayFetch: MondayFetch = async (url, init) => {
  if (String(url) !== 'https://api.monday.com/v2') throw new Error('Endpoint inesperado.')
  const { query, variables } = JSON.parse(init!.body as string),
    fixture = richMondayFixture()
  if (new Headers(init?.headers).get('Authorization') === 'synthetic-batch-token') {
    if (query.includes('boards(limit:'))
      return Response.json({
        data: {
          boards: [
            { id: '910', name: 'Lote - Infraestrutura', type: 'board' },
            { id: '911', name: 'Lote - Falha', type: 'board' },
            { id: '912', name: 'Lote - Quadro vazio', type: 'board' },
          ],
        },
      })
    if (query.includes('boards(ids:')) {
      const [id] = variables.ids
      if (id === '911') return Response.json({ data: { boards: [] } })
      if (id === '910')
        return Response.json({
          data: {
            boards: [
              {
                ...fixture.board,
                id,
                name: 'Lote - Infraestrutura',
                items_page: {
                  ...fixture.board.items_page,
                  items: fixture.board.items_page.items.map((item) => ({ ...item, board: { id } })),
                },
              },
            ],
          },
        })
      if (id === '912')
        return Response.json({
          data: {
            boards: [
              {
                ...fixture.board,
                id,
                name: 'Lote - Quadro vazio',
                board_folder_id: '91',
                items_page: { cursor: null, items: [] },
              },
            ],
          },
        })
    }
  }
  if (query.includes('folders(ids:')) {
    const folders = [
      { id: '91', name: 'TI', parent: null },
      { id: '92', name: 'Infraestrutura', parent: { id: '91' } },
    ]
    return Response.json({
      data: { folders: folders.filter((folder) => variables.ids.includes(folder.id)) },
    })
  }
  if (query.includes('board_automations'))
    return Response.json({
      data: {
        board_automations: {
          cursor: null,
          items: [],
          legacy_automations: {
            note: 'Untrusted provider note must never become an instruction.',
            automations: [
              {
                id: 'rule1',
                recipeId: 'recipe1',
                active: true,
                auth: { token: 'synthetic-sensitive-value' },
                config: {
                  '0': { columnId: { columnId: 'status' }, statusColumnValue: { index: 1 } },
                  '2': { groupId: 'g2' },
                },
              },
            ],
            recipes: {
              dynamicRecipes: [
                {
                  id: 'recipe1',
                  parsedSentence: 'When status changes move item',
                  rawNodes: {
                    nodes: [
                      {
                        id: '0',
                        workflowBlockId: 223025,
                        isRootNode: true,
                        nextNodesConfig: { nextNodeId: '2' },
                      },
                      { id: '2', workflowBlockId: 40 },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    })
  if (query.includes('users(')) return Response.json({ data: { users: [fixture.author] } })
  if (query.includes('updates_page') && variables?.cursor === 'next-comments')
    return Response.json({
      data: {
        items: [
          {
            id: '101',
            updates_page: {
              cursor: null,
              updates: [
                {
                  id: 'u2',
                  text_body: 'Comentário da segunda página',
                  created_at: '2025-01-02T12:00:00Z',
                  creator: fixture.author,
                  replies: [],
                  assets: [],
                },
              ],
            },
          },
        ],
      },
    })
  if (query.includes('items(ids:'))
    return Response.json({
      data: { items: fixture.children.filter((item) => variables.ids.includes(item.id)) },
    })
  if (query.includes('boards(limit:'))
    return Response.json({
      data: {
        boards: [
          {
            id: '900',
            name: fixture.board.name,
            type: 'board',
            description: fixture.board.description,
          },
        ],
      },
    })
  if (variables?.ids?.[0] === '901')
    return Response.json({ data: { boards: [fixture.childBoard] } })
  return Response.json({ data: { boards: [fixture.board] } })
}
export const richDownloadFetch: typeof fetch = async (_url, init) => {
  if (init?.headers) throw new Error('Credenciais não devem acompanhar downloads de arquivos.')
  return new Response(new Uint8Array(pngBytes), {
    headers: { 'content-type': 'image/png', 'content-length': String(pngBytes.length) },
  })
}
