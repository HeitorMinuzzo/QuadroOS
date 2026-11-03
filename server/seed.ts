import { type Database } from './database.ts'
import { localDate } from '../shared/domain.ts'
import { completedGroup } from './repository.ts'

export async function seed(db: Database, demo = true) {
  await db.query(
    `INSERT INTO people VALUES ('person-you','Você','VC','#205c48','voce@quadro.local') ON CONFLICT DO NOTHING`,
  )
  if (!demo || (await db.query('SELECT id FROM boards LIMIT 1')).rows.length) return
  await db.transaction(async (tx) => {
    const people = [
      ['person-ana', 'Ana Costa', 'AC', '#bd653c', 'ana@example.com'],
      ['person-lucas', 'Lucas Martins', 'LM', '#647ac1', 'lucas@example.com'],
      ['person-julia', 'Júlia Santos', 'JS', '#9c61a1', 'julia@example.com'],
      ['person-pedro', 'Pedro Lima', 'PL', '#62865b', 'pedro@example.com'],
    ]
    for (const person of people)
      await tx.query('INSERT INTO people VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', person)
    for (const [id, name, description, color, icon, favorite] of [
      [
        'board-ti',
        'Assuntos de TI',
        'Um espaço para conectar ideias, organizar demandas e fazer acontecer.',
        '#4f8b74',
        'board',
        true,
      ],
      [
        'board-product',
        'Produto & Design',
        'Da primeira ideia à próxima grande entrega.',
        '#8b79bd',
        'design',
        true,
      ],
      [
        'board-marketing',
        'Marketing',
        'Campanhas, conteúdo e boas conversas.',
        '#c2884e',
        'marketing',
        false,
      ],
    ])
      await tx.query(
        'INSERT INTO boards (id,name,description,color,icon,favorite) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, name, description, color, icon, favorite],
      )
    const groups = [
      ['group-week', 'board-ti', 'Esta semana', '#377f68', 0],
      ['group-next', 'board-ti', 'Próximas entregas', '#6f80be', 1],
      ['group-done', 'board-ti', 'Concluídas', '#377f68', 2],
      ['group-product', 'board-product', 'Em construção', '#8b79bd', 0],
      ['group-marketing', 'board-marketing', 'No radar', '#c2884e', 0],
    ]
    for (const group of groups)
      await tx.query(
        'INSERT INTO groups (id,board_id,name,color,position) VALUES ($1,$2,$3,$4,$5)',
        group,
      )
    await tx.query("UPDATE groups SET is_completed=true WHERE id='group-done'")
    for (const boardId of ['board-product', 'board-marketing']) await completedGroup(tx, boardId)
    const tasks = [
      ['Revisar permissões de acesso', 'Em andamento', 'Alta', 'person-you', 1, 'group-week'],
      [
        'Atualizar o dashboard de indicadores',
        'Em andamento',
        'Média',
        'person-ana',
        2,
        'group-week',
      ],
      [
        'Documentar o processo de onboarding',
        'Aguardando',
        'Média',
        'person-julia',
        0,
        'group-week',
      ],
      [
        'Configurar backup dos servidores',
        'Não iniciado',
        'Urgente',
        'person-lucas',
        -1,
        'group-week',
      ],
      ['Integrar chamados com o ERP', 'Em andamento', 'Alta', 'person-pedro', 3, 'group-week'],
      ['Homologar a nova versão do sistema', 'Parado', 'Alta', 'person-you', 4, 'group-week'],
      [
        'Planejar a renovação de equipamentos',
        'Não iniciado',
        'Média',
        'person-ana',
        7,
        'group-next',
      ],
      [
        'Reorganizar a base de conhecimento',
        'Não iniciado',
        'Baixa',
        'person-julia',
        9,
        'group-next',
      ],
      ['Mapear melhorias na rede interna', 'Não iniciado', 'Média', null, 10, 'group-next'],
      ['Publicar o guia de segurança', 'Em andamento', 'Baixa', 'person-lucas', 6, 'group-next'],
      ['Migrar os arquivos da equipe', 'Feito', 'Média', 'person-pedro', -3, 'group-done'],
      ['Organizar o inventário de licenças', 'Feito', 'Baixa', 'person-you', -2, 'group-done'],
      ['Definir a identidade visual', 'Em andamento', 'Alta', 'person-julia', 2, 'group-product'],
      [
        'Desenhar o fluxo de boas-vindas',
        'Não iniciado',
        'Média',
        'person-ana',
        5,
        'group-product',
      ],
      [
        'Preparar o calendário editorial',
        'Não iniciado',
        'Média',
        'person-pedro',
        7,
        'group-marketing',
      ],
    ]
    for (const [i, [title, status, priority, owner, day, group]] of tasks.entries()) {
      const date = new Date()
      date.setDate(date.getDate() + Number(day))
      const board =
        group === 'group-product'
          ? 'board-product'
          : group === 'group-marketing'
            ? 'board-marketing'
            : 'board-ti'
      const now = new Date().toISOString()
      await tx.query(
        `INSERT INTO tasks (id,board_id,group_id,title,description,status,priority,due_date,owner_id,position,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
        [
          `task-${i + 1}`,
          board,
          group,
          title,
          'Organize aqui as informações, os próximos passos e tudo o que o time precisa saber sobre esta entrega.',
          status,
          priority,
          localDate(date),
          owner,
          i,
          now,
        ],
      )
    }
    await tx.query(
      `INSERT INTO comments (id,task_id,author_id,body,created_at) VALUES ('comment-1','task-1','person-ana','Checklist atualizado. Já podemos revisar os acessos com a equipe.', $1), ('comment-2','task-3','person-you','Primeira versão pronta para revisão. Sugestões são bem-vindas!', $1)`,
      [new Date().toISOString()],
    )
  })
}
