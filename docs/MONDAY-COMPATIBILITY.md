# Compatibilidade da importação monday

Referência: API GraphQL **2026-10**, conferida no schema oficial e em consultas somente de leitura em 27/10/2026. O conector é uma migração sob demanda; não é sincronização e não escreve no monday.

## Como ler a cobertura

- **Nativo:** valores e edição local disponíveis.
- **Convertido:** usa um equivalente do QuadroOS, com diferenças indicadas.
- **Referência:** preserva os dados disponíveis, sem prometer o comportamento calculado/externo da plataforma.
- **Indisponível:** a API ou o download não deu acesso ao recurso. IDs e motivo ficam documentados.

O registro em `shared/monday-capabilities.ts` enumera todos os 43 tipos públicos. Tipos desconhecidos de aplicativos também são preservados como estrutura, sem conversão silenciosa para texto. Somente os campos que a API permite consultar podem ser migrados; preservar um JSON não implementa a funcionalidade correspondente.

## Tipos de coluna

| Tipos da API                                            | Tratamento local                         | Diferenças e limites                                                                                                                                      |
| ------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                                                  | Título e ordem                           | Título fixo na primeira coluna.                                                                                                                           |
| `text`, `long_text`                                     | Texto editável                           | Texto longo usa editor com múltiplas linhas.                                                                                                              |
| `numbers`                                               | Número editável                          | Preserva valor estruturado e unidade exibida; sem todas as formatações monetárias da plataforma.                                                          |
| `status`                                                | Etiquetas editáveis                      | IDs, cores, ordem e indicação de conclusão; múltiplas colunas independentes.                                                                              |
| `people`, `person`                                      | Contatos locais e múltiplos responsáveis | Não cria contas nem convites. Equipes e usuários inacessíveis ficam documentados.                                                                         |
| `item_assignees`                                        | Convertido                               | Usa as identidades que a API disponibilizar; estrutura preservada.                                                                                        |
| `dropdown`                                              | Lista com seleção múltipla               | Nomes contendo vírgulas continuam como uma opção.                                                                                                         |
| `date`                                                  | Data e horário editáveis                 | Instante UTC preservado; edição/exibição usa o fuso do navegador. Datas sem hora continuam sem conversão de fuso.                                         |
| `timeline`                                              | Início/fim editáveis                     | Sem cálculo automático de dias úteis ou dependências.                                                                                                     |
| `checkbox`                                              | Checkbox editável                        | Sem agregações particulares de aplicativos.                                                                                                               |
| `time_tracking`                                         | Cronômetro, histórico e horas manuais    | Duração e sessões disponíveis preservadas; cronômetro ativo retoma a partir da captura. Sem faturamento/relatórios de conta.                              |
| `last_updated`                                          | Atualização calculada localmente         | Data original na importação; alterações futuras refletem o QuadroOS.                                                                                      |
| `file`                                                  | Anexos locais e links externos           | Copia binários acessíveis; documentos externos continuam como links. Downloads com falha são sinalizados.                                                 |
| `subtasks`                                              | Hierarquia e colunas próprias            | Até cinco níveis e 2.000 itens totais. Fonte com profundidade maior interrompe antes da gravação.                                                         |
| `formula`                                               | Convertido ou referência                 | Expressões compatíveis usam IDs locais e são conferidas contra os resultados retornados. Divergências preservam expressão e resultado, sem cálculo falso. |
| `link`, `email`, `phone`                                | Convertido, editável                     | Preserva endereço, legenda/nome e código do país disponíveis.                                                                                             |
| `country`, `location`                                   | Convertido, editável                     | Preserva país/endereço/coordenadas disponíveis; sem busca geográfica externa.                                                                             |
| `rating`, `hour`, `week`, `world_clock`, `color_picker` | Convertido, editável                     | Preserva campos estruturados; controles locais sem todas as preferências de exibição da plataforma.                                                       |
| `board_relation`                                        | Referências editáveis                    | Itens já importados podem ser abertos localmente; os demais IDs ficam identificados. Sem sincronização bidirecional com o monday.                         |
| `dependency`                                            | Referência                               | Vínculos preservados; sem motor de reagendamento automático.                                                                                              |
| `mirror`, `progress`                                    | Referência                               | Resultado/configuração disponíveis; sem agregação ou espelhamento dinâmico equivalente.                                                                   |
| `creation_log`, `item_id`                               | Referência                               | Autor/data e identificador disponíveis.                                                                                                                   |
| `tags`, `vote`, `team`                                  | Referência                               | IDs, seleção e metadados disponíveis; sem replicar taxonomia global, votação e administração de equipes.                                                  |
| `button`, `integration`                                 | Referência                               | Configuração pública preservada; ações/conexões não são ativadas.                                                                                         |
| `auto_number`, `group`                                  | Referência                               | A API não fornece todos os valores calculados de numeração. Grupos reais são migrados pelo vínculo próprio.                                               |
| `doc`, `direct_doc`                                     | Referência                               | Links/metadados disponíveis; sem editor colaborativo de workdocs.                                                                                         |
| `unsupported` e futuros tipos                           | Referência                               | Estrutura original disponível no relatório e célula de referência.                                                                                        |

## Estrutura, conversas e regras

Novos quadros mantêm descrição, grupos (incluindo vazios e nomes repetidos), cores, posição/largura/nomes das colunas e etiquetas. Subitens mantêm pais e ordenação, com definições de colunas próprias. Datas de criação/atualização e IDs de origem permanecem associados. Views, filtros e configurações de origem ficam no relatório; nem toda configuração de view é aplicada automaticamente. Tabela, Kanban e calendário usam os controles próprios do QuadroOS.

Conversas e respostas preservam IDs, autores e datas. O balão abre a aba Atualizações, com editor no topo e respostas agrupadas no cartão de origem; seu contador considera somente as atualizações principais. HTML é sanitizado e imagens são exibidas pelos anexos locais. Contagens de curtidas importadas são mantidas, e o perfil local pode curtir/descurtir sem alterar o histórico original. Fixações ficam em metadados, sem reproduzir notificações e todas as interações sociais do monday. Links oficiais para tarefas já importadas podem abrir seus detalhes locais. A aba Arquivos reúne os anexos das colunas e das conversas.

Receitas legadas com exatamente dois blocos conhecidos — gatilho `223025` e ação `40` — são traduzidas em **status → mover para grupo** quando coluna, etiqueta e destino são resolvidos. Mantêm o estado ativo/pausado e só executam em futuras mudanças reais, depois da importação. A opção de importar regras pode ser desmarcada. Outras receitas e workflows ficam como referência para revisão manual. Credenciais de integrações não são copiadas.

Permissões, convites, membros autenticados, dashboards, notificações, apps, cobrança e sincronização continuam fora da migração. O QuadroOS alpha ainda opera com perfil local fixo.

## Integridade e arquivos

A preparação usa sessão no servidor, com ID aleatório, até três prévias simultâneas e validade de 30 minutos. A aplicação usa a versão canônica dessa sessão. Reiniciar o servidor exige preparar novamente.

Downloads usam HTTPS em hosts de armazenamento permitidos e redirecionamentos revalidados. O token da API nunca acompanha downloads de anexos. O limite padrão é 100 MB por arquivo e 1 GB por prévia, configuráveis por `MAX_MONDAY_FILE_BYTES` e `MAX_MONDAY_IMPORT_BYTES`. Downloads indisponíveis são identificados individualmente. Arquivos preparados ficam temporariamente no sistema operacional; após aplicar/expirar/fechar são removidos. A gravação final de dados e binários usa uma transação no banco.

Reimportações no mesmo quadro reconhecem IDs de origem. Edições locais de tarefas, colunas e regras são mantidas; recursos adicionais são anexados sem duplicar os existentes. Isso não atualiza automaticamente valores já importados com a versão atual do monday. O relatório guarda os valores locais anteriores quando uma coluna legada é convertida, permitindo revisão.

O token fica em memória durante as consultas. URLs temporárias assinadas, credenciais e notas de controle do provedor são excluídas dos dados públicos e relatórios. O relatório contém dados do quadro (incluindo conversas), portanto acompanha a privacidade e o backup do workspace.

## Referências oficiais

- [Tipos de coluna](https://developer.monday.com/api-reference/reference/column-types-reference)
- [Data e horário](https://developer.monday.com/api-reference/reference/date)
- [Controle de horas](https://developer.monday.com/api-reference/reference/time-tracking)
- [Listar automações](https://developer.monday.com/api-reference/docs/list-automations)
- [Schema por versão](https://api.monday.com/v2/get_schema?version=2026-10)

A presença de um campo no schema não garante acesso para toda conta/plano. A prévia e o relatório registram o resultado efetivo de cada importação.

Os resultados e os limites do ensaio real estão em [VALIDATION.md](VALIDATION.md). As capturas de interface usam dados fictícios: [quadro](screenshots/quadroos-monday-completo.png), [conversas](screenshots/quadroos-monday-conversas.png) e [celular](screenshots/quadroos-monday-celular.png).
