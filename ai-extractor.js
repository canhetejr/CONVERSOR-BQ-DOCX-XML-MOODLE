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

// ── Suporte a imagens ─────────────────────────────────────────────────────────

AIExtractor._isImageFile = function (file) {
  return /\.(jpe?g|png|gif|webp|bmp)$/i.test(file.name);
};

AIExtractor._toBase64 = function (buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

AIExtractor._imagePrompt =
`Você é um assistente especializado em extrair questões de provas e concursos a partir de imagens.

Analise a imagem e extraia TODAS as questões encontradas.
Para cada questão, identifique:
- O enunciado completo (pergunta ou problema)
- A resposta correta
- As alternativas erradas (até 4; se houver menos, inclua as que existirem)
- A justificativa ou gabarito explicativo (string vazia se não houver)

Se a imagem contiver gabarito separado das questões, associe as respostas corretas às questões correspondentes.

Retorne APENAS um array JSON válido no formato abaixo, sem texto adicional antes ou depois:
[
  {
    "question": "enunciado completo da questão",
    "correct_answer": "texto da resposta correta",
    "wrong_answer_list": ["alternativa errada 1", "alternativa errada 2"],
    "justification": ""
  }
]`;

AIExtractor._callClaudeVision = async function (file, config) {
  const base64 = AIExtractor._toBase64(await file.arrayBuffer());
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
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: file.type || 'image/jpeg', data: base64 } },
          { type: 'text', text: AIExtractor._imagePrompt }
        ]
      }]
    })
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`Claude API ${resp.status}: ${err.error?.message || resp.statusText}`);
  }
  const data = await resp.json();
  if (!data.content?.[0]?.text) throw new Error('Claude API retornou resposta inesperada.');
  return data.content[0].text;
};

AIExtractor._callOpenAIVision = async function (file, config, url) {
  const base64 = AIExtractor._toBase64(await file.arrayBuffer());
  const dataUrl = `data:${file.type || 'image/jpeg'};base64,${base64}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model || 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text: AIExtractor._imagePrompt }
        ]
      }]
    })
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`API ${resp.status}: ${err.error?.message || resp.statusText}`);
  }
  const data = await resp.json();
  if (!data.choices?.[0]?.message?.content) throw new Error('API retornou resposta inesperada.');
  return data.choices[0].message.content;
};

AIExtractor._callGeminiVision = async function (file, config) {
  const base64 = AIExtractor._toBase64(await file.arrayBuffer());
  const model = config.model || 'gemini-1.5-flash';
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: file.type || 'image/jpeg', data: base64 } },
            { text: AIExtractor._imagePrompt }
          ]
        }]
      })
    }
  );
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`Gemini API ${resp.status}: ${err.error?.message || resp.statusText}`);
  }
  const data = await resp.json();
  if (!data.candidates?.[0]?.content?.parts?.[0]?.text) throw new Error('Gemini API retornou resposta inesperada.');
  return data.candidates[0].content.parts[0].text;
};

/**
 * Envia uma imagem diretamente à API de visão e retorna array de questões.
 * @param {File} file
 * @param {object} config - { provider, apiKey, model }
 * @returns {Promise<Array>}
 */
AIExtractor.extractQuestionsFromImage = async function (file, config) {
  if (!config.apiKey)   throw new Error('Chave de API não configurada. Clique em ⚙ Configurações de IA.');
  if (!config.provider) throw new Error('Provedor de IA não selecionado.');

  let raw;
  switch (config.provider) {
    case 'claude':
      raw = await AIExtractor._callClaudeVision(file, config);
      break;
    case 'openai':
      raw = await AIExtractor._callOpenAIVision(file, config, 'https://api.openai.com/v1/chat/completions');
      break;
    case 'openrouter':
      raw = await AIExtractor._callOpenAIVision(file, config, 'https://openrouter.ai/api/v1/chat/completions');
      break;
    case 'gemini':
      raw = await AIExtractor._callGeminiVision(file, config);
      break;
    default:
      throw new Error(`Provedor desconhecido: ${config.provider}`);
  }

  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('A IA não retornou um JSON válido para a imagem. Tente novamente.');
  let questions;
  try { questions = JSON.parse(match[0]); }
  catch (e) { throw new Error('Falha ao parsear resposta da IA: ' + e.message); }
  if (!Array.isArray(questions)) throw new Error('Resposta da IA não é um array de questões.');
  return questions;
};

// ── Prompt e provedores ───────────────────────────────────────────────────────

AIExtractor._buildPrompt = function (text) {
  const MAX_CHARS = 80000;
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
  const data = await resp.json();
  if (!data.content?.[0]?.text) throw new Error('Claude API retornou resposta inesperada.');
  return data.content[0].text;
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
  const data = await resp.json();
  if (!data.choices?.[0]?.message?.content) throw new Error('OpenAI API retornou resposta inesperada.');
  return data.choices[0].message.content;
};

AIExtractor._callOpenRouter = async function (prompt, config) {
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model || 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`OpenRouter API ${resp.status}: ${err.error?.message || resp.statusText}`);
  }
  const data = await resp.json();
  if (!data.choices?.[0]?.message?.content) throw new Error('OpenRouter API retornou resposta inesperada.');
  return data.choices[0].message.content;
};

AIExtractor._callGemini = async function (prompt, config) {
  const model = config.model || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': config.apiKey
    },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`Gemini API ${resp.status}: ${err.error?.message || resp.statusText}`);
  }
  const data = await resp.json();
  if (!data.candidates?.[0]?.content?.parts?.[0]?.text) throw new Error('Gemini API retornou resposta inesperada.');
  return data.candidates[0].content.parts[0].text;
};

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
    case 'claude':      raw = await AIExtractor._callClaude(prompt, config);      break;
    case 'openai':      raw = await AIExtractor._callOpenAI(prompt, config);      break;
    case 'openrouter':  raw = await AIExtractor._callOpenRouter(prompt, config);  break;
    case 'gemini':      raw = await AIExtractor._callGemini(prompt, config);      break;
    default: throw new Error(`Provedor desconhecido: ${config.provider}`);
  }

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
