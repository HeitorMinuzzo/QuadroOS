# Contribuir com o QuadroOS

O objetivo é criar uma ferramenta de trabalho clara, acessível e fácil de hospedar. Mudanças pequenas e verificáveis são bem-vindas.

1. Abra uma issue descrevendo o problema ou proposta. Para alterações maiores de arquitetura, discuta o objetivo antes de implementar.
2. Crie uma branch a partir de `main` e mantenha cada PR focado em um objetivo.
3. Use TypeScript, consultas parametrizadas e os tipos em `shared/`.
4. Interfaces precisam ter rótulos, foco visível, tratamento de erro e comportamento em telas pequenas. Evite ações visuais sem funcionalidade.
5. Execute `npm test` e `npm run build`. Para alterações visuais/fluxos, execute `npm run test:e2e`.
6. Explique no PR o comportamento alterado, a validação feita e os limites conhecidos.

Não inclua tokens, `.env`, bancos de dados nem exportações reais de clientes em issues, exemplos ou commits. Os exemplos devem conter apenas dados fictícios.

Conectores adicionais devem converter a origem para a mesma prévia de importação, mantendo os identificadores externos e relatando os dados incompatíveis. O importador deve preservar os dados existentes e concluir a gravação em transação.

O design system em `design-system/quadroos/MASTER.md` registra a direção visual inicial.

Os controles novos usam shadcn/ui (Radix/Nova), com os fontes em `src/components/ui/`. Para adicionar um componente, use `npx shadcn@latest add <componente>` e preserve as adaptações locais. Os tokens ficam em `src/theme.css`; `src/workflow.css` compõe os controles na tabela. As variantes `data-open` e `data-closed` atendem aos estados Radix sem depender do pacote da CLI em produção.
