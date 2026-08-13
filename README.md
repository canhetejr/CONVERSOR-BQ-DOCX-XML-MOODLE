# Conversor BQ DOCX/XML → Moodle

Ferramenta 100% client-side (roda direto no navegador, sem servidor) para converter bancos de
questões em `.docx` para o formato XML de importação do Moodle.

- `index.html` — aplicação principal (upload, conversão, revisão e exportação XML)
- `converter.js` — parser do formato BQ e gerador do XML Moodle
- `ai-extractor.js` — extração de texto/imagem e integração com provedores de IA (Modo IA)
- `editor.html` — editor auxiliar do formato BQ
- `conversor-xml-docx.html` — conversão no sentido inverso (XML → DOCX)

## Como usar

Abra `index.html` no navegador e siga o **[Tutorial de conversão DOCX → XML](./docs/TUTORIAL-DOCX.md)**,
que explica o formato de marcadores exigido pelo Modo BQ Clássico, o Modo IA (para arquivos
desformatados) e traz um arquivo de exemplo pronto para teste em
[`docs/exemplo-modelo-bq.docx`](./docs/exemplo-modelo-bq.docx).
