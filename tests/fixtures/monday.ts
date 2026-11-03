// Synthetic data matching the current monday schema; never store real tokens or account data here.
export function mondayFixture() {
  const columns = [
    { id: 'name', title: 'Name', type: 'name' },
    {
      id: 'status',
      title: 'Status',
      type: 'status',
      settings: {
        labels: [
          { id: 0, index: 0, label: 'Em testes', hex: '#fdab3d' },
          { id: 1, index: 1, label: 'Done', hex: '#00c875' },
        ],
      },
    },
    {
      id: 'sector',
      title: 'SETOR',
      type: 'status',
      settings: {
        labels: [
          { id: 2, index: 1, label: 'FISCAL', hex: '#9cd326' },
          { id: 3, index: 0, label: 'EXPORTAÇÃO', hex: '#df2f4a' },
          { id: 4, index: 2, label: 'PCP', hex: '#784bd1' },
        ],
      },
    },
    {
      id: 'departments',
      title: 'Áreas',
      type: 'dropdown',
      settings: {
        labels: [
          { id: 1, label: 'Compras, exterior' },
          { id: 2, label: 'Financeiro' },
        ],
      },
    },
    { id: 'due', title: 'Prazo', type: 'date' },
    { id: 'review', title: 'Revisão', type: 'date' },
    { id: 'budget', title: 'Orçamento', type: 'numbers' },
    { id: 'owner', title: 'Responsável', type: 'people' },
    { id: 'reviewers', title: 'Aprovadores', type: 'people' },
    { id: 'text_a', title: 'Observação', type: 'text' },
    { id: 'text_b', title: 'Observação', type: 'text' },
    { id: 'calc', title: 'Total calculado', type: 'formula' },
  ]
  const items = [0, 1].map((i) => ({
    id: `${101 + i}`,
    name: `Demanda de teste ${i + 1}`,
    group: { title: 'Demandas' },
    column_values: [
      { id: 'status', text: i ? 'Em testes' : 'Done', value: JSON.stringify({ index: i ? 0 : 1 }) },
      {
        id: 'sector',
        text: i ? 'EXPORTAÇÃO' : 'FISCAL',
        value: JSON.stringify({ index: i ? 3 : 2 }),
      },
      {
        id: 'departments',
        text: 'Compras, exterior, Financeiro',
        value: '{"ids":[1,2]}',
        values: [
          { id: '1', label: 'Compras, exterior' },
          { id: '2', label: 'Financeiro' },
        ],
      },
      { id: 'due', text: '30 out', value: '{"date":"2026-10-30","time":"12:00:00"}' },
      { id: 'review', text: '31 out', value: '{"date":"2026-10-31"}' },
      { id: 'budget', text: 'R$ 1.234,50', value: '"1234.50"' },
      { id: 'owner', text: 'Você', value: '{"personsAndTeams":[{"id":42,"kind":"person"}]}' },
      { id: 'reviewers', text: 'Você', value: null },
      { id: 'text_a', text: 'Primeira observação', value: '"Primeira observação"' },
      { id: 'text_b', text: 'Segunda observação', value: '"Segunda observação"' },
      { id: 'calc', text: '2469', value: null },
    ],
  }))
  return {
    name: 'Migração de teste',
    columns,
    groups: [
      { title: 'Demandas', color: '#df2f4a' },
      { title: 'Grupo vazio', color: '#784bd1' },
    ],
    items_page: { cursor: null, items },
  }
}
