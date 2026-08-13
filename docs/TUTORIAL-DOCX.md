# Tutorial: convertendo um .docx em XML para o Moodle

Este tutorial explica como preparar um arquivo `.docx` para o **Conversor BQ → XML (Moodle)**
(`index.html`) e como usar os dois modos disponíveis na ferramenta: **BQ Clássico** e **✨ Modo IA**.

Um arquivo de exemplo já pronto está em [`docs/exemplo-modelo-bq.docx`](./exemplo-modelo-bq.docx) —
abra-o para ver o formato na prática, ou use-o diretamente na ferramenta para testar a conversão.

---

## 1. Modo BQ Clássico (formato com marcadores)

Esse é o modo original da ferramenta: **100% determinístico**, não depende de nenhuma API de IA
e não sai do navegador (tudo roda em client-side). Ele espera um `.docx` estruturado com
marcadores de texto específicos, cada um em seu **próprio parágrafo**.

### Marcadores reconhecidos

| Marcador          | Função                                                              |
|--------------------|----------------------------------------------------------------------|
| `#Questão`         | Inicia uma nova questão                                              |
| `#Resposta`        | Separa o enunciado da resposta correta, e depois separa cada alternativa errada |
| `#Justificativa`   | Inicia o texto de feedback/justificativa da questão (opcional)      |
| `#Final`           | Fecha a última questão do arquivo                                    |

Os marcadores não diferenciam maiúsculas/minúsculas nem precisam ser texto puro — podem estar em
**negrito, itálico** etc. — mas o parágrafo deve conter **só o marcador** (nada de texto extra na
mesma linha, tirando o caso de marcador ao final do parágrafo, que a ferramenta também sabe
separar automaticamente).

### Estrutura de uma questão

```
#Questão
<enunciado da questão — pode ocupar várias linhas/parágrafos>
#Resposta
<resposta correta>
#Resposta
<alternativa errada 1>
#Resposta
<alternativa errada 2>
#Resposta
<alternativa errada 3>
#Resposta
<alternativa errada 4>
#Justificativa
<texto de feedback exibido ao aluno — pode ficar vazio>
```

Repita esse bloco para cada questão e feche o arquivo com `#Final` depois da última questão.

### Regras importantes

1. **A primeira resposta depois do enunciado é sempre a correta.** As demais, até o próximo
   marcador, são alternativas erradas.
2. **Alternativas erradas são opcionais** — você pode ter 1 a 4. A ferramenta completa
   automaticamente com alternativas vazias até chegar a 4 (5 opções no total, contando a correta).
3. **`#Justificativa` é obrigatório ao final de cada questão** (mesmo que o texto fique vazio).
   Sem ele, a última alternativa errada da questão pode não ser capturada corretamente — o parser
   só grava a alternativa em andamento quando encontra o próximo `#Resposta`, `#Justificativa` ou
   o fim do arquivo tratado; deixar o marcador presente evita ambiguidade.
4. **Texto antes do primeiro `#Questão`** (cabeçalho) é permitido, mas é apenas ignorado pela
   conversão — use-o só como anotação para quem for editar o arquivo. A categoria do Moodle é
   definida depois, direto na interface da ferramenta (campo "Categoria Moodle").
5. **Formatação rica é preservada**: negrito, itálico, sublinhado, listas (`<ul>`/`<ol>`),
   tabelas, imagens (inseridas como `<img>` embutido em base64) e fórmulas do Word (convertidas
   para LaTeX `\( ... \)`, renderizado pelo MathJax no Moodle) são todos suportados dentro do
   enunciado, das alternativas e da justificativa.
6. Você pode **arrastar vários arquivos `.docx`** de uma vez — a ferramenta concatena as questões
   de todos em um único banco antes de abrir o modal de revisão.

### Passo a passo

1. Abra `index.html` no navegador (não precisa de servidor).
2. Confirme que o modo **"BQ Clássico"** está ativo (é o padrão).
3. Arraste seu(s) `.docx` para a área de upload, ou clique para selecionar.
4. Clique em **"Converter para XML"**.
5. Revise as questões no modal (você pode editar, aprovar/rejeitar cada uma antes de exportar).
6. Preencha a **Categoria Moodle** (opcional) e clique em **Exportar XML**.
7. Importe o `.xml` gerado no Moodle: *Banco de questões → Importar → formato Moodle XML*.

---

## 2. ✨ Modo IA (arquivos desformatados)

Quando você não tem o `.docx` no formato com marcadores acima — por exemplo, uma prova em PDF,
uma planilha, um texto solto ou até uma foto de uma prova impressa — use o **Modo IA**. Ele envia
o conteúdo extraído do arquivo para um provedor de IA configurável, que identifica e estrutura as
questões automaticamente no mesmo formato usado pelo modal de revisão.

### Formatos aceitos no Modo IA

- `.docx`, `.pdf`, `.txt`, `.csv`, `.xlsx`, `.xls`
- Imagens: `.jpg`/`.jpeg`, `.png`, `.gif`, `.webp`, `.bmp` (enviadas diretamente para modelos com
  suporte a visão)

### Provedores de IA suportados

Configuráveis em **⚙ Configurações de IA**, com a chave de API salva localmente no navegador
(`localStorage` — nunca é enviada a nenhum servidor da própria ferramenta):

- **Claude (Anthropic)** — modelo padrão `claude-haiku-4-5-20251001`
- **OpenAI** — modelo padrão `gpt-4o-mini`
- **OpenRouter** — modelo padrão `openai/gpt-4o-mini` (permite usar outros modelos compatíveis)
- **Gemini (Google)** — modelo padrão `gemini-1.5-flash`

O campo "Modelo" é opcional — se vazio, usa o padrão de cada provedor.

### Passo a passo

1. Clique em **"✨ Modo IA"**.
2. Abra **⚙ Configurações de IA**, escolha o provedor, informe sua **API Key** e clique em
   **Salvar**.
3. Arraste o(s) arquivo(s) desformatado(s) para a área de upload.
4. Clique em **"Analisar com IA"**. A ferramenta extrai o texto (ou imagem) do arquivo e chama a
   API do provedor escolhido pedindo a extração estruturada das questões.
5. Revise o resultado no mesmo modal do modo clássico — a IA pode cometer erros de interpretação,
   então confira enunciado, resposta correta e alternativas antes de exportar.
6. Exporte o XML normalmente e importe no Moodle.

> **Atenção:** o Modo IA faz chamadas diretas do navegador para a API do provedor escolhido
> (chamada client-side). Isso significa que sua chave de API fica no seu navegador/localStorage —
> não a compartilhe nem a use em computadores públicos.

---

## 3. Arquivo de exemplo

O arquivo [`docs/exemplo-modelo-bq.docx`](./exemplo-modelo-bq.docx) contém três questões de
exemplo já no formato exigido pelo Modo BQ Clássico, incluindo:

- Uma questão simples de texto puro.
- Uma questão com **texto em negrito** dentro do enunciado.
- Uma questão com apenas 2 alternativas erradas (mostrando que não é preciso preencher as 4) e
  justificativa vazia.

Use-o para testar a ferramenta rapidamente: arraste-o em `index.html` no modo "BQ Clássico" e
clique em "Converter para XML" — o modal deve abrir com as 3 questões prontas para revisão.
