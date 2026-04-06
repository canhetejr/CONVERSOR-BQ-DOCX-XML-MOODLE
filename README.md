# Conversor BQ DOCX → XML (Moodle)

> Converta bancos de questões no padrão BQ para XML compatível com Moodle, com revisão visual e edição antes da exportação.

Aplicação web estática, rápida e sem backend: você envia um `.docx` no formato BQ, revisa as questões em um modal interativo e baixa o XML pronto para importação no Moodle.

---

## ✨ Destaques

- Conversão **100% no navegador** (sem servidor).
- Upload por clique ou **drag-and-drop** de `.docx`.
- Revisão pré-exportação com:
  - seleção de questões;
  - edição de enunciado, resposta correta, erradas e justificativa.
- Exportação XML em padrão de questão **multichoice** do Moodle.
- Tema claro/escuro com persistência local.
- Editor BQ avançado para fluxo por texto (`editor.html`).

---

## 🧱 Arquitetura do projeto

```text
.
├── index.html          # UI principal (DOCX -> revisão -> XML)
├── editor.html         # UI de edição manual em texto BQ
├── converter.js        # parser BQ + gerador XML Moodle
└── .github/workflows/
    └── static.yml      # deploy automático para GitHub Pages
```

### Stack

- HTML + CSS + JavaScript (vanilla)
- [JSZip](https://stuk.github.io/jszip/) para leitura de `.docx`
- APIs nativas do navegador (`DOMParser`, `Blob`, `localStorage`)

---

## 🚀 Como usar

### Opção 1: Conversão via DOCX (interface principal)

1. Abra o `index.html`.
2. Arraste ou selecione um arquivo `.docx` no padrão BQ.
3. Clique em **Converter para XML**.
4. Revise e, se necessário, edite as questões no modal.
5. Selecione as questões desejadas.
6. Clique em **Exportar XML**.

### Opção 2: Conversão via texto BQ (editor)

1. Abra o `editor.html`.
2. Digite/cole o conteúdo BQ (ou carregue um `.txt`).
3. Clique em **Converter para XML**.
4. Revise, filtre e exporte.

---

## 🧾 Formato BQ esperado

Marcadores aceitos no parser:

- `#Questão` inicia uma questão
- `#Resposta` delimita respostas (a primeira é a correta)
- `#Justificativa` inicia justificativa (também aceita `Justificativa`, com/sem `:`)
- `#Final` pode ser usado como fechamento de bloco

### Exemplo mínimo

```txt
Banco Exemplo

#Questão
Qual a capital do Brasil?

#Resposta
Brasília
#Resposta
Rio de Janeiro
#Resposta
São Paulo
#Resposta
Belo Horizonte
#Resposta
Salvador
#Justificativa
Brasília é a capital federal desde 1960.

#Final
```

---

## ⚙️ Como funciona por baixo

1. O `.docx` é aberto como ZIP.
2. O arquivo interno `word/document.xml` é lido.
3. Cada parágrafo do Word vira uma linha lógica.
4. O parser transforma blocos BQ em objetos de questão.
5. O gerador monta o XML `<quiz>` compatível com importação Moodle.

---

## 🔍 Compatibilidade e limitações

- Focado em questões de **múltipla escolha**.
- O parser depende dos marcadores BQ para estruturar corretamente.
- Não há validação pedagógica do conteúdo (somente estrutural).
- Questões fora do padrão podem exigir ajuste manual na revisão.

---

## 🛠️ Desenvolvimento local

Como é uma aplicação estática, você pode abrir os arquivos diretamente no navegador.

Se preferir rodar com servidor local:

```bash
# Python
python -m http.server 8080
```

Depois acesse `http://localhost:8080`.

---

## 🌐 Deploy

O projeto já possui workflow em `.github/workflows/static.yml` para publicação no **GitHub Pages** em pushes para `main`.

Resumo:
- branch de deploy: `main`;
- artefato: repositório inteiro;
- publicação automática via GitHub Actions.

---

## 🗺️ Roadmap sugerido

- Validação de formato BQ com relatório por linha.
- Testes automatizados para parser e XML.
- Extração de scripts inline dos HTMLs para módulos JS.
- Redução de duplicação de lógica entre `index.html` e `editor.html`.
- Template oficial BQ versionado em arquivo dedicado.

---

## 🤝 Contribuição

Contribuições são bem-vindas.

Fluxo recomendado:
1. abra uma issue com contexto e proposta;
2. crie uma branch de feature/fix;
3. envie PR com descrição clara e evidências de teste.

---

## 📄 Licença

Defina aqui a licença do projeto (ex.: MIT) para facilitar uso e contribuição externa.

---

## 💚 Créditos

Feito com carinho pela equipe de Qualidade Acadêmica UniCV.

