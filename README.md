# QuadroOS

**Seu trabalho, em um lugar.**

Gestão de tarefas e projetos em português, com quadros flexíveis e uma instalação que pode ser sua. Construído com React, TypeScript e Node.js. Inspirado na praticidade dos quadros de trabalho, com identidade própria.

![QuadroOS com tema claro, navegação lateral e tarefas organizadas por grupos](docs/screenshots/quadroos.png)

> **0.1.0 · Alpha local:** a versão atual funciona com um perfil local, sem autenticação ou permissões por equipe. É uma base para desenvolvimento e avaliação. Não publique a API em um ambiente compartilhado antes de implementar a etapa de identidade e acesso.

## Começar

Requisito: **Node.js 22.12+ ou 24 LTS**, com npm.

```sh
npm ci
npm run dev
```

Abra **http://127.0.0.1:5173**. A API roda em `127.0.0.1:3001`.

A primeira execução cria quadros e pessoas fictícias para explorar o produto. Os dados são persistidos em `data/postgres/`, ignorado pelo Git. O PostgreSQL embarcado usa [PGlite](https://pglite.dev/), sem exigir Docker ou uma instalação de banco para experimentar.

Para começar vazio, copie `.env.example` para `.env` e configure `SEED_DEMO=false` **antes da primeira execução**. Isso não remove registros já criados. A configuração local fica fora do controle de versão.

## O que funciona

- Criar quadros, grupos e tarefas; marcar quadros como favoritos.
- Editar o nome e a cor dos grupos pelo menu de três pontos.
- Expandir tarefas e criar subitens persistidos, com status, prioridade, responsáveis, prazo e comentários próprios, até cinco níveis.
- Subitens em tabela recuada, com conexões à tarefa principal, avatares, comentários por linha e criação rápida no rodapé. Seleção independente para alterar status ou excluir em lote. O botão **+** escolhe as colunas visíveis (incluindo prioridade e campos extras), com preferência salva por quadro.
- Editar títulos com dois cliques (ou Enter/F2 pelo teclado), salvando ao sair ou pressionar Enter. Escape cancela a edição.
- Segurar e arrastar o título ou o puxador para reordenar tarefas dentro do grupo e subitens dentro da mesma tarefa. No teclado, focar o puxador e usar Espaço, setas e Espaço; Escape cancela. A ordem manual é persistida, inclusive com filtros ativos. Para arrastar tarefas principais, selecione **Ordem manual** e **Por grupo**.
- Redimensionar colunas pela borda direita do cabeçalho no desktop, com prévia em todos os grupos e largura persistida por quadro. Setas ajustam pelo teclado; dois cliques restauram a largura padrão; Escape cancela o arraste.
- Mudar a posição das colunas arrastando o nome no cabeçalho ou usando o menu para mover à esquerda/direita. A ordem é salva por quadro, com configuração independente para os subitens; a coluna de título permanece fixa.
- Atribuir várias pessoas à mesma tarefa ou subitem, com busca e avatares agrupados. Filtros, Meu trabalho, Kanban, carga de trabalho e exportação consideram todos os responsáveis. Subitens novos herdam a equipe da tarefa principal.
- Clicar no prazo para abrir um calendário em português, escolher uma data, digitar o prazo, definir hoje ou remover a data, incluindo nos detalhes e na criação de tarefas.
- Alterar responsáveis, status, prioridade e prazos na tabela, com salvamento automático.
- Interface inspirada em quadros de trabalho: faixa de atalhos, navegação recolhível com busca de quadros e tabela com células coloridas de status/prioridade, usando shadcn/ui e navegação por teclado.
- Resumo de status e prioridades abaixo de **Adicionar item**, alinhado às colunas. Cada segmento aumenta ao passar o mouse ou receber foco e mostra etiqueta, quantidade e percentual em um cartão; no celular, abre por toque. Inclui colunas de status personalizadas e acompanha os itens visíveis do grupo.
- Seletores personalizados e consistentes nos formulários, filtros, grupos e importação, com cores de contexto, opção selecionada, suporte a teclado/toque e menus dentro dos diálogos. A interface usa React e shadcn/ui, com apresentação independente do framework escolhido.
- Padrão visual compartilhado por navegação, botões, menus, formulários, detalhes da tarefa, importação, automações, ajuda, notificações e configurações. Abas segmentadas, campos em grade nos detalhes e layout adaptado ao celular, preservando as linhas compactas do quadro.
- Criação rápida de itens dentro do grupo e etiquetas personalizadas por quadro, preservadas após recarga.
- **Automação** por quadro, sem regras predefinidas: criar, editar, ativar/pausar e excluir regras como “quando Status mudar para Feito, mover item para Concluídas”. O histórico registra as movimentações. Colunas de status personalizadas e prioridade também podem ser usadas como gatilho.
- Status iniciais: **Feito**, **Em andamento**, **Parado**, **Não iniciado**, **Aguardando** e **Contínuo**, com as cores da referência do monday. O editor permite definir quais etiquetas representam conclusão; importações preservam essa indicação da origem.
- Seleção de tarefas e alteração de status em lote, com confirmação para excluir.
- Busca, filtros por status/prioridade/pessoa, ordenação e agrupamento por grupo ou status.
- Catálogo de colunas pelo botão **+**: **Status, Texto, Pessoas, Arquivos, Lista suspensa, Data, Números e Fórmula**. Cada coluna extra tem nome, tipo e valores próprios; Status e Lista suspensa permitem configurar opções e cores.
- **Arquivos** em tarefas e subitens: múltiplos anexos, envio por seleção ou arraste, download e exclusão com confirmação. Limite de 5 MB por arquivo e 20 arquivos por célula. Os conteúdos e metadados são persistidos no banco, acompanhando o backup do workspace. Excluir a tarefa ou a coluna remove seus anexos.
- **Fórmula** por linha, com referências como `{Quantidade} * {Preço}` e resultados atualizados ao editar os campos. Suporta aritmética, porcentagem, comparações, concatenação e `SOMA`, `MEDIA`/`MÉDIA`, `MIN`, `MAX`, `SE`, `SEERRO`, `ARRED`, `ABS`, `E`, `OU` e `CONCAT`, incluindo os aliases em inglês. Use ponto nos decimais e ponto e vírgula entre argumentos. Referências acompanham a renomeação de colunas; divisões por zero, campos excluídos e ciclos têm erros explícitos. O resultado é somente leitura e a exportação CSV inclui os valores calculados. Esta versão calcula campos da mesma tarefa ou subitem; não implementa toda a linguagem do Excel nem intervalos entre linhas. Os tipos Arquivos e Fórmula permanecem fixos após a criação.
- Editar colunas pelo menu do cabeçalho, renomear, trocar tipos quando os valores são compatíveis e excluir campos extras com confirmação. Renomear opções atualiza os valores das tarefas e subitens; conversões incompatíveis preservam os dados e exibem um erro.
- Renomear ou ocultar as colunas principais, com visibilidade persistida. Campos criados pelos subitens aparecem ali automaticamente e podem ser exibidos na tabela principal pelo menu Colunas. Os campos extras também ficam disponíveis nos detalhes da tarefa.
- Kanban com alteração de status e visão geral com distribuição das tarefas.
- Balão de comentários abre o painel de Atualizações: editor no topo, cartões por conversa, respostas agrupadas e curtidas locais persistidas. O contador soma atualizações principais. Arquivos e Detalhes ficam em abas próprias.
- Importação de CSV e Excel, com mapeamento, prévia, relatório e histórico.
- Conector monday via token pessoal, seleção de quadros e paginação de tarefas.
- Exportação CSV, tema claro, layout adaptado para celular e navegação por teclado.

O progresso e o Kanban contam tarefas principais; o avanço dos subitens aparece dentro de cada tarefa. A busca e os filtros também encontram subitens e mostram a tarefa principal como contexto. Alterar status não muda o grupo por padrão. Grupos, inclusive Concluídas, não impõem status às tarefas. Uma movimentação configurada em Automação usa View Transitions quando disponível e respeita a preferência de movimento reduzido.

As automações são executadas somente em mudanças reais de etiqueta nas tarefas principais. Criar, importar, renomear ou atribuir novamente o mesmo status não executa regras; ativá-las também não reorganiza tarefas existentes. Os subitens acompanham o movimento do pai e mantêm seus status. Para retornar tarefas a outro grupo ao reabrir, crie uma segunda regra. Uma condição tem apenas uma regra; se várias colunas mudarem juntas e combinarem com regras diferentes, a primeira regra criada tem prioridade. Os identificadores das opções preservam as regras ao renomear etiquetas. Colunas ou opções removidas precisam ser revistas antes de reativar a regra. As últimas 100 execuções ficam disponíveis mesmo após excluir a automação.

## Importação

Use **Importar** no quadro ou **Importações** na navegação.

### CSV e Excel

1. Envie um `.csv` ou `.xlsx` de até **5 MB**, **2.000 linhas** e **60 colunas**.
2. Escolha um quadro existente ou dê nome a um novo quadro.
3. Relacione as colunas com os campos de tarefa. Colunas extras podem virar campos de texto.
4. Confira a prévia e importe.

O CSV aceita vírgula, ponto e vírgula ou tabulação; UTF-8 com ou sem BOM e fallback Windows-1252. Datas aceitam `DD/MM/AAAA` e `AAAA-MM-DD`; datas impossíveis são preservadas na descrição. Excel importa apenas a primeira aba. A detecção do cabeçalho tenta reconhecer os formatos mais comuns; a exportação do monday pode variar, então confira sempre a prévia.

Na importação de arquivos, responsáveis são relacionados com pessoas locais pelo nome completo ou e-mail. Quem não tiver correspondência fica registrado na descrição, sem criação automática de conta ou envio de convite. Status e prioridades comuns em português/inglês são convertidos; valores sem equivalência ficam na descrição. O conector monday oferece a opção de preservar seus responsáveis como contatos locais, descrita abaixo.

Tarefas importadas com status Feito permanecem no grupo informado na importação. A exportação inclui os subitens e a coluna “ID da tarefa principal”, para identificar seu vínculo. A reimportação de hierarquia ainda não é suportada; o vínculo não é reconstruído automaticamente.

Na atualização dos status, tarefas existentes com “Concluído” passam a “Feito” e “Em revisão” passa a “Aguardando”, preservando os demais dados e comentários. A conversão é registrada e executada uma única vez na inicialização do banco. A importação continua aceitando esses rótulos antigos, assim como Done, Working on it, Stuck, Waiting e Continuous.

Quando há uma coluna identificadora, a repetição é reconhecida por origem + ID + quadro de destino. Sem identificador, arquivos usam um hash do conteúdo importado da linha. **Linhas idênticas são consideradas a mesma tarefa**; uma linha alterada sem ID passa a ser uma nova tarefa. Reimportação ignora registros já migrados; ainda não atualiza tarefas existentes.

Experimente [examples/tarefas.csv](examples/tarefas.csv).

### monday.com

O conector usa a [API GraphQL oficial](https://developer.monday.com/api-reference/docs/authentication), exclusivamente para leitura. O token fica na memória durante o fluxo, é enviado ao servidor para as consultas e não é salvo no banco, em arquivos ou em logs. A interface limpa o token ao preparar a prévia ou fechar a janela.

O conector importa tarefas ativas e subitens de até cinco níveis, grupos, conversas/respostas e anexos acessíveis. O limite atual é de 2.000 tarefas e subitens por importação. Há paginação, timeout e tentativas limitadas para restrições de consulta. A versão padrão é **2026-10**, configurável por `MONDAY_API_VERSION`.

Status, Lista suspensa, Data/horário, Números, Pessoas, Texto, Cronograma, Checkbox, Controle de horas, Última atualização e Arquivos mantêm valores estruturados e interações locais. “SETOR” continua sendo Status quando assim definido na origem, mesmo havendo outras colunas de Status. Etiquetas mantêm cores, ordem e indicação de conclusão. Subitens podem ter colunas e paletas próprias. Novos quadros preservam ordem e largura das colunas, cores e grupos vazios; campos principais sem correspondência ficam ocultos. O calendário permite visualizar datas e cronogramas, abrir tarefas e movê-las entre dias.

Conversas preservam autores, datas e respostas. Formatação é sanitizada antes da exibição; imagens acessíveis ficam como anexos locais. Downloads são preparados em sessão temporária e gravados junto aos dados na transação da importação. O limite padrão do conector é de 100 MB por arquivo e 1 GB por prévia; os limites de upload manual continuam separados. Falhas individuais aparecem na cobertura e no relatório.

A opção **Preservar os responsáveis do monday** cria contatos locais para pessoas que faltarem, sem enviar convites. Pessoas existentes são relacionadas por e-mail ou nome; múltiplos responsáveis permanecem associados. Desative a opção para usar somente contatos existentes. Se a API não permitir consultar pessoas, os nomes disponíveis continuam sendo usados, com aviso para conferir correspondências.

A reimportação reconhece IDs de origem e preserva edições locais. Tarefas, conversas, anexos e regras já importados não são duplicados. Colunas antigas importadas como texto podem ser atualizadas para o tipo correto; valores anteriores ficam no relatório. A gravação é atômica. A sessão preparada expira após 30 minutos e não sobrevive à reinicialização do servidor.

Fórmulas compatíveis são traduzidas e comparadas com os resultados da origem; expressões incompatíveis ficam como referência explícita. Automações com receita confirmada de **mudança de status → mover para grupo** podem virar regras locais, sem execução retroativa. As demais são documentadas para revisão. Conexões externas não são ativadas.

Cada importação disponibiliza um relatório com cobertura e dados originais sanitizados. O registro explícito cobre os **43 tipos de coluna do schema 2026-10**; isso não significa equivalência funcional para todos. Espelhos, reagendamento por dependência, documentos colaborativos, aplicativos, permissões e dashboards ainda exigem implementação/configuração própria. Relações preservam referências e abrem itens de quadros já importados. Sincronização contínua não existe. Consulte [a matriz de compatibilidade](docs/MONDAY-COMPATIBILITY.md).

O conector foi validado com consultas de leitura em uma conta real e importações em uma base temporária em memória, incluindo um quadro com mais de 200 tarefas e várias páginas. Os testes automatizados usam somente dados sintéticos; nenhuma credencial ou tarefa real acompanha o repositório.

## PostgreSQL externo

Para conectar um servidor PostgreSQL, configure no `.env`:

```dotenv
DATABASE_URL=postgres://quadro:senha@localhost:5432/quadro
```

A inicialização cria as tabelas e índices com comandos idempotentes. Ambos os adaptadores usam o mesmo SQL e consultas parametrizadas. **Alterar a URL não transfere automaticamente os dados do banco embarcado**. Migrações versionadas e um comando de backup/restauração estão no roadmap.

## Executar o build

```sh
npm run build
npm start
```

Abra **http://127.0.0.1:3001**. O Fastify serve a API e os arquivos construídos pelo Vite. `HOST` define a interface de rede e `APP_ORIGIN` a origem autorizada para gravações. O padrão é loopback. Na operação atual, não há login, controle por usuário, sincronização entre clientes ou garantia de colaboração simultânea; o controle de versão impede sobrescrever uma tarefa alterada por outra janela.

### Docker Compose

```sh
docker compose up --build
```

O Compose sobe a aplicação e um PostgreSQL separado, com volume persistente, acessíveis em **http://127.0.0.1:3001**. As credenciais padrão do Compose são apenas de desenvolvimento local. Docker é uma alternativa opcional; o fluxo `npm run dev` não depende dele.

## Verificação

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Os testes de API e importação usam PostgreSQL embarcado em memória. Os testes de navegador iniciam servidores isolados nas portas 3002 e 5174, também com dados em memória, sem tocar no workspace pessoal. Incluem criação/edição, persistência ao recarregar, comentários, importação, exportação, navegação mobile e verificações automatizadas de acessibilidade com axe. Nenhum teste automatizado chama o monday real.

O registro da primeira verificação está em [docs/VALIDATION.md](docs/VALIDATION.md). Para manter o estilo do código, use `npm run format` e `npm run format:check`.

## Estrutura

```text
src/                 Interface React e componentes
server/              API, banco, seed e conectores de importação
shared/              Tipos e regras compartilhadas
tests/               Testes de domínio/API e navegador
design-system/       Decisões visuais e de interação
examples/            Arquivo de demonstração para importar
```

## Próximas entregas

- [ ] Cadastro inicial do administrador, login e sessões.
- [ ] Convites, equipes, workspaces e permissões aplicadas na API.
- [ ] Histórico de alterações e atualização entre clientes.
- [ ] Importações grandes em jobs persistidos, cancelamento e retomada.
- [x] Subitens, anexos e comentários no conector monday.
- [ ] Equivalência de espelhos, dependências com reagendamento e documentos colaborativos.
- [ ] Mapeamento configurável de status e pessoas durante a migração.
- [ ] Migrações de banco versionadas e backup/restauração.
- [ ] Paginação/virtualização para quadros grandes.
- [ ] Internacionalização e tema escuro opcional.

## Contribuir

Veja [CONTRIBUTING.md](CONTRIBUTING.md). O projeto usa a [licença MIT](LICENSE).
