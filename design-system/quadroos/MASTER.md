# QuadroOS · Design system

## Direção

Aplicativo de gestão de trabalho com tema claro como padrão, inspirado na organização de um quadro tabular e com identidade própria. Interface calma, compacta e legível. Conteúdo e ações têm prioridade sobre decoração.

Base visual compacta com tabela filtrável, estados de carregamento, exportação e tipografia de dados. A evolução dos controles usa **shadcn/ui, preset Nova, primitivas Radix e Tailwind v4**, preservando a identidade do QuadroOS. Componentes ficam em `src/components/ui/`; tokens em `src/theme.css`. `src/workflow.css` cuida do quadro; `src/controls.css` dos seletores; `src/automations.css` da composição das regras. `src/interface.css` define a apresentação compartilhada da navegação, formulários, menus, janelas e estados de feedback.

## Identidade

- Marca: símbolo de quatro blocos na faixa de aplicativos, logotipo `quadroOS` na navegação.
- Tipografia: Inter Variable, servida localmente via @fontsource-variable/inter.
- Cor principal: azul `#0073ea`; hover `#0060b9`; violeta para a marca e atalhos.
- Texto principal `#323338`; secundário `#5e6880`.
- Quadro branco; navegação clara `#f7f8fc`; faixa de atalhos `#20243b`; bordas `#e0e4ee`.
- Status padrão: Feito (verde `#00c875`), Em andamento (laranja `#fdab3d`), Parado (rosa `#e2445c`), Não iniciado (cinza `#798099`), Aguardando (azul `#00a0e9`) e Contínuo (roxo `#a25ddc`). Status, prioridades e qualquer coluna do tipo Status (inclusive renomeada ou nos subitens) aparecem como etiquetas arredondadas (raio de 8 px) com um pequeno recuo dentro da célula; o mesmo raio vale em formulários, detalhes e Kanban. Etiquetas podem ter nomes e cores próprios por quadro. O texto permanece branco por escolha visual explícita do usuário. Títulos de grupos usam um tom legível da cor do grupo; a faixa lateral mantém a cor original.
- Ícones: Lucide, traço consistente; controles isolados com nome acessível.

## Estrutura

- Navegação em duas faixas no desktop. A faixa escura de 64 px troca de workspace (um botão com a inicial de cada um, vindo do caminho importado do monday; quadros sem workspace ficam em "Meu espaço"), com ajuda e preferências no rodapé. O painel claro mostra só o workspace escolhido: título com menu de workspaces, botão Novo (quadro ou importação), Início, Meu trabalho e Atrasadas com contadores, busca, Favoritos, Recentes e a árvore de pastas com contagem. Pastas começam fechadas, exceto o caminho do quadro aberto; a busca abre todas; Arquivados fica por último. Quadros criados entram no workspace aberto. No celular, abertura explícita e scrim.
- "Visão do espaço" (`#/workspace`) reúne todos os quadros: resumo de tarefas abertas, atribuídas a você, atrasadas e progresso geral; cartões de quadros com cor, favoritos, atrasos e progresso; listas de Minhas tarefas e Atrasadas de todos os quadros, que abrem os detalhes sem sair da página. Indicadores contam só tarefas principais. Em uma coluna, as listas vêm antes dos quadros.
- "Meu trabalho" (`#/mine`) lista as tarefas principais abertas atribuídas a você em todos os quadros, agrupadas em Atrasadas, Hoje, Próximos 7 dias, Mais adiante e Sem prazo. O status muda direto na lista; o título abre os detalhes; atalhos por quadro abrem o quadro com o filtro Minhas tarefas. "Mostrar concluídas" acrescenta as concluídas. O contador da navegação usa o mesmo recorte.
- Barra superior com caminho atual, estado de gravação, busca e notificações de prazo.
- Cabeçalho do quadro, abas Tabela/Kanban/Visão geral e barra com criação de itens, pesquisa e filtros. Indicadores completos ficam em Visão geral; a tabela mantém apenas um resumo de conclusão junto às abas.
- Tabela sem rolagem da página na horizontal. Colunas personalizadas ficam em uma região com rolagem própria. No celular, resumo reduzido da tabela e detalhes completos na lateral.
- Formulários e detalhes com dialog nativo; editor de grupo com Dialog do shadcn. Selects em dialogs nativos renderizam seus popovers dentro da camada do dialog, mantendo seleção e teclado funcionais.
- Linhas de 40 px no desktop e 44 px no celular, grupos com títulos coloridos e barras de distribuição no rodapé da tabela. Espaçamentos baseados em múltiplos de 4; sombras reservadas a sobreposições.

## Interação

- Uma ação principal por contexto; criação de tarefa em destaque no quadro.
- “Novo item” abre o formulário; a seta ao lado oferece grupo e coluna. A linha de criação rápida mantém o texto se houver erro e só limpa após a gravação. “Editar etiquetas” é acessível por teclado no menu de status/prioridade.
- Títulos entram em edição com dois cliques ou Enter/F2; salvam ao sair do campo ou pressionar Enter. Escape cancela. Um clique mantém o título em leitura, permitindo segurar e arrastar.
- Arraste pelo título ou puxador com prévia flutuante e animação das posições. No mouse, iniciar ao mover mais de 4 px com o botão pressionado, sem espera por tempo; o pequeno limite preserva cliques e edição por dois cliques. Ordenação manual fica dentro do grupo; subitens ficam dentro da mesma tarefa. O bloco expandido acompanha a tarefa. Espaço e setas permitem ordenar pelo teclado; Escape cancela. Filtros preservam os itens ocultos na ordem gravada.
- Bordas direitas dos cabeçalhos redimensionam colunas no desktop, com limites de largura e atualização simultânea de todos os grupos. Larguras são persistidas por quadro, incluindo colunas personalizadas. Separadores acessíveis permitem ajuste por setas; Escape cancela e dois cliques restauram o padrão. No celular, manter o resumo compacto.
- Catálogo Essenciais no + dos cabeçalhos, em três colunas com todos os tipos, nomes em uma linha só (duas colunas no menu dos subitens e em telas estreitas). Usar ícones coloridos, editor com cartões de tipo, nome e opções com cores. O menu do cabeçalho permite editar; colunas principais mantêm seus tipos e podem ser renomeadas ou ocultadas. Exclusão de campos extras exige confirmação no produto.
- Arquivos usam popover com lista, nomes para download, tamanho, envio múltiplo por seleção/arraste, limites visíveis e confirmação de exclusão. Preservar foco e o portal do dialog nativo. Fórmulas têm resultado somente leitura na célula e expressão configurável no editor da coluna, com referências inseríveis, funções e exemplos; erros de cálculo têm código e explicação. As duas composições seguem os tokens compartilhados e funcionam nos subitens e nos detalhes.
- Identificadores de colunas e opções permanecem estáveis ao renomear. Atualizar valores selecionados em tarefas e subitens na mesma transação; impedir remoção de opções em uso e mudanças de tipo incompatíveis. Excluir uma coluna limpa seus valores e preferências de layout, preservando tarefas e outros campos. Rejeitar gravações antigas em campos excluídos.
- Campos de Pessoas e Lista suspensa aceitam várias seleções; datas genéricas usam o calendário com rótulos de data. Status e prioridade não movimentam tarefas por padrão. A área Automação permite configurar explicitamente mudanças de etiqueta que movem tarefas para um grupo, inclusive a partir de status personalizados.
- Automação apresenta regras em cartões com frase legível, etiqueta colorida, grupo de destino, descrição, estado e menu de edição/exclusão. Sem regras predefinidas; criação e ativação não reorganizam tarefas existentes. Incluir busca, filtro de ativas/pausadas e histórico real de execuções. No celular, manter acesso pelo botão de robô junto às abas do quadro.
- Seleções salvam ao mudar.
- Usar FieldSelect, composto pelo Select do shadcn/Radix, nos campos de grupo, filtros, importação e configuração de automações. Menus com bordas suaves, sombra, opção marcada e indicadores de cor; preservar rótulos, navegação por teclado, seleção por toque e foco no dialog nativo. Seletores coloridos de status/prioridade na tabela mantêm sua apresentação própria.
- Automação usa uma superfície clara com resumo de regras/ativas/execuções, abas segmentadas e cartões que separam Quando de Então. O editor organiza gatilho e destino em etapas; descrição, estado, histórico e validações continuam reais. Preservar a apresentação aprovada dos grupos e tarefas.
- Texto das etiquetas de status e prioridade fica sempre branco, incluindo opções, cartões e prévias do editor, preservando as cores de fundo escolhidas no quadro.
- Cabeçalhos de campos permitem arraste horizontal e menu de posição com ações à esquerda/direita, acessíveis por teclado e toque. Manter título e controles de seleção fixos. Gravar ordem por quadro, independente entre tarefas e subitens, preservando larguras e colunas ocultas. Falhas restauram a ordem confirmada e exibem erro.
- Responsáveis usam seleção múltipla em popover com busca, checkboxes e avatares sobrepostos. A seleção recebe retorno visual imediato durante o salvamento e reverte em caso de falha. Todos os responsáveis participam dos filtros e contagens; novos subitens herdam a equipe da tarefa.
- Prazo abre um calendário shadcn em português ao clicar na célula, com escolha de dia, entrada manual, Hoje e Remover prazo. Manter foco, Escape, salvamento e mensagens de erro funcionais também nos dialogs nativos e no celular.
- Salvamento só aparece como concluído após resposta do servidor; conflitos recarregam a versão atual e exibem erro.
- Busca e filtros combináveis; estados vazios oferecem um próximo passo.
- Exclusão com confirmação; importação com prévia e relatório de compatibilidade.
- Seta na linha expande subitens; contador mostra quantos existem. Cada subitem tem campos e comentários próprios e pode ser aberto nos detalhes. Não há conclusão pelo botão de expandir.
- Subitens formam uma tabela branca recuada 52 px, com borda e ramificações na cor do grupo da tarefa. A conexão alcança a linha de adicionar subitem mesmo sem itens cadastrados e acompanha mudanças de cor ou grupo, inclusive nos detalhes. Cabeçalho de 34 px e linhas de 36 px; padrão com responsável, status e prazo. O botão + mostra prioridade e campos personalizados do quadro, sem apagar dados ao ocultar e com preferência persistida por quadro. Comentários têm sua própria célula; criação rápida fica no rodapé e preserva o texto em caso de erro. Checkboxes selecionam apenas subitens para ações em lote. No celular e nos detalhes, manter rolagem própria da tabela e menus dentro da camada do dialog nativo.
- Nome e cor do grupo editáveis pelo menu de três pontos, com prévia e erro junto ao formulário.
- Quadros começam sem automações. Mover uma tarefa ao mudar uma etiqueta depende de uma regra criada e ativada pelo usuário. Subitens acompanham o grupo da tarefa e mantêm status independentes; indicadores contam apenas tarefas principais.
- Mudanças de grupo animam a linha pelo View Transitions, com duração de 550 ms; navegadores sem suporte aplicam a mudança diretamente.
- Movimento reduzido respeitado; nenhuma ação depende exclusivamente de arrastar ou de hover.
- Na soltura, aplicar a ordem visual antes de medir o destino da animação. Mantê-la durante a fila de gravações; respostas anteriores não devem desfazer uma movimentação mais recente. Se a gravação falhar, recuperar a ordem confirmada e exibir o erro.
- A prévia acompanha apenas o eixo vertical. Sua tipografia e posição inicial seguem o texto do título; a soltura termina na mesma referência de texto, sem usar a borda esquerda da linha como destino. Isso preserva o alinhamento quando a prévia desaparece, inclusive com as colunas de seleção e expansão antes do nome.

## Padrão compartilhado da interface

- O resumo fica no rodapé da própria tabela, depois da linha Adicionar item, preservando o alinhamento ao redimensionar, ordenar ou ocultar colunas. Barras de status, prioridade e campos de status personalizados contam apenas as tarefas principais visíveis no grupo; valores sem etiqueta também entram no total. Segmentos ampliam no hover/foco, respeitam movimento reduzido e exibem cartões claros com cor, etiqueta, contagem e percentual. Usar Tooltip no mouse/teclado e Popover em dispositivos sem hover, com abertura e fechamento por toque.

- `src/refresh.css`, carregado por último, concentra o acabamento atual da navegação, cabeçalho, barra de ferramentas, menus, janelas e vistas alternativas (tokens `--rf-*`). Ele não altera linhas nem células das tabelas dos grupos. Na navegação, o quadro ativo fica destacado em branco com sombra leve; no cabeçalho, título e ações ocupam a primeira linha e a descrição usa a largura total, sem deslocar as abas entre as vistas.
- Usar os tokens `--ui-*` para texto, bordas, superfícies, foco e sombras, em vez de definir uma paleta nova a cada janela. Texto de apoio `#5e6b82`, texto de controles `#34415c`, superfície secundária `#f8f9fd` e borda de campos `#dce2ed`.
- Campos com 40 px, ações principais com 38 px, raios de 9 px nos controles, 12 px nos menus, 14 px nos cartões e 18 px nas janelas. As linhas compactas das tabelas e os dias do calendário seguem suas próprias medidas e estados.
- Tabela/Kanban/Visão geral, origens de importação e abas de automação usam a mesma composição segmentada `view-tabs`.
- Dialogs nativos e Radix compartilham títulos, descrições, sombra, fundo desfocado e rodapé. Preservar o portal dos menus dentro do dialog nativo, o foco por teclado e o fechamento por Escape.
- Detalhes da tarefa usam uma grade de propriedades com rótulos acima dos campos. Descrição, comentários, importação, configurações, ajuda e notificações seguem as mesmas superfícies e hierarquia de texto.
- O menu Colunas usa Popover com checkboxes e permite fechar por Escape, devolver o foco e abrir o editor de coluna. No celular, manter as ferramentas em uma linha sem rolagem horizontal da página e a gaveta de tarefa com largura total.

## Verificação

Testar 375 px, desktop e paisagem; conferir teclado e foco; verificar contraste com axe; manter erros próximos aos formulários e regiões de status para feedback assíncrono. Não usar dados reais nas demonstrações.
