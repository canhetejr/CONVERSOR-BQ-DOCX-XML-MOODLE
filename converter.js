/**
 * Conversor BQ DOCX → XML (Moodle)
 * Versão JavaScript para execução no navegador.
 * Equivalente ao main.py + models.py em Python.
 */

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const DML_NS  = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const REL_NS  = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/**
 * Extrai os parágrafos de um arquivo .docx (ArrayBuffer).
 * O .docx é um ZIP contendo word/document.xml.
 * Cada w:p vira um item no array (ordem do documento); texto de vários w:t no mesmo parágrafo é concatenado.
 */
async function readDocx(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const documentXml = await zip.file('word/document.xml').async('string');
  const parser = new DOMParser();
  const doc = parser.parseFromString(documentXml, 'text/xml');
  const paragraphs = [];
  const pNodes = doc.getElementsByTagNameNS(WORD_NS, 'p');
  for (let i = 0; i < pNodes.length; i++) {
    const p = pNodes[i];
    const tNodes = p.getElementsByTagNameNS(WORD_NS, 't');
    let text = '';
    for (let j = 0; j < tNodes.length; j++) {
      const node = tNodes[j];
      if (node.childNodes.length) {
        text += node.childNodes[0].nodeValue || '';
      }
    }
    paragraphs.push(text.trim());
  }
  return paragraphs;
}

/** Verifica se a linha é o marcador de justificativa (#Justificativa ou Justificativa). */
function isJustificativaMarker(line) {
  if (line == null) return false;
  const s = String(line).trim();
  return s === '#Justificativa' || s === 'Justificativa' || s === '#Justificativa:' || s === 'Justificativa:';
}

/** Encontra o início de "Justificativa" na linha (com ou sem #) para separar texto antes/depois. */
function splitJustificativaLine(line) {
  if (line == null) return null;
  const s = String(line);
  const lower = s.toLowerCase();
  const idxHash = lower.indexOf('#justificativa');
  const idxPlain = lower.indexOf('justificativa');
  const idx = idxHash >= 0 ? idxHash : idxPlain >= 0 ? idxPlain : -1;
  if (idx < 0) return null;
  const rest = s.slice(idx);
  const markerMatch = rest.match(/^#?justificativa:?\s*/i);
  // Fallback: "#justificativa" = 13 chars, "justificativa" = 12 chars (sem #)
  const len = markerMatch ? markerMatch[0].length : (rest[0] === '#' ? 13 : 12);
  return { before: s.slice(0, idx).trim(), after: s.slice(idx + len).trim() };
}

/**
 * Representa uma questão (enunciado, resposta correta, erradas, justificativa).
 */
class Question {
  constructor(textLines) {
    this.question = '';
    this.correct_answer = '';
    this.wrong_answer_list = [];
    this.justification = '';

    // Enunciado: até a primeira linha que seja #Resposta
    let t = textLines.shift();
    while (t !== undefined && String(t).trim() !== '#Resposta') {
      this.question += (t != null ? String(t) : '') + '\n';
      t = textLines.shift();
    }

    // Resposta correta: até a próxima linha #Resposta
    t = textLines.shift();
    while (t !== undefined && String(t).trim() !== '#Resposta') {
      this.correct_answer += (t != null ? String(t) : '') + '\n';
      t = textLines.shift();
    }
    this.question = this.question.trim();
    this.correct_answer = this.correct_answer.trim();

    let buffer = '';
    while (textLines.length) {
      t = textLines.shift();
      const tStr = t != null ? String(t) : '';
      const tTrimmed = tStr.trim();
      if (tTrimmed === '#Resposta') {
        const trimmed = buffer.trim();
        if (trimmed !== '') this.wrong_answer_list.push(trimmed);
        buffer = '';
      } else if (isJustificativaMarker(t)) {
        const trimmed = buffer.trim();
        if (trimmed !== '') this.wrong_answer_list.push(trimmed);
        break;
      } else {
        const split = splitJustificativaLine(t);
        if (split) {
          if (split.before) buffer += split.before + '\n';
          const trimmed = buffer.trim();
          if (trimmed !== '') this.wrong_answer_list.push(trimmed);
          if (split.after) textLines.unshift(split.after);
          break;
        }
        buffer += tStr + '\n';
      }
    }

    // Garantir 5 alternativas no total (1 correta + 4 erradas)
    while (this.wrong_answer_list.length < 4) {
      this.wrong_answer_list.push('');
    }

    // Tudo que sobrou é justificativa (linhas após #Justificativa)
    while (textLines.length) {
      t = textLines.shift();
      const line = t != null ? String(t) : '';
      this.justification += (this.justification ? '\n' : '') + line;
    }
    this.justification = this.justification.trim();
  }
}

/**
 * Banco de questões: cabeçalho + lista de questões.
 */
class BancoDeQuestoes {
  constructor(header) {
    this.header = header;
    this.question_list = [];
  }

  /**
   * Gera XML Moodle. Se questionList for passado, usa apenas essas questões (ex.: aprovadas).
   * @param {Question[]} [questionList] - Lista opcional de questões; se omitido, usa this.question_list.
   */
  toXmlString(questionList) {
    const list = questionList != null ? questionList : this.question_list;
    const lines = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<quiz>');

    list.forEach((q, n) => {
      const idx = n + 1;
      lines.push('  <question type="multichoice">');
      lines.push('    <name>');
      lines.push(`      <text><![CDATA[Questão ${idx}]]></text>`);
      lines.push('    </name>');
      lines.push('    <questiontext format="html">');
      lines.push(`      <text><![CDATA[${escapeCdata(q.question)}]]></text>`);
      lines.push('    </questiontext>');
      lines.push('    <generalfeedback format="moodle_auto_format">');
      lines.push(`      <text><![CDATA[${escapeCdata(q.justification || '')}]]></text>`);
      lines.push('    </generalfeedback>');
      lines.push('    <defaultgrade>1.0000000</defaultgrade>');
      lines.push('    <penalty>0.3333333</penalty>');
      lines.push('    <hidden>0</hidden>');
      lines.push('    <idnumber></idnumber>');
      lines.push('    <single>true</single>');
      lines.push('    <shuffleanswers>true</shuffleanswers>');
      lines.push('    <answernumbering>abc</answernumbering>');
      lines.push('    <correctfeedback format="moodle_auto_format">');
      lines.push('      <text><![CDATA[Sua resposta está correta.]]></text>');
      lines.push('    </correctfeedback>');
      lines.push('    <partiallycorrectfeedback format="moodle_auto_format">');
      lines.push('      <text><![CDATA[Sua resposta está parcialmente correta.]]></text>');
      lines.push('    </partiallycorrectfeedback>');
      lines.push('    <incorrectfeedback format="moodle_auto_format">');
      lines.push('      <text><![CDATA[Sua resposta está incorreta.]]></text>');
      lines.push('    </incorrectfeedback>');
      lines.push('    <shownumcorrect></shownumcorrect>');
      lines.push('    <answer fraction="100" format="html">');
      lines.push(`      <text><![CDATA[${escapeCdata(q.correct_answer)}]]></text>`);
      lines.push('      <feedback format="moodle_auto_format">');
      lines.push(`        <text><![CDATA[${escapeCdata(q.justification || '')}]]></text>`);
      lines.push('      </feedback>');
      lines.push('    </answer>');
      // Sempre 4 alternativas erradas (total 5 com a correta)
      const wrongList = (q.wrong_answer_list || []).slice(0, 4);
      while (wrongList.length < 4) wrongList.push('');
      wrongList.forEach((a) => {
        const text = a != null ? String(a).trim() : '';
        lines.push('    <answer fraction="0" format="html">');
        lines.push(`      <text><![CDATA[${escapeCdata(text)}]]></text>`);
        lines.push('      <feedback format="moodle_auto_format">');
        lines.push('        <text><![CDATA[]]></text>');
        lines.push('      </feedback>');
        lines.push('    </answer>');
      });
      lines.push('  </question>');
    });

    lines.push('</quiz>');
    return lines.join('\n');
  }
}

function escapeCdata(s) {
  if (s == null) return '';
  return String(s)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/]]>/g, ']]]]><![CDATA[>')
    .trim();
}

/**
 * Parse da lista de parágrafos no formato BQ:
 * - Cabeçalho até o primeiro "#Questão"
 * - Blocos separados por "#Questão" ou "#Final"; cada bloco vira uma Question.
 */
function textParse(paragraphs) {
  const doc = [...paragraphs];
  let header = '';
  let paragraph = doc.shift();
  const isTag = (p, tag) => p != null && String(p).trim() === tag;
  while (paragraph !== undefined && !isTag(paragraph, '#Questão')) {
    header += (header ? '\n' : '') + (paragraph != null ? String(paragraph) : '');
    paragraph = doc.shift();
  }

  const responseBQ = new BancoDeQuestoes(header.trim());
  let buffer = [];

  while (doc.length) {
    paragraph = doc.shift();
    if (!isTag(paragraph, '#Questão') && !isTag(paragraph, '#Final')) {
      buffer.push(paragraph);
    } else {
      if (buffer.length) {
        const question = new Question(buffer);
        responseBQ.question_list.push(question);
      }
      buffer = [];
    }
  }
  if (buffer.length) {
    responseBQ.question_list.push(new Question(buffer));
  }

  return responseBQ;
}

/**
 * Fluxo completo: arquivo .docx (File) → XML (string).
 */
async function convertDocxToXml(file) {
  const banco = await convertDocxToBanco(file);
  return banco.toXmlString();
}

/**
 * Converte .docx em BancoDeQuestoes (header + question_list) para a UI exibir no modal.
 */
async function convertDocxToBanco(file) {
  const arrayBuffer = await file.arrayBuffer();
  const paragraphs = await readDocx(arrayBuffer);
  return textParse(paragraphs);
}

/**
 * Converte texto BQ (uma linha = um parágrafo) em BancoDeQuestoes. Para uso no editor.
 */
function parseTextToBanco(text) {
  const lines = String(text || '').split(/\r?\n/).map((s) => s.trim());
  return textParse(lines);
}

// ── Suporte a imagens e fórmulas ─────────────────────────────────────────────

/** Retorna o primeiro filho direto com o namespace MATH_NS e localName indicado. */
function _mathChild(node, localName) {
  for (let i = 0; i < node.childNodes.length; i++) {
    const c = node.childNodes[i];
    if (c.namespaceURI === MATH_NS && c.localName === localName) return c;
  }
  return null;
}

/** Retorna todos os filhos diretos com o namespace MATH_NS e localName indicado. */
function _mathChildren(node, localName) {
  const result = [];
  for (let i = 0; i < node.childNodes.length; i++) {
    const c = node.childNodes[i];
    if (c.namespaceURI === MATH_NS && c.localName === localName) result.push(c);
  }
  return result;
}

/** Converte recursivamente um nó OMML em string LaTeX. */
function _ommlNodeToLatex(node) {
  if (!node) return '';
  if (node.nodeType === 3) return node.textContent || '';
  if (node.nodeType !== 1) return '';
  const ns = node.namespaceURI;
  const ln = node.localName;
  if (ns !== MATH_NS) {
    let s = '';
    for (let i = 0; i < node.childNodes.length; i++) s += _ommlNodeToLatex(node.childNodes[i]);
    return s;
  }
  const childrenLatex = (parent) => {
    let s = '';
    for (let i = 0; i < parent.childNodes.length; i++) s += _ommlNodeToLatex(parent.childNodes[i]);
    return s;
  };
  switch (ln) {
    case 'oMathPara': case 'oMath': return childrenLatex(node);
    case 'r': { const t = _mathChild(node, 't'); return t ? (t.textContent || '') : ''; }
    case 't': return node.textContent || '';
    case 'f': {
      const num = _mathChild(node, 'num'), den = _mathChild(node, 'den');
      return `\\frac{${num ? childrenLatex(num) : ''}}{${den ? childrenLatex(den) : ''}}`;
    }
    case 'rad': {
      const deg = _mathChild(node, 'deg'), e = _mathChild(node, 'e');
      const dL = deg ? childrenLatex(deg) : '', eL = e ? childrenLatex(e) : '';
      return dL.trim() ? `\\sqrt[${dL}]{${eL}}` : `\\sqrt{${eL}}`;
    }
    case 'sSup': {
      const e = _mathChild(node, 'e'), sup = _mathChild(node, 'sup');
      return `${e ? childrenLatex(e) : ''}^{${sup ? childrenLatex(sup) : ''}}`;
    }
    case 'sSub': {
      const e = _mathChild(node, 'e'), sub = _mathChild(node, 'sub');
      return `${e ? childrenLatex(e) : ''}_{${sub ? childrenLatex(sub) : ''}}`;
    }
    case 'sSubSup': {
      const e = _mathChild(node, 'e'), sub = _mathChild(node, 'sub'), sup = _mathChild(node, 'sup');
      return `${e ? childrenLatex(e) : ''}_{${sub ? childrenLatex(sub) : ''}}^{${sup ? childrenLatex(sup) : ''}}`;
    }
    case 'd': {
      const dPr = _mathChild(node, 'dPr');
      let beg = '(', end = ')';
      if (dPr) {
        const bEl = _mathChild(dPr, 'begChr'), eEl = _mathChild(dPr, 'endChr');
        if (bEl) beg = bEl.getAttributeNS(MATH_NS, 'val') || bEl.getAttribute('m:val') || '(';
        if (eEl) end = eEl.getAttributeNS(MATH_NS, 'val') || eEl.getAttribute('m:val') || ')';
      }
      const es = _mathChildren(node, 'e');
      return beg + es.map(childrenLatex).join(',') + end;
    }
    case 'nary': {
      const pr = _mathChild(node, 'naryPr');
      let oper = '\\sum';
      if (pr) {
        const chrEl = _mathChild(pr, 'chr');
        if (chrEl) {
          const c = chrEl.getAttributeNS(MATH_NS, 'val') || chrEl.getAttribute('m:val') || '';
          if (c === '∫') oper = '\\int';
          else if (c === '∏') oper = '\\prod';
          else if (c) oper = c;
        }
      }
      const sub = _mathChild(node, 'sub'), sup = _mathChild(node, 'sup'), e = _mathChild(node, 'e');
      return `${oper}${sub ? `_{${childrenLatex(sub)}}` : ''}${sup ? `^{${childrenLatex(sup)}}` : ''}{${e ? childrenLatex(e) : ''}}`;
    }
    case 'func': {
      const fName = _mathChild(node, 'fName'), e = _mathChild(node, 'e');
      return `${fName ? childrenLatex(fName) : ''}(${e ? childrenLatex(e) : ''})`;
    }
    default: return childrenLatex(node);
  }
}

/**
 * Converte um nó m:oMath ou m:oMathPara em LaTeX inline para MathJax: \(...\).
 */
function ommlToLatex(oMathNode) {
  const latex = _ommlNodeToLatex(oMathNode).trim();
  return latex ? `\\(${latex}\\)` : '';
}

/** Extrai conteúdo rico (texto HTML-escapado + imagens) de um w:r. */
function _extractRunRich(rNode, imageMap) {
  let result = '';
  for (let i = 0; i < rNode.childNodes.length; i++) {
    const child = rNode.childNodes[i];
    if (child.nodeType !== 1) continue;
    const ns = child.namespaceURI, ln = child.localName;
    if (ns === WORD_NS && ln === 't') {
      const text = child.textContent || '';
      result += text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    } else if (ns === WORD_NS && ln === 'drawing') {
      const blips = child.getElementsByTagNameNS(DML_NS, 'blip');
      if (blips.length > 0) {
        const rId = blips[0].getAttributeNS(REL_NS, 'embed') || blips[0].getAttribute('r:embed');
        if (rId && imageMap[rId]) {
          result += `<img src="${imageMap[rId]}" alt="imagem" style="max-width:100%;height:auto;">`;
        }
      }
    }
  }
  return result;
}

/**
 * Extrai conteúdo rico (texto, imagens e fórmulas) de um nó w:p.
 * O texto é HTML-escapado; imagens viram <img> base64; fórmulas viram LaTeX \(...\).
 */
function extractParagraphRich(pNode, imageMap) {
  let result = '';
  for (let i = 0; i < pNode.childNodes.length; i++) {
    const child = pNode.childNodes[i];
    if (child.nodeType !== 1) continue;
    const ns = child.namespaceURI, ln = child.localName;
    if (ns === WORD_NS && ln === 'r') {
      result += _extractRunRich(child, imageMap);
    } else if (ns === WORD_NS && (ln === 'hyperlink' || ln === 'ins' || ln === 'smartTag')) {
      result += extractParagraphRich(child, imageMap);
    } else if (ns === WORD_NS && ln === 'sdt') {
      const sdtContent = child.getElementsByTagNameNS(WORD_NS, 'sdtContent')[0];
      if (sdtContent) result += extractParagraphRich(sdtContent, imageMap);
    } else if (ns === MATH_NS && (ln === 'oMath' || ln === 'oMathPara')) {
      result += ommlToLatex(child);
    }
  }
  return result;
}

/**
 * Lê word/_rels/document.xml.rels e retorna mapa rId → data URL base64 para cada imagem.
 */
async function buildImageMap(zip) {
  const imageMap = {};
  const relsFile = zip.file('word/_rels/document.xml.rels');
  if (!relsFile) return imageMap;
  const relsXml = await relsFile.async('string');
  const parser = new DOMParser();
  const relsDoc = parser.parseFromString(relsXml, 'text/xml');
  const rels = relsDoc.getElementsByTagName('Relationship');
  const MIME = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp',
    tif: 'image/tiff', tiff: 'image/tiff'
  };
  for (let i = 0; i < rels.length; i++) {
    const rel = rels[i];
    if (!(rel.getAttribute('Type') || '').endsWith('/image')) continue;
    const rId = rel.getAttribute('Id');
    const target = (rel.getAttribute('Target') || '').replace(/\\/g, '/');
    if (!rId || !target) continue;
    const path = target.startsWith('/') ? target.slice(1) : 'word/' + target;
    const mediaFile = zip.file(path);
    if (!mediaFile) continue;
    try {
      const base64 = await mediaFile.async('base64');
      const ext = target.split('.').pop().toLowerCase();
      imageMap[rId] = `data:${MIME[ext] || 'image/png'};base64,${base64}`;
    } catch (_) { /* ignora imagem ilegível */ }
  }
  return imageMap;
}

/**
 * Versão rica de readDocx: cada parágrafo pode conter HTML com imagens e fórmulas LaTeX.
 */
async function readDocxRich(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const imageMap = await buildImageMap(zip);
  const documentXml = await zip.file('word/document.xml').async('string');
  const parser = new DOMParser();
  const doc = parser.parseFromString(documentXml, 'text/xml');
  const paragraphs = [];
  const pNodes = doc.getElementsByTagNameNS(WORD_NS, 'p');
  for (let i = 0; i < pNodes.length; i++) {
    paragraphs.push(extractParagraphRich(pNodes[i], imageMap).trim());
  }
  return paragraphs;
}

/**
 * Versão rica de convertDocxToBanco: preserva imagens e fórmulas. Usa o mesmo textParse.
 */
async function convertDocxToBancoRich(file) {
  const arrayBuffer = await file.arrayBuffer();
  const paragraphs = await readDocxRich(arrayBuffer);
  return textParse(paragraphs);
}

// Exportar para uso global no HTML
window.BQConverter = window.BQConverter || {};
window.BQConverter.readDocx = readDocx;
window.BQConverter.textParse = textParse;
window.BQConverter.Question = Question;
window.BQConverter.BancoDeQuestoes = BancoDeQuestoes;
window.BQConverter.convertDocxToXml = convertDocxToXml;
window.BQConverter.convertDocxToBanco = convertDocxToBanco;
window.BQConverter.parseTextToBanco = parseTextToBanco;
window.BQConverter.buildImageMap = buildImageMap;
window.BQConverter.ommlToLatex = ommlToLatex;
window.BQConverter.extractParagraphRich = extractParagraphRich;
window.BQConverter.readDocxRich = readDocxRich;
window.BQConverter.convertDocxToBancoRich = convertDocxToBancoRich;
