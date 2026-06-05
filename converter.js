/**
 * Conversor BQ DOCX → XML (Moodle)
 * Versão JavaScript para execução no navegador.
 * Equivalente ao main.py + models.py em Python.
 */

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const DML_NS  = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const REL_NS  = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Remove todas as tags HTML de uma string e retorna o texto limpo. */
function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, '').trim();
}

/**
 * Verifica se uma string (possivelmente HTML) é exatamente um marcador BQ.
 * Retorna o marcador canônico ou null.
 */
function _resolveMarker(s) {
  const plain = stripHtml(String(s || ''));
  if (/^#questão$/i.test(plain))                   return '#Questão';
  if (/^#resposta$/i.test(plain))                  return '#Resposta';
  if (/^#final$/i.test(plain))                     return '#Final';
  if (/^#?justificativas?:?$/i.test(plain))        return '#Justificativa';
  return null;
}

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
  const s = stripHtml(String(line));
  return /^#?justificativas?:?$/i.test(s);
}

/** Encontra o início de "Justificativa" na linha (com ou sem #) para separar texto antes/depois. */
function splitJustificativaLine(line) {
  if (line == null) return null;
  // Trabalha no texto plano para encontrar a posição; se for HTML, busca na versão stripped
  const plain = stripHtml(String(line));
  const lower = plain.toLowerCase();
  const idxHash = lower.indexOf('#justificativa');
  const idxPlain = lower.indexOf('justificativa');
  const idx = idxHash >= 0 ? idxHash : idxPlain >= 0 ? idxPlain : -1;
  if (idx < 0) return null;
  const rest = plain.slice(idx);
  const markerMatch = rest.match(/^#?justificativas?:?\s*/i);
  const len = markerMatch ? markerMatch[0].length : (rest[0] === '#' ? 13 : 12);
  // Retorna conteúdo como texto plano (HTML já foi stripped para evitar tags quebradas)
  return { before: plain.slice(0, idx).trim(), after: plain.slice(idx + len).trim() };
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
    while (t !== undefined && stripHtml(String(t)) !== '#Resposta') {
      this.question += (t != null ? String(t) : '') + '\n';
      t = textLines.shift();
    }

    // Resposta correta: até a próxima linha #Resposta
    t = textLines.shift();
    while (t !== undefined && stripHtml(String(t)) !== '#Resposta') {
      this.correct_answer += (t != null ? String(t) : '') + '\n';
      t = textLines.shift();
    }
    this.question = this.question.trim();
    this.correct_answer = this.correct_answer.trim();

    let buffer = '';
    while (textLines.length) {
      t = textLines.shift();
      const tStr = t != null ? String(t) : '';
      const tTrimmed = stripHtml(tStr);
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
  toXmlString(questionList, category) {
    const list = questionList != null ? questionList : this.question_list;
    const lines = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<quiz>');

    if (category && String(category).trim()) {
      const cat = escapeCdata(String(category).trim());
      lines.push('  <question type="category">');
      lines.push('    <category>');
      lines.push(`      <text>$course$/top/${cat}</text>`);
      lines.push('    </category>');
      lines.push('    <info format="moodle_auto_format"><text></text></info>');
      lines.push('    <idnumber></idnumber>');
      lines.push('  </question>');
    }

    list.forEach((q, n) => {
      const idx = n + 1;
      lines.push('  <question type="multichoice">');
      lines.push('    <name>');
      lines.push(`      <text><![CDATA[Questão ${idx}]]></text>`);
      lines.push('    </name>');
      lines.push('    <questiontext format="html">');
      lines.push(`      <text><![CDATA[${_cdataHtml(q.question)}]]></text>`);
      lines.push('    </questiontext>');
      lines.push('    <generalfeedback format="html">');
      lines.push(`      <text><![CDATA[${_cdataHtml(q.justification || '')}]]></text>`);
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
      lines.push(`      <text><![CDATA[${_cdataHtml(q.correct_answer)}]]></text>`);
      lines.push('      <feedback format="html">');
      lines.push(`        <text><![CDATA[${_cdataHtml(q.justification || '')}]]></text>`);
      lines.push('      </feedback>');
      lines.push('    </answer>');
      // Sempre 4 alternativas erradas (total 5 com a correta)
      const wrongList = (q.wrong_answer_list || []).slice(0, 4);
      while (wrongList.length < 4) wrongList.push('');
      wrongList.forEach((a) => {
        const text = a != null ? String(a).trim() : '';
        lines.push('    <answer fraction="0" format="html">');
        lines.push(`      <text><![CDATA[${_cdataHtml(text)}]]></text>`);
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

/** Para campos format="html": converte quebras de parágrafo (\n) em <br> para o Moodle renderizar corretamente. */
function _cdataHtml(s) {
  return escapeCdata(s).replace(/\n+/g, '<br>');
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
  const isTag = (p, tag) => p != null && stripHtml(String(p)) === tag;
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

/** Retorna o primeiro filho direto com o namespace WORD_NS e localName indicado. */
function _wordChild(node, localName) {
  for (let i = 0; i < node.childNodes.length; i++) {
    const c = node.childNodes[i];
    if (c.namespaceURI === WORD_NS && c.localName === localName) return c;
  }
  return null;
}

/** Verifica se uma propriedade de run (dentro de w:rPr) está ativa. */
function _isRprActive(rPr, localName) {
  const el = _wordChild(rPr, localName);
  if (!el) return false;
  const val = el.getAttributeNS(WORD_NS, 'val') || el.getAttribute('w:val');
  if (localName === 'u') return val !== 'none';
  return val !== '0' && val !== 'false';
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

/** Extrai conteúdo rico (texto HTML-escapado + formatação + imagens) de um w:r. */
function _extractRunRich(rNode, imageMap) {
  const rPr = _wordChild(rNode, 'rPr');
  const isBold      = rPr && _isRprActive(rPr, 'b');
  const isItalic    = rPr && _isRprActive(rPr, 'i');
  const isUnderline = rPr && _isRprActive(rPr, 'u');

  let result = '';
  for (let i = 0; i < rNode.childNodes.length; i++) {
    const child = rNode.childNodes[i];
    if (child.nodeType !== 1) continue;
    const ns = child.namespaceURI, ln = child.localName;
    if (ns === WORD_NS && ln === 't') {
      let text = (child.textContent || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      if (text) {
        if (isUnderline) text = `<u>${text}</u>`;
        if (isItalic)    text = `<em>${text}</em>`;
        if (isBold)      text = `<strong>${text}</strong>`;
      }
      result += text;
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

/** Converte um nó w:tbl em string HTML <table>. */
function _extractTableRich(tblNode, imageMap) {
  let html = '<table style="border-collapse:collapse;width:100%;margin:0.5rem 0">';
  for (let i = 0; i < tblNode.childNodes.length; i++) {
    const row = tblNode.childNodes[i];
    if (row.nodeType !== 1 || row.namespaceURI !== WORD_NS || row.localName !== 'tr') continue;
    html += '<tr>';
    for (let j = 0; j < row.childNodes.length; j++) {
      const cell = row.childNodes[j];
      if (cell.nodeType !== 1 || cell.namespaceURI !== WORD_NS || cell.localName !== 'tc') continue;
      const pNodes = cell.getElementsByTagNameNS(WORD_NS, 'p');
      const parts = [];
      for (let k = 0; k < pNodes.length; k++) {
        const c = extractParagraphRich(pNodes[k], imageMap).trim();
        if (c) parts.push(c);
      }
      html += `<td style="border:1px solid #888;padding:4px 8px;vertical-align:top">${parts.join('<br>')}</td>`;
    }
    html += '</tr>';
  }
  return html + '</table>';
}

/** Lê word/numbering.xml e retorna mapa numId → 'ul' | 'ol'. */
async function _buildListTypeMap(zip) {
  const result = {};
  const f = zip.file('word/numbering.xml');
  if (!f) return result;
  try {
    const xml = await f.async('string');
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const absMap = {};
    const absNums = doc.getElementsByTagNameNS(WORD_NS, 'abstractNum');
    for (let i = 0; i < absNums.length; i++) {
      const an = absNums[i];
      const absId = an.getAttributeNS(WORD_NS, 'abstractNumId') || an.getAttribute('w:abstractNumId');
      const lvls = an.getElementsByTagNameNS(WORD_NS, 'lvl');
      for (let j = 0; j < lvls.length; j++) {
        const lvl = lvls[j];
        const ilvl = lvl.getAttributeNS(WORD_NS, 'ilvl') || lvl.getAttribute('w:ilvl');
        if (ilvl === '0') {
          const fmtEls = lvl.getElementsByTagNameNS(WORD_NS, 'numFmt');
          const fmt = fmtEls.length > 0
            ? (fmtEls[0].getAttributeNS(WORD_NS, 'val') || fmtEls[0].getAttribute('w:val') || 'bullet')
            : 'bullet';
          absMap[absId] = fmt;
          break;
        }
      }
    }
    const nums = doc.getElementsByTagNameNS(WORD_NS, 'num');
    for (let i = 0; i < nums.length; i++) {
      const num = nums[i];
      const numId = num.getAttributeNS(WORD_NS, 'numId') || num.getAttribute('w:numId');
      const absIdEls = num.getElementsByTagNameNS(WORD_NS, 'abstractNumId');
      const absId = absIdEls.length > 0
        ? (absIdEls[0].getAttributeNS(WORD_NS, 'val') || absIdEls[0].getAttribute('w:val'))
        : null;
      const fmt = absMap[absId] || 'bullet';
      result[numId] = (fmt === 'bullet' || fmt === 'none') ? 'ul' : 'ol';
    }
  } catch (_) {}
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
 * Versão rica de readDocx: itera filhos diretos do body para preservar estrutura de
 * tabelas (w:tbl → <table>) e listas (w:numPr → <ul>/<ol>).
 */
async function readDocxRich(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const [imageMap, listTypeMap] = await Promise.all([buildImageMap(zip), _buildListTypeMap(zip)]);
  const documentXml = await zip.file('word/document.xml').async('string');
  const doc = new DOMParser().parseFromString(documentXml, 'text/xml');

  const body = doc.getElementsByTagNameNS(WORD_NS, 'body')[0];
  if (!body) return [];

  const paragraphs = [];
  const listBuf = [];
  let listTag = 'ul';

  function flushList() {
    if (!listBuf.length) return;
    paragraphs.push(`<${listTag}>${listBuf.join('')}</${listTag}>`);
    listBuf.length = 0;
  }

  /**
   * Normaliza parágrafo cujo texto (sem HTML) é exatamente um marcador BQ,
   * e divide parágrafos com marcador inline no final (ex: "Alternativa<strong>#Resposta</strong>").
   * Retorna array de strings a empurrar em paragraphs[].
   */
  function _normalizeParagraphContent(content) {
    if (!content) return [''];
    const plain = stripHtml(content);

    // Caso 1: parágrafo inteiro é um marcador (possivelmente formatado)
    const exactMarker = _resolveMarker(plain);
    if (exactMarker) return [exactMarker];

    // Caso 2: marcador no final do parágrafo (inline, mesmo w:p)
    const inlineMarkers = ['#Resposta', '#Questão', '#Final', '#Justificativa'];
    for (const marker of inlineMarkers) {
      const reSource = marker.replace(/[#.*+?^${}()|[\]\\]/g, '\\$&');
      // verifica se plain termina com o marcador
      if (!new RegExp(reSource + '$', 'i').test(plain)) continue;
      if (plain === marker) break; // já tratado acima
      // remove o marcador (e qualquer tag que o envolva) do final do HTML
      const cleaned = content
        .replace(new RegExp(`\\s*<[^>]+>\\s*${reSource}\\s*</[^>]+>\\s*$`, 'i'), '')
        .replace(new RegExp(`\\s*${reSource}\\s*$`, 'i'), '')
        .trim();
      const result = [];
      if (cleaned) result.push(cleaned);
      result.push(marker);
      return result;
    }

    return [content];
  }

  function processNode(node) {
    if (node.nodeType !== 1 || node.namespaceURI !== WORD_NS) return;
    const ln = node.localName;
    if (ln === 'p') {
      const pPr = _wordChild(node, 'pPr');
      const numPr = pPr ? _wordChild(pPr, 'numPr') : null;
      const raw = extractParagraphRich(node, imageMap).trim();
      const parts = _normalizeParagraphContent(raw);

      if (numPr && parts.length === 1 && !_resolveMarker(parts[0])) {
        // item de lista normal (sem marcador BQ inline)
        const numIdEl = _wordChild(numPr, 'numId');
        const numId = numIdEl ? (numIdEl.getAttributeNS(WORD_NS, 'val') || numIdEl.getAttribute('w:val')) : null;
        const tag = (numId && listTypeMap[numId]) || 'ul';
        if (tag !== listTag && listBuf.length) flushList();
        listTag = tag;
        listBuf.push(`<li>${parts[0]}</li>`);
      } else {
        flushList();
        for (const p of parts) paragraphs.push(p);
      }
    } else if (ln === 'tbl') {
      flushList();
      paragraphs.push(_extractTableRich(node, imageMap));
    } else if (ln === 'sdt') {
      const sdtContent = _wordChild(node, 'sdtContent');
      if (sdtContent) {
        for (let i = 0; i < sdtContent.childNodes.length; i++) processNode(sdtContent.childNodes[i]);
      }
    }
  }

  for (let i = 0; i < body.childNodes.length; i++) processNode(body.childNodes[i]);
  flushList();

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
