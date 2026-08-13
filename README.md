# Conversor BQ DOCX/XML → Moodle

Ferramenta 100% client-side (roda direto no navegador, sem servidor) para converter bancos de
questões para o formato XML de importação do Moodle — e vice-versa.

- `index.html` — aplicação principal: menu lateral com BQ Clássico, Modo IA, XML → DOCX, Editor de
  texto e Histórico de conversões (tudo em uma única página, sem recarregar)
- `converter.js` — parser do formato BQ e gerador do XML Moodle
- `ai-extractor.js` — extração de texto/imagem e integração com provedores de IA (Modo IA)

## Modos disponíveis (barra lateral)

- **BQ Clássico** — envie um `.docx` com marcadores (`#Questão`, `#Resposta`...) e baixe o XML.
- **Modo IA** — envie qualquer arquivo desformatado (PDF, planilha, imagem...) e deixe um provedor
  de IA extrair as questões.
- **XML → DOCX** — caminho inverso: gera um `.docx` formatado a partir de um XML do Moodle.
- **Editor de texto** — escreva o banco de questões direto no formato BQ, sem precisar de um
  `.docx`; tem inserção de marcadores, modelo pronto e rascunho salvo automaticamente.
- **Histórico** — lista as últimas conversões feitas neste navegador, com opção de baixar de novo
  um XML já exportado.

## Como usar

Abra `index.html` no navegador e clique em **Tutorial**, no topo, para o guia completo dentro do
próprio app. O mesmo conteúdo também está em
**[docs/TUTORIAL-DOCX.md](./docs/TUTORIAL-DOCX.md)**, que explica o formato de marcadores exigido
pelo BQ Clássico e traz um arquivo de exemplo pronto para teste em
[`docs/exemplo-modelo-bq.docx`](./docs/exemplo-modelo-bq.docx).
