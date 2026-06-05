# AI Conversor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar "Modo IA" ao conversor BQ existente que aceita qualquer arquivo desformatado (docx, pdf, txt, xlsx/csv), usa API de IA configurável (Claude/OpenAI/Gemini) para extrair questões automaticamente, e alimenta o mesmo modal de revisão/exportação XML existente.

**Architecture:** App permanece 100% client-side (sem servidor). Novo `ai-extractor.js` é responsável por (1) extrair texto bruto de qualquer formato suportado e (2) chamar a API de IA configurada com prompt estruturado retornando JSON de questões. `index.html` ganha toggle de modo (BQ Clássico / Modo IA), painel de configuração (provedor + chave API armazenada em localStorage), e o fluxo de conversão existente é bifurcado por modo.

**Tech Stack:** Vanilla JS ES2020, JSZip (já presente), pdf.js 3.11 (CDN), SheetJS 0.18 (CDN), REST APIs Anthropic/OpenAI/Gemini

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `ai-extractor.js` | Criar | Extração de texto por tipo de arquivo + chamada às APIs de IA + conversão do JSON retornado em BancoDeQuestoes |
| `index.html` | Modificar | Adicionar CDN scripts, CSS, HTML do toggle/painel, JS de modo e integração do fluxo de conversão IA |
| `converter.js` | Não mexer | Parser BQ e gerador XML — sem alterações |

---

## Task 1: Criar `ai-extractor.js` — extração de texto bruto

**Files:**
- Create: `ai-extractor.js`

- [ ] **Step 1: Criar o arquivo com configuração (localStorage) e extração de TXT/CSV/DOCX**

Criar `ai-extractor.js` na raiz do projeto com o seguinte conteúdo:

```javascript
// ai-extractor.js
// Extração de texto de múltiplos formatos + chamada de API de IA

window.AIExtractor = window.AIExtractor || {};

const _CONFIG_KEY = 'ai-converter-config';

// ── Configuração ─────────────────────────────────────────────────────────────

AIExtractor.loadConfig = function () {
  try { return JSON.parse(localStorage.getItem(_CONFIG_KEY) || '{}'); }
  catch (_) { return {}; }
};

AIExtractor.saveConfig = function (config) {
  localStorage.setItem(_CONFIG_KEY, JSON.stringify(config));
};

// ── Extração por formato ──────────────────────────────────────────────────────

/**
 * Extrai texto bruto de qualquer arquivo suportado.
 * @param {File} file
 * @returns {Promise<string>}
 */
AIExtractor.extractText = async function (file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.txt') || name.endsWith('.csv')) return file.text();
  if (name.endsWith('.docx'))  return AIExtractor._extractDocxText(file);
  if (name.endsWith('.pdf'))   return AIExtractor._extractPdfText(file);
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return AIExtractor._extractXlsxText(file);
  throw new Error(`Formato não suportado: .${name.split('.').pop()}`);
};

AIExtractor._extractDocxText = async function (file) {
  if (!window.BQConverter) throw new Error('converter.js não carregado');
  const buf = await file.arrayBuffer();
  const paragraphs = await BQConverter.readDocxRich(buf);
  return paragraphs
    .map(p => String(p || '').replace(/<[^>]+>/g, '').trim())
    .filter(Boolean)
    .join('\n');
};
```

- [ ] **Step 2: Adicionar extração de PDF (pdf.js)**

Acrescentar ao final de `ai-extractor.js`:

```javascript
AIExtractor._extractPdfText = async function (file) {
  if (!window.pdfjsLib) throw new Error('pdf.js não carregado. Verifique o CDN no index.html.');
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map(item => item.str).join(' '));
  }
  return pages.join('\n\n');
};
```

- [ ] **Step 3: Adicionar extração de XLSX/XLS (SheetJS)**

Acrescentar ao final de `ai-extractor.js`:

```javascript
AIExtractor._extractXlsxText = async function (file) {
  if (!window.XLSX) throw new Error('SheetJS não carregado. Verifique o CDN no index.html.');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const parts = [];
  wb.SheetNames.forEach(name => {
    parts.push(`--- Planilha: ${name} ---`);
    parts.push(XLSX.utils.sheet_to_csv(wb.Sheets[name]));
  });
  return parts.join('\n');
};
```

- [ ] **Step 4: Verificar sintaxe no browser**

Adicionar temporariamente `<script src="ai-extractor.js"></script>` ao `index.html` antes de `</body>`, abrir no browser (sem servidor é possível via `file://` ou `Live Server` do VS Code) e verificar no DevTools → Console:

```javascript
console.log(typeof AIExtractor.extractText);      // deve imprimir "function"
console.log(typeof AIExtractor._extractDocxText); // deve imprimir "function"
console.log(typeof AIExtractor.loadConfig);       // deve imprimir "function"
```

Sem erros de sintaxe no console.

---

## Task 2: `ai-extractor.js` — prompt + provedores de IA + extração principal

**Files:**
- Modify: `ai-extractor.js`

- [ ] **Step 1: Adicionar função `_buildPrompt`**

Acrescentar ao final de `ai-extractor.js`:

```javascript
// ── Prompt e provedores ───────────────────────────────────────────────────────

AIExtractor._buildPrompt = function (text) {
  const MAX_CHARS = 80000; // ~20k tokens; trunca arquivos muito grandes
  const body = text.length > MAX_CHARS
    ? text.slice(0, MAX_CHARS) + '\n\n[TEXTO TRUNCADO — arquivo muito grande]'
    : text;

  return `Você é um assistente especializado em extrair questões de provas e concursos.

Analise o texto abaixo e extraia TODAS as questões encontradas.
Para cada questão, identifique:
- O enunciado completo (pergunta ou problema)
- A resposta correta
- As alternativas erradas (até 4; se houver menos, inclua as que existirem)
- A justificativa ou gabarito explicativo (string vazia se não houver)

Se o arquivo contiver gabarito separado das questões (ex: "1-A, 2-C, 3-B"), associe as respostas corretas às questões correspondentes.

Retorne APENAS um array JSON válido no formato abaixo, sem texto adicional antes ou depois:
[
  {
    "question": "enunciado completo da questão",
    "correct_answer": "texto da resposta correta",
    "wrong_answer_list": ["alternativa errada 1", "alternativa errada 2"],
    "justification": ""
  }
]

TEXTO:
${body}`;
};
```

- [ ] **Step 2: Adicionar os três provedores**

Acrescentar ao final de `ai-extractor.js`:

```javascript
AIExtractor._callClaude = async function (prompt, config) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-allow-browser': 'true'
    },
    body: JSON.stringify({
      model: config.model || 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`Claude API ${resp.status}: ${err.error?.message || resp.statusText}`);
  }
  return (await resp.json()).content[0].text;
};

AIExtractor._callOpenAI = async function (prompt, config) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model || 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`OpenAI API ${resp.status}: ${err.error?.message || resp.statusText}`);
  }
  return (await resp.json()).choices[0].message.content;
};

AIExtractor._callGemini = async function (prompt, config) {
  const model = config.model || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`Gemini API ${resp.status}: ${err.error?.message || resp.statusText}`);
  }
  return (await resp.json()).candidates[0].content.parts[0].text;
};
```

- [ ] **Step 3: Adicionar `extractQuestions` e `toBancoDeQuestoes`**

Acrescentar ao final de `ai-extractor.js`:

```javascript
/**
 * Chama a API de IA e retorna array de questões extraídas.
 * @param {string} text - Texto bruto do arquivo
 * @param {object} config - { provider, apiKey, model }
 * @returns {Promise<Array>}
 */
AIExtractor.extractQuestions = async function (text, config) {
  if (!config.apiKey)  throw new Error('Chave de API não configurada. Clique em ⚙ Configurações de IA.');
  if (!config.provider) throw new Error('Provedor de IA não selecionado.');

  const prompt = AIExtractor._buildPrompt(text);
  let raw;
  switch (config.provider) {
    case 'claude': raw = await AIExtractor._callClaude(prompt, config); break;
    case 'openai': raw = await AIExtractor._callOpenAI(prompt, config); break;
    case 'gemini': raw = await AIExtractor._callGemini(prompt, config); break;
    default: throw new Error(`Provedor desconhecido: ${config.provider}`);
  }

  // Extrai o array JSON da resposta (suporta markdown code fences e texto extra)
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('A IA não retornou um JSON válido. Tente novamente.');
  let questions;
  try { questions = JSON.parse(match[0]); }
  catch (e) { throw new Error('Falha ao parsear resposta da IA: ' + e.message); }
  if (!Array.isArray(questions)) throw new Error('Resposta da IA não é um array de questões.');
  return questions;
};

/**
 * Converte o array de questões retornado pela IA em BancoDeQuestoes para o modal.
 * @param {Array} questions
 * @returns {BancoDeQuestoes}
 */
AIExtractor.toBancoDeQuestoes = function (questions) {
  if (!window.BQConverter) throw new Error('converter.js não carregado');
  const banco = new BQConverter.BancoDeQuestoes('');
  questions.forEach(q => {
    const wrongs = (Array.isArray(q.wrong_answer_list) ? q.wrong_answer_list : [])
      .map(a => String(a || '').trim()).filter(Boolean);
    while (wrongs.length < 4) wrongs.push('');
    banco.question_list.push({
      question:          String(q.question       || '').trim(),
      correct_answer:    String(q.correct_answer || '').trim(),
      wrong_answer_list: wrongs,
      justification:     String(q.justification  || '').trim()
    });
  });
  return banco;
};
```

- [ ] **Step 4: Verificar no browser**

No DevTools → Console:

```javascript
// Verificar que todas as funções existem
['extractText','extractQuestions','toBancoDeQuestoes','_buildPrompt',
 '_callClaude','_callOpenAI','_callGemini','loadConfig','saveConfig']
  .forEach(fn => console.log(fn, typeof AIExtractor[fn]));
// Todos devem imprimir "function"

// Verificar prompt
const p = AIExtractor._buildPrompt('Q1: Qual é 2+2?\nA) 3\nB) 4*\nC) 5');
console.log(p.includes('array JSON válido')); // true
console.log(p.includes('Q1: Qual é 2+2?'));   // true
```

---

## Task 3: `index.html` — CDN scripts + CSS + HTML do toggle e painel de config

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Adicionar CDN scripts (pdf.js, SheetJS, ai-extractor.js)**

Localizar no `index.html`:
```html
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
  <script src="converter.js"></script>
```

Substituir por:
```html
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
  <script src="converter.js"></script>
  <script src="ai-extractor.js"></script>
```

- [ ] **Step 2: Adicionar CSS do toggle de modo e painel de configurações**

Localizar no `<style>` o último bloco antes de `</style>`:
```css
    .file-list li {
      font-size: 0.8rem;
      color: var(--accent);
      padding: 0.1rem 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
```

Adicionar imediatamente após (antes de `</style>`):

```css
    /* Toggle Modo BQ / Modo IA */
    .mode-toggle {
      display: flex;
      border: 1px solid var(--muted);
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 1rem;
    }
    .mode-btn {
      flex: 1;
      padding: 0.45rem;
      font-size: 0.85rem;
      font-weight: 500;
      border: none;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .mode-btn.active { background: var(--accent); color: var(--btn-text); }
    .mode-btn:hover:not(.active) { background: var(--drop-hover-bg); color: var(--text); }

    /* Painel de configurações de IA */
    .ai-settings-toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      padding: 0.5rem 0;
      font-size: 0.9rem;
      color: var(--muted);
      user-select: none;
      margin-top: 1rem;
      border-top: 1px solid var(--muted);
    }
    .ai-settings-toggle:hover { color: var(--accent); }
    .ai-settings-panel {
      display: none;
      flex-direction: column;
      gap: 0.5rem;
      padding: 0.75rem 0 0;
    }
    .ai-settings-panel.open { display: flex; }
    .ai-settings-row {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .ai-settings-row select,
    .ai-settings-row input[type="text"],
    .ai-settings-row input[type="password"] {
      flex: 1;
      min-width: 0;
      padding: 0.45rem 0.6rem;
      font-size: 0.85rem;
      background: var(--bg);
      color: var(--text);
      border: 1px solid var(--muted);
      border-radius: 6px;
    }
    .ai-settings-row select:focus,
    .ai-settings-row input:focus { outline: none; border-color: var(--accent); }
    .ai-settings-save {
      padding: 0.4rem 0.8rem;
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--btn-text);
      background: var(--accent);
      border: none;
      border-radius: 6px;
      cursor: pointer;
      white-space: nowrap;
    }
    .ai-settings-save:hover { background: var(--accent-hover); }
    .ai-saved-badge {
      font-size: 0.78rem;
      color: var(--success);
      display: none;
      align-self: center;
    }
```

- [ ] **Step 3: Substituir o cabeçalho do `<main>` com toggle de modo e painel de config**

Localizar no `<main>`:
```html
    <h1>Conversor BQ DOCX → XML</h1>
    <p class="sub">Envie um .docx no formato BQ e baixe o XML para importar no Moodle.</p>
```

Substituir por:
```html
    <h1>Conversor BQ → XML (Moodle)</h1>

    <div class="mode-toggle">
      <button type="button" class="mode-btn active" id="modeBqBtn">BQ Clássico</button>
      <button type="button" class="mode-btn" id="modeAiBtn">✨ Modo IA</button>
    </div>

    <p class="sub" id="modeDescription">Envie um .docx no formato BQ e baixe o XML para importar no Moodle.</p>

    <div id="aiSettingsContainer" style="display:none">
      <div class="ai-settings-toggle" id="aiSettingsToggle">
        <span>⚙ Configurações de IA</span>
        <span id="aiSettingsArrow">▼</span>
      </div>
      <div class="ai-settings-panel" id="aiSettingsPanel">
        <div class="ai-settings-row">
          <select id="aiProviderSelect">
            <option value="">Provedor…</option>
            <option value="claude">Claude (Anthropic)</option>
            <option value="openai">OpenAI</option>
            <option value="gemini">Gemini (Google)</option>
          </select>
          <input type="text" id="aiModelInput" placeholder="Modelo (opcional)"
            title="Ex: claude-haiku-4-5-20251001 | gpt-4o-mini | gemini-1.5-flash">
        </div>
        <div class="ai-settings-row">
          <input type="password" id="aiKeyInput" placeholder="API Key">
          <button type="button" class="ai-settings-save" id="aiSaveBtn">Salvar</button>
          <span class="ai-saved-badge" id="aiSavedBadge">✓ Salvo</span>
        </div>
      </div>
    </div>
```

- [ ] **Step 4: Verificar HTML no browser**

Abrir `index.html`. Verificar visualmente:
1. Título mudou para "Conversor BQ → XML (Moodle)"
2. Toggle "BQ Clássico | ✨ Modo IA" aparece abaixo do título
3. "BQ Clássico" está com fundo verde (active)
4. Sem erros no DevTools → Console

---

## Task 4: `index.html` — JS: lógica do toggle de modo e painel de configurações

**Files:**
- Modify: `index.html` (bloco `<script>`)

- [ ] **Step 1: Adicionar declarações de variáveis do modo IA**

Localizar no `<script>` a linha:
```javascript
    let currentBanco = null;
```

Adicionar imediatamente após `let currentFiles = [];`:

```javascript
    // Modo de operação: 'bq' (parser clássico) | 'ai' (extração por IA)
    let currentMode = 'bq';

    const modeBqBtn           = document.getElementById('modeBqBtn');
    const modeAiBtn           = document.getElementById('modeAiBtn');
    const modeDescription     = document.getElementById('modeDescription');
    const aiSettingsContainer = document.getElementById('aiSettingsContainer');
    const aiSettingsToggle    = document.getElementById('aiSettingsToggle');
    const aiSettingsPanel     = document.getElementById('aiSettingsPanel');
    const aiSettingsArrow     = document.getElementById('aiSettingsArrow');
    const aiProviderSelect    = document.getElementById('aiProviderSelect');
    const aiModelInput        = document.getElementById('aiModelInput');
    const aiKeyInput          = document.getElementById('aiKeyInput');
    const aiSaveBtn           = document.getElementById('aiSaveBtn');
    const aiSavedBadge        = document.getElementById('aiSavedBadge');
```

- [ ] **Step 2: Adicionar funções `switchMode` e lógica de configurações**

Adicionar no `<script>` após as funções `showSpinner` / `hideSpinner` (antes de `function setFiles`):

```javascript
    // ── Modo BQ / IA ──────────────────────────────────────────────────────────
    const AI_ACCEPT = '.docx,.pdf,.txt,.csv,.xlsx,.xls';
    const BQ_ACCEPT = '.docx';

    function switchMode(mode) {
      currentMode = mode;
      modeBqBtn.classList.toggle('active', mode === 'bq');
      modeAiBtn.classList.toggle('active', mode === 'ai');
      aiSettingsContainer.style.display = mode === 'ai' ? '' : 'none';
      fileInput.accept = mode === 'ai' ? AI_ACCEPT : BQ_ACCEPT;
      modeDescription.textContent = mode === 'ai'
        ? 'Envie qualquer arquivo desformatado — a IA vai reconhecer e extrair as questões automaticamente.'
        : 'Envie um .docx no formato BQ e baixe o XML para importar no Moodle.';
      currentFiles = [];
      fileListEl.innerHTML = '';
      btnConvert.disabled = true;
      btnConvert.textContent = 'Converter para XML';
      hideMsg();
    }

    modeBqBtn.addEventListener('click', () => switchMode('bq'));
    modeAiBtn.addEventListener('click', () => switchMode('ai'));

    // ── Painel de config ──────────────────────────────────────────────────────
    aiSettingsToggle.addEventListener('click', () => {
      const open = aiSettingsPanel.classList.toggle('open');
      aiSettingsArrow.textContent = open ? '▲' : '▼';
    });

    function loadAiConfig() {
      if (!window.AIExtractor) return;
      const cfg = AIExtractor.loadConfig();
      if (cfg.provider) aiProviderSelect.value = cfg.provider;
      if (cfg.model)    aiModelInput.value     = cfg.model;
      if (cfg.apiKey)   aiKeyInput.value       = cfg.apiKey;
    }

    aiSaveBtn.addEventListener('click', () => {
      if (!window.AIExtractor) return;
      AIExtractor.saveConfig({
        provider: aiProviderSelect.value,
        model:    aiModelInput.value.trim(),
        apiKey:   aiKeyInput.value.trim()
      });
      aiSavedBadge.style.display = 'inline';
      setTimeout(() => { aiSavedBadge.style.display = 'none'; }, 2000);
    });

    loadAiConfig();
```

- [ ] **Step 3: Verificar modo no browser**

Abrir `index.html`. Testar:
1. Clicar "✨ Modo IA" → botão fica verde, container de configurações aparece, texto descritivo muda
2. Clicar "⚙ Configurações de IA" → expande, mostra campos de provedor/modelo/key
3. Selecionar Claude, digitar uma key qualquer, clicar "Salvar" → badge "✓ Salvo" aparece 2s e some
4. Recarregar página → clicar "Modo IA" + abrir config → campos ainda preenchidos
5. Clicar "BQ Clássico" → volta ao estado original, painel de config some

---

## Task 5: `index.html` — Integração do fluxo de conversão com IA

**Files:**
- Modify: `index.html` (bloco `<script>`)

- [ ] **Step 1: Atualizar `setFiles` para aceitar todos os tipos no Modo IA**

Localizar no `<script>`:
```javascript
    function setFiles(fileList) {
      const files = Array.from(fileList).filter(f => f.name.toLowerCase().endsWith('.docx'));
      if (files.length === 0) {
        showMsg('Selecione arquivos .docx', 'error');
        return;
      }
```

Substituir por:
```javascript
    function setFiles(fileList) {
      const AI_EXTS = ['.docx', '.pdf', '.txt', '.csv', '.xlsx', '.xls'];
      const files = Array.from(fileList).filter(f => {
        const name = f.name.toLowerCase();
        return currentMode === 'ai'
          ? AI_EXTS.some(ext => name.endsWith(ext))
          : name.endsWith('.docx');
      });
      if (files.length === 0) {
        showMsg(currentMode === 'ai'
          ? 'Selecione arquivos .docx, .pdf, .txt, .csv, .xlsx ou .xls'
          : 'Selecione arquivos .docx', 'error');
        return;
      }
```

- [ ] **Step 2: Atualizar o texto do botão converter**

Ainda na função `setFiles`, localizar:
```javascript
      btnConvert.textContent = files.length === 1
        ? 'Converter para XML'
        : `Converter ${files.length} arquivos para XML`;
```

Substituir por:
```javascript
      const action = currentMode === 'ai' ? 'Analisar com IA' : 'Converter';
      btnConvert.textContent = files.length === 1
        ? `${action} para XML`
        : `${action} ${files.length} arquivos para XML`;
```

- [ ] **Step 3: Substituir o handler completo do `btnConvert`**

Localizar o bloco inteiro:
```javascript
    btnConvert.addEventListener('click', async () => {
      if (!currentFiles.length) return;
      if (!window.BQConverter || typeof window.BQConverter.convertDocxToBancoRich !== 'function') {
        showMsg('Erro: converter.js não carregou. Verifique se está na mesma pasta do index.html.', 'error');
        return;
      }
      btnConvert.disabled = true;
      hideMsg();
      const label = currentFiles.length === 1
        ? 'Convertendo ' + currentFiles[0].name + '…'
        : 'Convertendo ' + currentFiles.length + ' arquivos…';
      showSpinner(label);
      try {
        let merged = null;
        for (let i = 0; i < currentFiles.length; i++) {
          const f = currentFiles[i];
          if (currentFiles.length > 1) spinnerLabel.textContent = `Convertendo ${i + 1} / ${currentFiles.length}: ${f.name}…`;
          const banco = await BQConverter.convertDocxToBancoRich(f);
          if (!merged) {
            merged = banco;
          } else {
            merged.question_list.push(...banco.question_list);
          }
        }
        currentBanco = merged;
        currentBaseFileName = currentFiles[0].name.replace(/\.docx$/i, '');
        renderModalQuestions(merged);
        openModal();
      } catch (err) {
        console.error(err);
        showMsg('Erro ao converter: ' + (err.message || String(err)), 'error');
      } finally {
        hideSpinner();
        btnConvert.disabled = false;
      }
    });
```

Substituir por:
```javascript
    btnConvert.addEventListener('click', async () => {
      if (!currentFiles.length) return;
      btnConvert.disabled = true;
      hideMsg();

      if (currentMode === 'ai') {
        // ── Modo IA ────────────────────────────────────────────────────────────
        if (!window.AIExtractor) {
          showMsg('Erro: ai-extractor.js não carregou.', 'error');
          btnConvert.disabled = false;
          return;
        }
        const config = AIExtractor.loadConfig();
        if (!config.apiKey || !config.provider) {
          showMsg('Configure a chave de API e o provedor em ⚙ Configurações de IA.', 'error');
          if (!aiSettingsPanel.classList.contains('open')) {
            aiSettingsPanel.classList.add('open');
            aiSettingsArrow.textContent = '▲';
          }
          btnConvert.disabled = false;
          return;
        }
        showSpinner('Preparando…');
        try {
          let allQuestions = [];
          for (let i = 0; i < currentFiles.length; i++) {
            const f = currentFiles[i];
            spinnerLabel.textContent = `Extraindo texto (${i + 1}/${currentFiles.length}): ${f.name}…`;
            const text = await AIExtractor.extractText(f);
            spinnerLabel.textContent = `Analisando com IA (${i + 1}/${currentFiles.length}): ${f.name}…`;
            const questions = await AIExtractor.extractQuestions(text, config);
            allQuestions = allQuestions.concat(questions);
          }
          const banco = AIExtractor.toBancoDeQuestoes(allQuestions);
          currentBanco = banco;
          currentBaseFileName = currentFiles[0].name.replace(/\.[^.]+$/, '');
          renderModalQuestions(banco);
          openModal();
        } catch (err) {
          console.error(err);
          showMsg('Erro: ' + (err.message || String(err)), 'error');
        } finally {
          hideSpinner();
          btnConvert.disabled = false;
        }

      } else {
        // ── Modo BQ Clássico ───────────────────────────────────────────────────
        if (!window.BQConverter || typeof window.BQConverter.convertDocxToBancoRich !== 'function') {
          showMsg('Erro: converter.js não carregou. Verifique se está na mesma pasta do index.html.', 'error');
          btnConvert.disabled = false;
          return;
        }
        const label = currentFiles.length === 1
          ? 'Convertendo ' + currentFiles[0].name + '…'
          : 'Convertendo ' + currentFiles.length + ' arquivos…';
        showSpinner(label);
        try {
          let merged = null;
          for (let i = 0; i < currentFiles.length; i++) {
            const f = currentFiles[i];
            if (currentFiles.length > 1) spinnerLabel.textContent = `Convertendo ${i + 1} / ${currentFiles.length}: ${f.name}…`;
            const banco = await BQConverter.convertDocxToBancoRich(f);
            if (!merged) {
              merged = banco;
            } else {
              merged.question_list.push(...banco.question_list);
            }
          }
          currentBanco = merged;
          currentBaseFileName = currentFiles[0].name.replace(/\.docx$/i, '');
          renderModalQuestions(merged);
          openModal();
        } catch (err) {
          console.error(err);
          showMsg('Erro ao converter: ' + (err.message || String(err)), 'error');
        } finally {
          hideSpinner();
          btnConvert.disabled = false;
        }
      }
    });
```

- [ ] **Step 4: Teste — fluxo BQ Clássico (regressão)**

1. Abrir `index.html` no browser
2. Confirmar modo "BQ Clássico" ativo (padrão)
3. Arrastar `TesteBQ.docx` para a drop zone
4. Botão deve mostrar "Converter para XML"
5. Clicar "Converter para XML" → spinner "Convertendo TesteBQ.docx…"
6. Modal abre com questões extraídas → clicar "Exportar XML"
7. Arquivo `.xml` é baixado. Abrir em editor de texto e verificar que contém `<quiz>` e `<question type="multichoice">`

- [ ] **Step 5: Teste — fluxo Modo IA (sem API key)**

1. Clicar "✨ Modo IA"
2. Arrastar qualquer arquivo suportado
3. Clicar "Analisar com IA para XML" sem configurar API key
4. Esperado: mensagem de erro "Configure a chave de API…" e painel de config abre automaticamente

- [ ] **Step 6: Teste — fluxo Modo IA (com API key real)**

1. No painel de config, preencher provedor + API key real + Salvar
2. Arrastar um arquivo `.txt` com questões desformatadas (ex: conteúdo abaixo):

```
Questão 1
Qual é a capital do Brasil?
a) São Paulo
b) Rio de Janeiro
c) Brasília
d) Belo Horizonte
e) Manaus
Resposta: c

Questão 2
2 + 2 é igual a?
a) 3
b) 4
c) 5
d) 6
Resposta: b
```

3. Clicar "Analisar com IA para XML"
4. Spinner mostra "Extraindo texto… / Analisando com IA…"
5. Modal abre com 2 questões: "Qual é a capital do Brasil?" e "2 + 2 é igual a?"
6. Resposta correta da Q1 deve ser "Brasília", da Q2 deve ser "4"
7. Exportar XML → verificar que o arquivo é importável no Moodle

- [ ] **Step 7: Commit**

```bash
git add ai-extractor.js index.html docs/superpowers/plans/2026-06-05-ai-conversor.md
git commit -m "feat: adiciona Modo IA ao conversor BQ — suporte a docx/pdf/txt/xlsx com Claude/OpenAI/Gemini"
```

---

## Resumo das dependências entre tasks

```
Task 1 (ai-extractor.js — extração de texto)
  ↓
Task 2 (ai-extractor.js — IA + parsing)
  ↓
Task 3 (index.html — CDN + CSS + HTML)    ← pode ser feito em paralelo com Task 1/2
  ↓
Task 4 (index.html — JS modo e config)
  ↓
Task 5 (index.html — integração do fluxo de conversão)
```

Tasks 1 e 2 produzem `ai-extractor.js`. Tasks 3, 4 e 5 modificam `index.html`. Cada task é independente dentro do seu arquivo após a anterior estar completa.
