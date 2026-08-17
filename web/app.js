'use strict';

const { createApp, ref, computed, watch, nextTick, onMounted } = Vue;

// ─── PlantUML encoding ────────────────────────────────────────────────────────

function encodePlantUML(code) {
  if (typeof pako === 'undefined') return '';
  const data = new TextEncoder().encode(code);
  const compressed = pako.deflate(data, { level: 9 });
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
  let result = '';
  for (let i = 0; i < compressed.length; i += 3) {
    const b0 = compressed[i], b1 = compressed[i + 1] ?? 0, b2 = compressed[i + 2] ?? 0;
    result += chars[(b0 >> 2) & 0x3f];
    result += chars[((b0 << 4) | (b1 >> 4)) & 0x3f];
    result += chars[((b1 << 2) | (b2 >> 6)) & 0x3f];
    result += chars[b2 & 0x3f];
  }
  return result;
}

// ─── Markdown rendering ───────────────────────────────────────────────────────

function renderMarkdown(text, container) {
  if (!text || !container) return;

  marked.setOptions({ gfm: true, breaks: true });

  const mermaidBlocks = [];
  const mathBlocks = [];   // display math  $$...$$
  const mathInlines = [];  // inline math   $...$

  // Extract fenced code blocks and mermaid/plantuml first to avoid touching their content.
  // Then extract math blocks before marked.js can mangle them.

  let src = text.replace(/```mermaid\n([\s\S]*?)```/g, (_, code) => {
    const idx = mermaidBlocks.length;
    mermaidBlocks.push(code.trim());
    return `<div class="mermaid-placeholder" data-idx="${idx}"></div>`;
  });

  src = src.replace(/```plantuml\n([\s\S]*?)```/g, (_, code) => {
    const encoded = encodePlantUML(code.trim());
    return `<img src="https://www.plantuml.com/plantuml/svg/${encoded}" class="plantuml-img" alt="PlantUML diagram">`;
  });

  // Protect display math ($$...$$) from marked.js — must come before inline math.
  src = src.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
    const idx = mathBlocks.length;
    mathBlocks.push(math);
    return `<span class="math-display-placeholder" data-idx="${idx}"></span>`;
  });

  // Protect inline math ($...$). Exclude currency patterns like $1,234 by requiring
  // that the closing $ is preceded by a non-space character.
  src = src.replace(/\$([^\n$]+?)\$/g, (_, math) => {
    const idx = mathInlines.length;
    mathInlines.push(math);
    return `<span class="math-inline-placeholder" data-idx="${idx}"></span>`;
  });

  container.innerHTML = marked.parse(src);

  // Restore math placeholders and render with KaTeX directly.
  if (typeof katex !== 'undefined') {
    container.querySelectorAll('.math-display-placeholder').forEach(el => {
      const idx = parseInt(el.dataset.idx, 10);
      try {
        el.outerHTML = katex.renderToString(mathBlocks[idx], { displayMode: true, throwOnError: false });
      } catch (e) {
        el.outerHTML = `<code>$$${mathBlocks[idx]}$$</code>`;
      }
    });
    container.querySelectorAll('.math-inline-placeholder').forEach(el => {
      const idx = parseInt(el.dataset.idx, 10);
      try {
        el.outerHTML = katex.renderToString(mathInlines[idx], { displayMode: false, throwOnError: false });
      } catch (e) {
        el.outerHTML = `<code>$${mathInlines[idx]}$</code>`;
      }
    });
  } else if (typeof renderMathInElement !== 'undefined') {
    // Fallback: restore placeholders as raw delimiters and let auto-render handle them.
    container.querySelectorAll('.math-display-placeholder').forEach(el => {
      const idx = parseInt(el.dataset.idx, 10);
      const span = document.createElement('span');
      span.textContent = `$$${mathBlocks[idx]}$$`;
      el.replaceWith(span);
    });
    container.querySelectorAll('.math-inline-placeholder').forEach(el => {
      const idx = parseInt(el.dataset.idx, 10);
      const span = document.createElement('span');
      span.textContent = `$${mathInlines[idx]}$`;
      el.replaceWith(span);
    });
    try {
      renderMathInElement(container, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
        ],
        throwOnError: false,
      });
    } catch (e) {
      console.warn('KaTeX:', e);
    }
  }

  if (typeof mermaid !== 'undefined' && mermaidBlocks.length > 0) {
    mermaid.initialize({ startOnLoad: false, theme: 'default' });
    container.querySelectorAll('.mermaid-placeholder').forEach(placeholder => {
      const idx = parseInt(placeholder.dataset.idx, 10);
      const div = document.createElement('div');
      div.className = 'mermaid';
      div.textContent = mermaidBlocks[idx];
      placeholder.replaceWith(div);
    });
    mermaid.run({ nodes: container.querySelectorAll('.mermaid') }).catch(() => {});
  }
}

// ─── Markdown renderer component ──────────────────────────────────────────────

const MarkdownRenderer = {
  template: '#tpl-markdown-renderer',
  props: { content: { type: String, default: '' } },
  mounted() { this.render(); },
  watch: {
    content() { nextTick(() => this.render()); },
  },
  methods: {
    render() { renderMarkdown(this.content, this.$refs.container); },
  },
};

// ─── API ─────────────────────────────────────────────────────────────────────

const api = {
  async getEntries() {
    return (await fetch('/api/entries')).json();
  },
  async getEntry(key) {
    return (await fetch(`/api/entries/${encodeURIComponent(key)}`)).json();
  },
  async getDb() {
    return (await fetch('/api/db')).json();
  },
  async exportBib(keys) {
    const r = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys }),
    });
    return r.text();
  },
  async exportDb(keys) {
    const r = await fetch('/api/export/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys }),
    });
    return r.blob();
  },
  async updateField(citeKey, fieldKey, value) {
    return fetch(`/api/entries/${encodeURIComponent(citeKey)}/fields/${encodeURIComponent(fieldKey)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field_value: value }),
    });
  },
  async deleteField(citeKey, fieldKey) {
    return fetch(`/api/entries/${encodeURIComponent(citeKey)}/fields/${encodeURIComponent(fieldKey)}`, {
      method: 'DELETE',
    });
  },
  async addField(citeKey, fieldKey, value) {
    const r = await fetch(`/api/entries/${encodeURIComponent(citeKey)}/fields`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field_key: fieldKey, field_value: value }),
    });
    return r.json();
  },
  async updateExtra(id, value, note = null) {
    return fetch(`/api/extras/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ extra_value: value, note }),
    });
  },
  async deleteExtra(id) {
    return fetch(`/api/extras/${id}`, { method: 'DELETE' });
  },
  async addExtra(citeKey, extraKey, value, note = null) {
    return fetch(`/api/entries/${encodeURIComponent(citeKey)}/extras`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ extra_key: extraKey, extra_value: value, note }),
    });
  },
  async getTags() {
    return (await fetch('/api/tags')).json();
  },
  async addTag(citeKey, name) {
    return fetch(`/api/entries/${encodeURIComponent(citeKey)}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  },
  async deleteTag(citeKey, name) {
    return fetch(`/api/entries/${encodeURIComponent(citeKey)}/tags/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  },
  async getFigures(citeKey) {
    return (await fetch(`/api/entries/${encodeURIComponent(citeKey)}/figures`)).json();
  },
  async addFigure(citeKey, { label, memo, image_base64, image_mime }) {
    const r = await fetch(`/api/entries/${encodeURIComponent(citeKey)}/figures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, memo, image_base64, image_mime }),
    });
    return r.json();
  },
  async updateFigure(id, label, memo) {
    return fetch(`/api/figures/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, memo }),
    });
  },
  async deleteFigure(id) {
    return fetch(`/api/figures/${id}`, { method: 'DELETE' });
  },
  async reorderFigures(citeKey, ids) {
    return fetch(`/api/entries/${encodeURIComponent(citeKey)}/figures/order`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
  },
  async bulkAddTag(keys, name) {
    return fetch('/api/tags/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys, name }),
    });
  },
  async createEntry(citeKey, entryType, fields) {
    const r = await fetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cite_key: citeKey, entry_type: entryType, fields }),
    });
    let body = {};
    try { body = await r.json(); } catch (_) { /* no body */ }
    return { status: r.status, body };
  },
};

// ─── BibTeX parsing (dependency-free; single entry) ───────────────────────────
// 元は ingest-paper (ingest_paper.html) の同種ロジックを移植・拡張したもの。
// bibweb は SQLite に直接書き込む設計のため、パースはここで完結させ bibtexparser には依存しない。

function stripTex(s) {
  return (s || '').replace(/\\[a-zA-Z]+/g, '').replace(/[{}\\~]/g, '').replace(/\s+/g, ' ').trim();
}

function foldAscii(s) {
  return (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]/g, '');
}

const CJK_RE = /[぀-ヿ㐀-鿿･-ﾟ]/;

const CITEKEY_STOPWORDS = new Set(('a an the on of and or in for with to from at by into über under is are was were be been ' +
  'do does did can could should would what when why how which who whom whose this that these those toward towards ' +
  'some any all no not new note notes essay essays study studies evidence analysis approach').split(/\s+/));

function splitBibFields(body) {
  // "field = {...}, field2 = {...}" を波括弧の深さ・クォートを考慮してトップレベルのカンマで分割する
  const pairs = [];
  let depth = 0, inStr = false, start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"') inStr = !inStr;
    else if (!inStr && c === '{') depth++;
    else if (!inStr && c === '}') depth--;
    else if (!inStr && depth === 0 && c === ',') {
      pairs.push(body.slice(start, i));
      start = i + 1;
    }
  }
  const last = body.slice(start).trim();
  if (last) pairs.push(last);
  return pairs;
}

function parseBibValue(raw) {
  const s = raw.trim();
  if (s.startsWith('{')) {
    let depth = 0, end = -1;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '{') depth++;
      else if (s[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    return end >= 0 ? s.slice(1, end) : s;
  }
  if (s.startsWith('"')) {
    const end = s.lastIndexOf('"');
    return end > 0 ? s.slice(1, end) : s;
  }
  return s;
}

// 1エントリのみをパースする。先頭の @type{ から対応する閉じ波括弧までを見て、
// それ以降に残ったテキストは tail として返す（複数エントリ貼り付けの検出用）。
function parseBibEntry(text) {
  const s = text.trim();
  const head = /^@([a-zA-Z]+)\s*\{/.exec(s);
  if (!head) return null;
  const openIdx = head[0].length - 1;
  let depth = 0, endIdx = -1;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) { endIdx = i; break; } }
  }
  if (endIdx < 0) return null;
  const inner = s.slice(openIdx + 1, endIdx);
  const commaIdx = inner.indexOf(',');
  if (commaIdx < 0) return null;
  const citeKey = inner.slice(0, commaIdx).trim();
  if (!citeKey) return null;
  const fields = {};
  for (const pair of splitBibFields(inner.slice(commaIdx + 1))) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const key = pair.slice(0, eq).trim().toLowerCase();
    if (!key) continue;
    fields[key] = parseBibValue(pair.slice(eq + 1)).trim();
  }
  return { entry_type: head[1].toLowerCase(), cite_key: citeKey, fields, tail: s.slice(endIdx + 1) };
}

// ─── Title Case ────────────────────────────────────────────────────────────────

const TITLECASE_MINOR = new Set([
  'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'as', 'at', 'by', 'for', 'from',
  'in', 'into', 'near', 'of', 'on', 'onto', 'per', 'to', 'with', 'up', 'via', 'vs',
]);

function capitalizeWord(w) {
  return w.split('-').map(part =>
    part.length ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : part
  ).join('-');
}

// 単語ごとに先頭を大文字化する（冠詞・短い前置詞・等位接続詞は先頭/末尾以外なら小文字のまま）。
// {...} で囲まれた区間（BibTeXの大文字小文字保護）は中身に触れずそのまま残す。
// protectInitials=true の場合、1文字語（人名のミドルネーム等のイニシャル）は冠詞 'a' 等との
// 衝突による誤った小文字化の対象にしない（author フィールド向け）。
function toTitleCase(title, protectInitials) {
  if (!title) return title;
  const parts = title.split(/(\{[^{}]*\})/g);
  const wordRe = /[A-Za-z][A-Za-z'’]*/g;
  let totalWords = 0;
  for (const part of parts) {
    if (part.startsWith('{')) continue;
    totalWords += (part.match(wordRe) || []).length;
  }
  let seen = 0;
  return parts.map(part => {
    if (part.startsWith('{')) return part;
    return part.replace(wordRe, (w) => {
      seen++;
      const lower = w.toLowerCase();
      if (protectInitials && w.length === 1) return capitalizeWord(w);
      if (seen !== 1 && seen !== totalWords && TITLECASE_MINOR.has(lower)) return lower;
      return capitalizeWord(w);
    });
  }).join('');
}

// Crossref由来のtitle等には、XML由来の実体参照（&amp; 等）がデコードされないまま
// 残っていることがある。デコードしないと "M&amp;A" の "&" が単語境界として扱われ、
// "amp" が独立した単語として大文字化されて "M&Amp;A" のように壊れる。
const HTML_ENTITY_RE = /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g;
const HTML_NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeHtmlEntitiesOnce(s) {
  return s.replace(HTML_ENTITY_RE, (m, ent) => {
    if (ent[0] === '#') {
      const code = (ent[1] === 'x' || ent[1] === 'X')
        ? parseInt(ent.slice(2), 16)
        : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return HTML_NAMED_ENTITIES[ent] ?? m;
  });
}

// 一部の古いCrossrefレコード（例: 1940年代のTAR誌）は "&amp;amp;" のように二重エスケープ
// されているため、変化がなくなるまで繰り返しデコードする。
function decodeHtmlEntities(s, maxPasses = 5) {
  if (!s) return s;
  for (let i = 0; i < maxPasses; i++) {
    const next = decodeHtmlEntitiesOnce(s);
    if (next === s) break;
    s = next;
  }
  return s;
}

// Crossref由来のtitle等に混入するJATS系タグを処理してからタイトルケース化する。
// <scp>ACRONYM</scp> は大文字を維持すべき頭字語のマーカーなので {ACRONYM}（toTitleCaseの
// 大文字保護記法）に変換する。<i>/<sup>/<sub>/<b> 等の純粋な装飾タグは、除去時に単語が
// 連結しないよう空白に置換して除去する。
const SCP_TAG_RE = /<scp>([\s\S]*?)<\/scp>/gi;
const DECOR_TAG_RE = /<[^>]+>/g;

// "M&A"・"AT&T"・"R&D" のような、"&" で直接連結された略語は元の大文字小文字のまま保護する。
// 保護しないと "M&A" の "A" が単語境界（"&"）で独立した1単語とみなされ、冠詞 "a" と
// 衝突して誤って小文字化されてしまう（"M&a"）。既に {...} で保護済みの区間（<scp>由来など）
// は toTitleCase と同じ分割ロジックで除外し、二重に括弧を被せないようにする。
const AMP_ABBR_RE = /\b[A-Za-z]+&[A-Za-z]+\b/g;

function protectAmpAbbreviations(s) {
  return s.split(/(\{[^{}]*\})/g).map(part =>
    part.startsWith('{') ? part : part.replace(AMP_ABBR_RE, (m) => '{' + m + '}')
  ).join('');
}

// LaTeX上 "&" は表組みの列区切りに使う予約文字のため、実際にBibTeX/LaTeXでタイプセット
// する前提でここでエスケープしてDBに格納する（表示・エクスポートのどちらでもそのまま
// 使える値にする）。既に "\&" とエスケープ済みの箇所（手入力等）は二重エスケープしない
// よう対象外にする。
const UNESCAPED_AMP_RE = /(?<!\\)&/g;

function escapeAmpersand(s) {
  return s.replace(UNESCAPED_AMP_RE, '\\&');
}

function cleanAndTitleCase(raw, protectInitials) {
  if (!raw) return raw;
  let s = decodeHtmlEntities(raw);
  s = s.replace(SCP_TAG_RE, (_, inner) => '{' + inner + '}');
  s = protectAmpAbbreviations(s);
  s = escapeAmpersand(s);
  s = s.replace(DECOR_TAG_RE, ' ').replace(/\s+/g, ' ').trim();
  return toTitleCase(s, protectInitials);
}

// ─── citekey 生成 ────────────────────────────────────────────────────────────────
// 形式: {姓1}_{姓2}_..._{姓N}_{年}_{タイトル要約語}
// 5名以上の共著は「第一著者_EtAl」に短縮。yomi があれば著者部分としてそれを優先使用
// （bibweb の yomi はひらがな。無ければ author の生の文字＝漢字等をそのまま使う）。

function authorSurname(name) {
  const n = stripTex(name).trim();
  if (!n) return '';
  if (n.includes(',')) return n.split(',')[0].trim();
  const parts = n.split(/\s+/);
  return parts[parts.length - 1];
}

function citekeyAuthorSegment(fields) {
  const yomi = (fields.yomi || '').trim();
  if (yomi) return yomi.replace(/\s+/g, '');
  const authorField = fields.author || '';
  const authors = stripTex(authorField).split(/\s+and\s+/i).map(a => a.trim()).filter(Boolean);
  if (!authors.length) return 'anon';
  const surnames = authors.map(authorSurname).filter(Boolean);
  if (!surnames.length) return 'anon';
  const cleaned = surnames.map(s => CJK_RE.test(s) ? s : foldAscii(s)).filter(Boolean);
  if (!cleaned.length) return 'anon';
  if (cleaned.length > 4) return cleaned[0] + '_EtAl';
  return cleaned.join('_');
}

function citekeyTitleWord(titleField) {
  const raw = stripTex(titleField);
  if (CJK_RE.test(raw)) {
    return raw.replace(/[^぀-ヿ㐀-鿿･-ﾟA-Za-z0-9]+/g, '').slice(0, 8);
  }
  const words = raw.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (const w of words) {
    if (w.length < 2) continue;
    if (/^\d+$/.test(w)) continue;
    if (CITEKEY_STOPWORDS.has(w)) continue;
    return foldAscii(w);
  }
  return words.length ? foldAscii(words[0]) : '';
}

function makeCitekey(fields, existingKeys) {
  const author = citekeyAuthorSegment(fields);
  const yearRaw = stripTex(fields.year || '');
  const year = (/\d{4}/.exec(yearRaw) || ['nd'])[0];
  const word = citekeyTitleWord(fields.title || '');
  const base = [author, year, word].filter(Boolean).join('_');
  if (!existingKeys.has(base)) return base;
  for (const c of 'abcdefghijklmnopqrstuvwxyz') {
    const candidate = base + '_' + c;
    if (!existingKeys.has(candidate)) return candidate;
  }
  return base + '_dup';
}

// ─── 類似エントリ検出 ─────────────────────────────────────────────────────────────
// bibdb の `dedup`（DOI完全一致 or 正規化タイトルの SequenceMatcher 類似度）と同じ基準を採用。
// 著者名・年度は表記揺れに弱いためスコアには使わず、候補の付随情報としてのみ表示する。

function findLongestMatch(a, b, aLo, aHi, bLo, bHi) {
  let bestI = aLo, bestJ = bLo, bestSize = 0;
  let j2len = new Map();
  for (let i = aLo; i < aHi; i++) {
    const newJ2len = new Map();
    for (let j = bLo; j < bHi; j++) {
      if (a[i] === b[j]) {
        const k = (j2len.get(j - 1) || 0) + 1;
        newJ2len.set(j, k);
        if (k > bestSize) {
          bestI = i - k + 1;
          bestJ = j - k + 1;
          bestSize = k;
        }
      }
    }
    j2len = newJ2len;
  }
  return [bestI, bestJ, bestSize];
}

function collectMatchingBlocks(a, b, aLo, aHi, bLo, bHi, out) {
  const [i, j, k] = findLongestMatch(a, b, aLo, aHi, bLo, bHi);
  if (k === 0) return;
  if (aLo < i && bLo < j) collectMatchingBlocks(a, b, aLo, i, bLo, j, out);
  out.push(k);
  if (i + k < aHi && j + k < bHi) collectMatchingBlocks(a, b, i + k, aHi, j + k, bHi, out);
}

// Python の difflib.SequenceMatcher(None, a, b).ratio() と同じ定義（autojunk判定は省略）
function sequenceRatio(a, b) {
  if (!a.length && !b.length) return 1;
  const blocks = [];
  collectMatchingBlocks(a, b, 0, a.length, 0, b.length, blocks);
  const matches = blocks.reduce((sum, k) => sum + k, 0);
  return (2 * matches) / (a.length + b.length);
}

function normalizeForSimilarity(text) {
  return (text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function normalizeDoi(doi) {
  const t = trimDoi(doi || '');
  return t ? t.toLowerCase() : '';
}

const SIMILARITY_THRESHOLD = 0.9; // bibdb dedup の既定閾値と揃える

function findSimilarEntries(fields, existingEntries) {
  const doi = normalizeDoi(fields.doi);
  const normTitle = normalizeForSimilarity(fields.title || '');
  const candidates = [];
  for (const e of existingEntries) {
    const eDoi = normalizeDoi(e.doi);
    if (doi && eDoi && doi === eDoi) {
      candidates.push({ entry: e, reason: 'DOI一致', score: 1 });
      continue;
    }
    if (normTitle && e.title) {
      const sim = sequenceRatio(normTitle, normalizeForSimilarity(e.title));
      if (sim >= SIMILARITY_THRESHOLD) {
        candidates.push({ entry: e, reason: `タイトル類似度 ${sim.toFixed(2)}`, score: sim });
      }
    }
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, 5);
}

// ─── DOI / Crossref ─────────────────────────────────────────────────────────────

function trimDoi(d) {
  return (d || '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/[.,;:)\]'"]+$/, '').trim();
}

async function fetchCrossrefBibtex(doiOrUrl) {
  const doi = trimDoi(doiOrUrl);
  if (!doi) throw new Error('DOI が空です');
  const url = 'https://api.crossref.org/works/' + encodeURIComponent(doi) + '/transform/application/x-bibtex';
  const r = await fetch(url);
  if (!r.ok) throw new Error('Crossref HTTP ' + r.status + (r.status === 404 ? '（DOI が見つかりません）' : ''));
  return (await r.text()).trim();
}

// ─── Fuzzy search (fzf-style) ────────────────────────────────────────────────

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fuzzyMatch(pattern, str) {
  const lower = str.toLowerCase();
  const pat   = pattern.toLowerCase();
  const positions = [];
  let pi = 0, score = 0, consecutive = 0, lastSi = -1;

  for (let si = 0; si < lower.length && pi < pat.length; si++) {
    if (lower[si] === pat[pi]) {
      consecutive = (lastSi === si - 1) ? consecutive + 1 : 1;
      const wordStart = si === 0 || /[\s\-_\/\.]/.test(lower[si - 1]);
      score += consecutive * 2 + (wordStart ? 8 : 1);
      positions.push(si);
      lastSi = si;
      pi++;
    }
  }
  return pi === pat.length ? { score, positions } : null;
}

function highlight(str, positions) {
  const posSet = new Set(positions);
  return [...str].map((ch, i) => {
    const e = escapeHtml(ch);
    return posSet.has(i) ? `<mark>${e}</mark>` : e;
  }).join('');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MD_KEY_LABELS = {
  'md.full':    'フル論文',
  'md.full.ja': 'フル論文（日本語）',
  'md.digest':  'ダイジェスト',
};

// local_extras（DBファイルの置き場所に紐づくローカル限定データ。extrasには入れない）の
// extra_key ごとの表示ラベル。未知の key はそのまま表示する。
const LOCAL_FILE_KEY_LABELS = {
  'pdf_path': 'PDFを開く',
};

function localFileLabel(key) {
  return LOCAL_FILE_KEY_LABELS[key] ?? key;
}

function localFileUrl(citeKey, extraKey) {
  return `/api/entries/${encodeURIComponent(citeKey)}/local-file/${encodeURIComponent(extraKey)}`;
}

function mdKeyLabel(key) {
  return MD_KEY_LABELS[key] ?? key;
}

function fileLabel(url) {
  try {
    const pathname = new URL(url).pathname;
    const last = pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : url;
  } catch {
    return url;
  }
}

function firstAuthor(author) {
  if (!author) return '';
  return author.split(/\s+and\s+/i)[0].trim();
}

function downloadBlob(content, filename, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── App ─────────────────────────────────────────────────────────────────────

const app = createApp({
  components: { MarkdownRenderer },

  setup() {
    // ── State ──────────────────────────────────────────────────────────────
    const entries       = ref([]);
    const selectedEntry = ref(null);
    const searchQuery   = ref('');
    const checkedKeys   = ref(new Set());
    const activeTab     = ref('info');
    const activeMdKey   = ref(null);
    const dbPath        = ref('');

    // Sort mode
    const sortMode      = ref('author');  // 'author' | 'added_at'

    // Scroll position memory
    const digestScrollMap = new Map(); // cite_key → scrollTop
    const digestPanelRef  = ref(null);

    // Tag filter (sidebar)
    const allTags       = ref([]);   // [{name, count}]
    const tagFilterOpen = ref(false);
    const selectedTags  = ref(new Set());

    // Tag editing (Tags tab)
    const newTagInput   = ref('');

    // Bulk tag (sidebar footer)
    const bulkTagInput  = ref('');

    // Fields edit mode
    const fieldsEditMode   = ref(false);

    // Editing: fields
    const editingFieldKey  = ref(null);
    const editingFieldVal  = ref('');
    const showNewField     = ref(false);
    const newFieldKey      = ref('');
    const newFieldVal      = ref('');

    // Editing: extras
    const editingExtraId   = ref(null);
    const editingExtraVal  = ref('');
    const editingExtraNote = ref('');
    const showNewExtra     = ref(false);
    const newExtraKey      = ref('');
    const newExtraVal      = ref('');
    const newExtraNote     = ref('');

    // Info タブ: md.* クイック追加
    const showMdAdd  = ref(false);
    const mdAddKey   = ref('md.digest');
    const mdAddVal   = ref('');
    const mdAddNote  = ref('');
    const mdAddBusy  = ref(false);

    // Info タブ: ファイルリンク追加・備考編集
    const newFileUrl        = ref('');
    const newFileNote       = ref('');
    const editingFileNoteId  = ref(null);
    const editingFileNoteVal = ref('');

    // 図表メモ (Figures タブ)
    const figures             = ref([]);   // 選択中エントリの図表メモ一覧（sort_order順）
    const figureBusy          = ref(false);
    const figuresPanelRef     = ref(null);
    const editingFigureId     = ref(null);
    const editingFigureLabel  = ref('');
    const editingFigureMemo   = ref('');
    const lightboxFigureId    = ref(null);

    // Add entry (新規登録)
    const showAddEntry      = ref(false);
    const addDoiInput       = ref('');
    const addBibText        = ref('');
    const addParsed         = ref(null);   // { entry_type, cite_key, fields: {...} }
    const addBusy           = ref(false);
    const addError          = ref('');
    const addMultiWarn      = ref(false);
    const addCitekeyTouched = ref(false);
    const newAddFieldKey    = ref('');
    const newAddFieldVal    = ref('');

    // ── Computed ───────────────────────────────────────────────────────────

    const searchResults = computed(() => {
      // 1. Tag filter (AND)
      let pool = entries.value;
      if (selectedTags.value.size > 0) {
        pool = pool.filter(e => {
          const etags = new Set(e.tags ?? []);
          return [...selectedTags.value].every(t => etags.has(t));
        });
      }

      // 2. Fuzzy search
      const q = searchQuery.value.trim();
      if (!q) {
        const sorted = sortMode.value === 'added_at'
          ? [...pool].sort((a, b) => (b.added_at || '').localeCompare(a.added_at || ''))
          : pool;  // 'author': サーバー返却順（著者アルファベット順）をそのまま使う
        return sorted.map(e => ({
          entry: e,
          score: 0,
          hl: {
            cite_key: escapeHtml(e.cite_key || ''),
            title:    escapeHtml(e.title    || ''),
            author:   escapeHtml(firstAuthor(e.author || '')),
          },
        }));
      }

      return pool
        .map(e => {
          const km = fuzzyMatch(q, e.cite_key || '');
          const tm = fuzzyMatch(q, e.title    || '');
          const am = fuzzyMatch(q, e.author   || '');
          const ym = fuzzyMatch(q, e.yomi     || '');
          const score =
            (km?.score ?? 0) * 3 +
            (tm?.score ?? 0) * 2 +
            (am?.score ?? 0) +
            (ym?.score ?? 0);
          if (score === 0) return null;

          const fa      = firstAuthor(e.author || '');
          const faMatch = fuzzyMatch(q, fa);
          return {
            entry: e,
            score,
            hl: {
              cite_key: km      ? highlight(e.cite_key || '', km.positions)   : escapeHtml(e.cite_key || ''),
              title:    tm      ? highlight(e.title    || '', tm.positions)    : escapeHtml(e.title    || ''),
              author:   faMatch ? highlight(fa, faMatch.positions)             : escapeHtml(fa),
            },
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score);
    });

    const filteredEntries = computed(() => searchResults.value.map(r => r.entry));

    const mdExtras = computed(() =>
      (selectedEntry.value?.extras ?? []).filter(x => x.extra_key.startsWith('md.'))
    );

    // Extras タブ: tags・md.* を含む全行を表示（編集・削除の手段を残す）
    const otherExtras = computed(() =>
      selectedEntry.value?.extras ?? []
    );

    // Tags タブ用: このエントリのタグ一覧
    const entryTags = computed(() =>
      (selectedEntry.value?.extras ?? [])
        .filter(x => x.extra_key === 'tags')
        .map(x => x.extra_value)
        .sort()
    );

    // datalist 用: まだ付いていないグローバルタグのみ
    const availableTags = computed(() =>
      allTags.value.filter(t => !entryTags.value.includes(t.name))
    );

    const allChecked = computed(() =>
      filteredEntries.value.length > 0 &&
      filteredEntries.value.every(e => checkedKeys.value.has(e.cite_key))
    );

    const digestExtra = computed(() => {
      const extras = selectedEntry.value?.extras ?? [];
      // md.digest を優先し、なければ先頭の md.* にフォールバック
      return extras.find(x => x.extra_key === 'md.digest')
          ?? extras.find(x => x.extra_key.startsWith('md.'))
          ?? null;
    });

    const fileExtras = computed(() =>
      (selectedEntry.value?.extras ?? []).filter(x => x.extra_key === 'file')
    );

    // local_extras: このDBファイルの置き場所に紐づくローカル限定パス（例: pdf_path）。
    // extras とは別テーブルで管理しており、GUIからの追加・編集・削除はサポートしない
    // （設定はスクリプト/直接SQL経由の運用を想定。当面は表示専用）。
    const localFileExtras = computed(() =>
      selectedEntry.value?.local_extras ?? []
    );

    const addCitekeyStatus = computed(() => {
      if (!addParsed.value) return null;
      const key = (addParsed.value.cite_key || '').trim();
      if (!key) return null;
      return entries.value.some(e => e.cite_key === key) ? 'dup' : 'ok';
    });

    const similarEntries = computed(() => {
      if (!addParsed.value) return [];
      return findSimilarEntries(addParsed.value.fields, entries.value);
    });

    // ── Watchers ───────────────────────────────────────────────────────────
    watch(activeTab, (tab) => {
      if (tab === 'markdown' && !activeMdKey.value && mdExtras.value.length > 0) {
        activeMdKey.value = mdExtras.value[0].id;
      }
      if (tab === 'figures') {
        // ペーストゾーンにフォーカスして、タブを開いたらすぐ Ctrl+V できるようにする
        nextTick(() => figuresPanelRef.value?.focus());
      }
    });

    // ── Methods: navigation ────────────────────────────────────────────────
    async function loadEntries() {
      entries.value = await api.getEntries();
    }

    async function loadTags() {
      allTags.value = await api.getTags();
    }

    async function selectEntry(key) {
      if (selectedEntry.value && digestPanelRef.value) {
        digestScrollMap.set(selectedEntry.value.cite_key, digestPanelRef.value.scrollTop);
      }
      selectedEntry.value = await api.getEntry(key);
      activeTab.value = 'info';
      resetEditing();
      cancelFigureEdit();
      if (mdExtras.value.length > 0) {
        activeMdKey.value = mdExtras.value[0].id;
      } else {
        activeMdKey.value = null;
      }
      await loadFigures();
      await nextTick();
      if (digestPanelRef.value) {
        digestPanelRef.value.scrollTop = digestScrollMap.get(key) ?? 0;
      }
    }

    async function refreshEntry() {
      if (!selectedEntry.value) return;
      selectedEntry.value = await api.getEntry(selectedEntry.value.cite_key);
      const idx = entries.value.findIndex(e => e.cite_key === selectedEntry.value.cite_key);
      if (idx >= 0) entries.value = await api.getEntries();
    }

    function resetEditing() {
      fieldsEditMode.value   = false;
      editingFieldKey.value  = null;
      editingFieldVal.value  = '';
      showNewField.value     = false;
      newFieldKey.value      = '';
      newFieldVal.value      = '';
      editingExtraId.value   = null;
      editingExtraVal.value  = '';
      editingExtraNote.value = '';
      showNewExtra.value     = false;
      newExtraKey.value      = '';
      newExtraVal.value      = '';
      newExtraNote.value     = '';
      showMdAdd.value        = false;
      mdAddKey.value         = 'md.digest';
      mdAddVal.value         = '';
      mdAddNote.value        = '';
      newFileUrl.value       = '';
      newFileNote.value      = '';
      editingFileNoteId.value  = null;
      editingFileNoteVal.value = '';
    }

    function toggleFieldsEditMode() {
      fieldsEditMode.value = !fieldsEditMode.value;
      if (!fieldsEditMode.value) {
        cancelEditField();
        showNewField.value = false;
        newFieldKey.value  = '';
        newFieldVal.value  = '';
      }
    }

    // ── Methods: tag filter ────────────────────────────────────────────────
    function toggleTagFilter(tagName) {
      const s = new Set(selectedTags.value);
      s.has(tagName) ? s.delete(tagName) : s.add(tagName);
      selectedTags.value = s;
    }

    function clearTagFilter() {
      selectedTags.value = new Set();
    }

    // ── Methods: tag CRUD ──────────────────────────────────────────────────
    async function addTag() {
      const name = newTagInput.value.trim();
      if (!name) return;
      const r = await api.addTag(selectedEntry.value.cite_key, name);
      const result = await r.json();
      if (result.error) { alert(result.error); return; }
      newTagInput.value = '';
      await refreshEntry();
      await loadTags();
    }

    async function removeTag(tagName) {
      await api.deleteTag(selectedEntry.value.cite_key, tagName);
      await refreshEntry();
      await loadTags();
    }

    async function bulkAddTag() {
      const name = bulkTagInput.value.trim();
      const keys = [...checkedKeys.value];
      if (!name || !keys.length) return;
      const r = await api.bulkAddTag(keys, name);
      const result = await r.json();
      if (result.error) { alert(result.error); return; }
      bulkTagInput.value = '';
      await loadEntries();
      await loadTags();
      if (selectedEntry.value && checkedKeys.value.has(selectedEntry.value.cite_key)) {
        selectedEntry.value = await api.getEntry(selectedEntry.value.cite_key);
      }
    }

    // ── Methods: checkboxes & export ───────────────────────────────────────
    function toggleCheck(key, event) {
      event.stopPropagation();
      const s = new Set(checkedKeys.value);
      s.has(key) ? s.delete(key) : s.add(key);
      checkedKeys.value = s;
    }

    function toggleAll() {
      if (allChecked.value) {
        checkedKeys.value = new Set();
      } else {
        checkedKeys.value = new Set(filteredEntries.value.map(e => e.cite_key));
      }
    }

    async function exportSelected() {
      const keys = [...checkedKeys.value];
      if (!keys.length) { alert('エントリを選択してください'); return; }
      const bib = await api.exportBib(keys);
      downloadBlob(bib, 'export.bib');
    }

    async function exportSelectedDb() {
      const keys = [...checkedKeys.value];
      if (!keys.length) { alert('エントリを選択してください'); return; }
      const blob = await api.exportDb(keys);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'export.db';
      a.click();
      URL.revokeObjectURL(url);
    }

    // ── Methods: field CRUD ────────────────────────────────────────────────
    function startEditField(field) {
      editingFieldKey.value = field.field_key;
      editingFieldVal.value = field.field_value;
    }

    function cancelEditField() {
      editingFieldKey.value = null;
      editingFieldVal.value = '';
    }

    async function saveField() {
      await api.updateField(
        selectedEntry.value.cite_key,
        editingFieldKey.value,
        editingFieldVal.value
      );
      cancelEditField();
      await refreshEntry();
    }

    async function deleteField(fieldKey) {
      if (!confirm(`フィールド "${fieldKey}" を削除しますか？`)) return;
      await api.deleteField(selectedEntry.value.cite_key, fieldKey);
      await refreshEntry();
    }

    async function addField() {
      const key = newFieldKey.value.trim();
      if (!key) return;
      const result = await api.addField(selectedEntry.value.cite_key, key, newFieldVal.value);
      if (result.error) { alert(result.error); return; }
      newFieldKey.value  = '';
      newFieldVal.value  = '';
      showNewField.value = false;
      await refreshEntry();
    }

    // ── Methods: extra CRUD ────────────────────────────────────────────────
    function startEditExtra(extra) {
      editingExtraId.value   = extra.id;
      editingExtraVal.value  = extra.extra_value;
      editingExtraNote.value = extra.note || '';
    }

    function cancelEditExtra() {
      editingExtraId.value   = null;
      editingExtraVal.value  = '';
      editingExtraNote.value = '';
    }

    async function saveExtra() {
      await api.updateExtra(editingExtraId.value, editingExtraVal.value, editingExtraNote.value.trim() || null);
      cancelEditExtra();
      await refreshEntry();
    }

    async function deleteExtra(id, key) {
      if (!confirm(`"${key}" を削除しますか？`)) return;
      await api.deleteExtra(id);
      const deleted = mdExtras.value.find(x => x.id === id);
      if (deleted && activeMdKey.value === deleted.id) {
        activeMdKey.value = null;
      }
      await refreshEntry();
    }

    async function addExtra() {
      const key = newExtraKey.value.trim();
      if (!key) return;
      await api.addExtra(selectedEntry.value.cite_key, key, newExtraVal.value, newExtraNote.value.trim() || null);
      newExtraKey.value  = '';
      newExtraVal.value  = '';
      newExtraNote.value = '';
      showNewExtra.value = false;
      await refreshEntry();
    }

    // ── Methods: Info タブ md.* クイック追加 ───────────────────────────────
    // md.* は「同じ key は1つだけ」という運用を前提にしたUIなので、既存行が
    // あれば常に上書き（update）する。tags/file のように複数値を持たせたい
    // 場合は Extras タブから直接編集する。
    function existingMdExtra(key) {
      return (selectedEntry.value?.extras ?? []).find(x => x.extra_key === key);
    }

    function startMdAdd() {
      showMdAdd.value = true;
      mdAddKey.value   = 'md.digest';
      mdAddVal.value   = '';
      mdAddNote.value  = '';
    }

    function cancelMdAdd() {
      showMdAdd.value = false;
      mdAddKey.value   = 'md.digest';
      mdAddVal.value   = '';
      mdAddNote.value  = '';
    }

    function readTextFile(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsText(file);
      });
    }

    async function handleMdFileInput(event) {
      const file = event.target.files?.[0];
      event.target.value = '';  // 同じファイルを選び直せるようにする
      if (!file) return;
      mdAddVal.value = await readTextFile(file);
    }

    async function saveMdExtra() {
      const key = mdAddKey.value.trim();
      if (!key.startsWith('md.')) {
        alert('extra_key は "md." で始まる必要があります（例: md.digest）。');
        return;
      }
      if (!mdAddVal.value) return;
      mdAddBusy.value = true;
      try {
        const note = mdAddNote.value.trim() || null;
        const existing = existingMdExtra(key);
        if (existing) {
          await api.updateExtra(existing.id, mdAddVal.value, note);
        } else {
          await api.addExtra(selectedEntry.value.cite_key, key, mdAddVal.value, note);
        }
        cancelMdAdd();
        await refreshEntry();
      } finally {
        mdAddBusy.value = false;
      }
    }

    // ── Methods: Info タブ ファイルリンク追加/削除 ─────────────────────────
    // file は md.* と逆に「複数値を持たせたい」キーなので、常に追加のみ行う
    // （既存リンクの書き換えは Extras タブから行う）。
    async function addFileLink() {
      const url = newFileUrl.value.trim();
      if (!url) return;
      if (!/^https?:\/\//i.test(url)) {
        alert('ファイルリンクは http:// または https:// で始まる URL を指定してください。');
        return;
      }
      await api.addExtra(selectedEntry.value.cite_key, 'file', url, newFileNote.value.trim() || null);
      newFileUrl.value  = '';
      newFileNote.value = '';
      await refreshEntry();
    }

    async function removeFileLink(id) {
      if (!confirm('このファイルリンクを削除しますか？')) return;
      await api.deleteExtra(id);
      await refreshEntry();
    }

    function startEditFileNote(x) {
      editingFileNoteId.value  = x.id;
      editingFileNoteVal.value = x.note || '';
    }

    function cancelEditFileNote() {
      editingFileNoteId.value  = null;
      editingFileNoteVal.value = '';
    }

    async function saveFileNote(x) {
      await api.updateExtra(x.id, x.extra_value, editingFileNoteVal.value.trim() || null);
      cancelEditFileNote();
      await refreshEntry();
    }

    // ── Methods: 図表メモ (Figures タブ) ───────────────────────────────────
    function figureImageUrl(id) {
      return `/api/figures/${id}/image`;
    }

    async function loadFigures() {
      figures.value = selectedEntry.value
        ? await api.getFigures(selectedEntry.value.cite_key)
        : [];
    }

    function blobToBase64(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }

    async function uploadFigureBlob(blob) {
      if (!selectedEntry.value || !blob) return;
      figureBusy.value = true;
      try {
        const image_base64 = await blobToBase64(blob);
        await api.addFigure(selectedEntry.value.cite_key, {
          label: '', memo: '',
          image_base64,
          image_mime: blob.type || 'application/octet-stream',
        });
        await loadFigures();
      } finally {
        figureBusy.value = false;
      }
    }

    function handleFigurePaste(event) {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type && item.type.startsWith('image/')) {
          event.preventDefault();
          uploadFigureBlob(item.getAsFile());
          return;
        }
      }
    }

    function handleFigureDrop(event) {
      const file = event.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('image/')) uploadFigureBlob(file);
    }

    function handleFigureFileInput(event) {
      const file = event.target.files?.[0];
      if (file) uploadFigureBlob(file);
      event.target.value = '';
    }

    function startEditFigure(fig) {
      editingFigureId.value    = fig.id;
      editingFigureLabel.value = fig.label || '';
      editingFigureMemo.value  = fig.memo || '';
    }

    function cancelFigureEdit() {
      editingFigureId.value    = null;
      editingFigureLabel.value = '';
      editingFigureMemo.value  = '';
    }

    async function saveFigureEdit() {
      await api.updateFigure(editingFigureId.value, editingFigureLabel.value, editingFigureMemo.value);
      cancelFigureEdit();
      await loadFigures();
    }

    async function deleteFigureNote(id) {
      if (!confirm('この図表メモを削除しますか？')) return;
      await api.deleteFigure(id);
      if (lightboxFigureId.value === id) lightboxFigureId.value = null;
      await loadFigures();
    }

    async function moveFigure(idx, dir) {
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= figures.value.length) return;
      const arr = [...figures.value];
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      figures.value = arr;
      await api.reorderFigures(selectedEntry.value.cite_key, arr.map(f => f.id));
    }

    function openFigureLightbox(id) {
      lightboxFigureId.value = id;
    }

    function closeFigureLightbox() {
      lightboxFigureId.value = null;
    }

    // ── Methods: add entry (新規登録) ──────────────────────────────────────
    function existingKeySet() {
      return new Set(entries.value.map(e => e.cite_key));
    }

    function openAddEntry() {
      showAddEntry.value = true;
      addDoiInput.value = '';
      addBibText.value = '';
      addParsed.value = null;
      addBusy.value = false;
      addError.value = '';
      addMultiWarn.value = false;
      addCitekeyTouched.value = false;
      newAddFieldKey.value = '';
      newAddFieldVal.value = '';
    }

    function closeAddEntry() {
      showAddEntry.value = false;
    }

    function parseAddBibText() {
      addError.value = '';
      addMultiWarn.value = false;
      const text = addBibText.value;
      if (!text.trim()) { addParsed.value = null; return; }
      const parsed = parseBibEntry(text);
      if (!parsed) {
        addError.value = 'BibTeX として解釈できませんでした（@type{key, ... } の形式で貼り付けてください）';
        addParsed.value = null;
        return;
      }
      if (parsed.tail && parsed.tail.trim()) {
        addMultiWarn.value = true;
      }
      const fields = { ...parsed.fields };
      if (fields.title) fields.title = cleanAndTitleCase(fields.title);
      if (fields.author) fields.author = cleanAndTitleCase(fields.author, true);
      if (fields.journal) fields.journal = cleanAndTitleCase(fields.journal);
      const citeKey = (addCitekeyTouched.value && addParsed.value)
        ? addParsed.value.cite_key
        : makeCitekey(fields, existingKeySet());
      addParsed.value = { entry_type: parsed.entry_type || 'misc', cite_key: citeKey, fields };
    }

    async function fetchDoiIntoBib() {
      const doi = addDoiInput.value.trim();
      if (!doi) return;
      addBusy.value = true;
      addError.value = '';
      try {
        addBibText.value = await fetchCrossrefBibtex(doi);
        parseAddBibText();
      } catch (e) {
        addError.value = e.message;
      } finally {
        addBusy.value = false;
      }
    }

    function regenAddCitekey() {
      if (!addParsed.value) return;
      addParsed.value.cite_key = makeCitekey(addParsed.value.fields, existingKeySet());
      addCitekeyTouched.value = false;
    }

    function removeAddField(key) {
      if (!addParsed.value) return;
      delete addParsed.value.fields[key];
    }

    function addAddField() {
      const key = newAddFieldKey.value.trim().toLowerCase();
      if (!key || !addParsed.value) return;
      addParsed.value.fields[key] = newAddFieldVal.value;
      newAddFieldKey.value = '';
      newAddFieldVal.value = '';
    }

    async function submitAddEntry() {
      if (!addParsed.value) return;
      const citeKey = (addParsed.value.cite_key || '').trim();
      if (!citeKey) { addError.value = 'citekey を入力してください'; return; }
      addBusy.value = true;
      addError.value = '';
      const { status, body } = await api.createEntry(citeKey, addParsed.value.entry_type || 'misc', addParsed.value.fields);
      addBusy.value = false;
      if (status >= 300 || body.error) {
        addError.value = body.error || `登録に失敗しました (HTTP ${status})`;
        return;
      }
      showAddEntry.value = false;
      await loadEntries();
      await selectEntry(citeKey);
    }

    // ── Init ───────────────────────────────────────────────────────────────
    onMounted(async () => {
      const db = await api.getDb();
      dbPath.value = db.path;
      await loadEntries();
      await loadTags();
    });

    return {
      // state
      entries, selectedEntry, searchQuery, checkedKeys,
      activeTab, activeMdKey, dbPath,
      sortMode,
      allTags, tagFilterOpen, selectedTags, newTagInput, bulkTagInput,
      editingFieldKey, editingFieldVal, showNewField, newFieldKey, newFieldVal,
      editingExtraId, editingExtraVal, editingExtraNote, showNewExtra, newExtraKey, newExtraVal, newExtraNote,
      showMdAdd, mdAddKey, mdAddVal, mdAddNote, mdAddBusy,
      newFileUrl, newFileNote, editingFileNoteId, editingFileNoteVal,
      showAddEntry, addDoiInput, addBibText, addParsed, addBusy, addError,
      addMultiWarn, addCitekeyTouched, newAddFieldKey, newAddFieldVal,
      figures, figureBusy, editingFigureId, editingFigureLabel, editingFigureMemo,
      lightboxFigureId,
      // computed
      searchResults, filteredEntries, mdExtras, otherExtras, allChecked, digestExtra,
      fileExtras, localFileExtras, addCitekeyStatus, similarEntries,
      entryTags, availableTags,
      // methods
      selectEntry, toggleCheck, toggleAll, exportSelected,
      toggleFieldsEditMode, fieldsEditMode,
      startEditField, cancelEditField, saveField, deleteField, addField,
      startEditExtra, cancelEditExtra, saveExtra, deleteExtra, addExtra,
      existingMdExtra, startMdAdd, cancelMdAdd, handleMdFileInput, saveMdExtra,
      addFileLink, removeFileLink, startEditFileNote, cancelEditFileNote, saveFileNote,
      exportSelectedDb,
      toggleTagFilter, clearTagFilter, addTag, removeTag, bulkAddTag,
      openAddEntry, closeAddEntry, parseAddBibText, fetchDoiIntoBib,
      regenAddCitekey, removeAddField, addAddField, submitAddEntry,
      figureImageUrl, handleFigurePaste, handleFigureDrop, handleFigureFileInput,
      startEditFigure, cancelFigureEdit, saveFigureEdit, deleteFigureNote, moveFigure,
      openFigureLightbox, closeFigureLightbox,
      // helpers exposed to template
      mdKeyLabel, fileLabel, localFileLabel, localFileUrl, firstAuthor, MD_KEY_LABELS,
      // scroll memory refs
      digestPanelRef, figuresPanelRef,
    };
  },

  template: `
<div class="app">

  <!-- Header -->
  <header class="header">
    <div class="header-left">
      <span class="header-title">bibweb</span>
      <button class="btn-add-entry" @click="openAddEntry">＋ 新規登録</button>
    </div>
    <span class="header-db" :title="dbPath">{{ dbPath }}</span>
  </header>

  <div class="main">

    <!-- ── Sidebar ── -->
    <aside class="sidebar">
      <div class="sidebar-top">
        <input v-model="searchQuery" type="search" placeholder="検索 (CiteKey / タイトル / 著者)"
               class="search-input">

        <!-- Tag filter accordion -->
        <div v-if="allTags.length > 0" class="tag-filter">
          <button class="tag-filter-header" @click="tagFilterOpen = !tagFilterOpen">
            <span class="tag-filter-label">
              タグ
              <span v-if="selectedTags.size > 0" class="tag-active-count">{{ selectedTags.size }}</span>
            </span>
            <span class="tag-filter-actions">
              <span v-if="selectedTags.size > 0" class="tag-clear-btn"
                    @click.stop="clearTagFilter()" title="フィルタ解除">✕</span>
              <span class="tag-filter-chevron" :class="{ open: tagFilterOpen }">›</span>
            </span>
          </button>
          <div v-show="tagFilterOpen" class="tag-filter-body">
            <label v-for="t in allTags" :key="t.name" class="tag-filter-item">
              <input type="checkbox"
                     :checked="selectedTags.has(t.name)"
                     @change="toggleTagFilter(t.name)">
              <span class="tag-filter-name">{{ t.name }}</span>
              <span class="tag-filter-count">{{ t.count }}</span>
            </label>
          </div>
        </div>

        <div class="sort-selector">
          <span class="sort-selector-label">並び順</span>
          <label class="sort-option" :class="{ active: sortMode === 'author' }">
            <input type="radio" v-model="sortMode" value="author">著者順
          </label>
          <label class="sort-option" :class="{ active: sortMode === 'added_at' }">
            <input type="radio" v-model="sortMode" value="added_at">追加順
          </label>
        </div>

        <div class="sidebar-toolbar">
          <label class="check-all-label">
            <input type="checkbox" :checked="allChecked" @change="toggleAll">
            全選択
          </label>
          <button v-if="checkedKeys.size > 0" @click="checkedKeys = new Set()"
                  class="deselect-btn">選択解除</button>
          <span class="entry-count">{{ filteredEntries.length }} 件</span>
        </div>
      </div>

      <ul class="entry-list">
        <li v-for="r in searchResults" :key="r.entry.cite_key"
            class="entry-item"
            :class="{ selected: selectedEntry && selectedEntry.cite_key === r.entry.cite_key }"
            @click="selectEntry(r.entry.cite_key)">
          <input type="checkbox" class="entry-check"
                 :checked="checkedKeys.has(r.entry.cite_key)"
                 @click="toggleCheck(r.entry.cite_key, $event)">
          <div class="entry-info">
            <div class="entry-key">
              <span v-html="r.hl.cite_key"></span>
              <span class="entry-type-pill">{{ r.entry.entry_type }}</span>
            </div>
            <div class="entry-title" v-html="r.hl.title || '(no title)'"></div>
            <div class="entry-meta">
              <span v-html="r.hl.author"></span>
              <template v-if="r.entry.year"> · {{ r.entry.year }}</template>
            </div>
            <div class="entry-tags" v-if="r.entry.tags && r.entry.tags.length > 0">
              <span v-for="tag in r.entry.tags" :key="tag"
                    class="entry-tag-pill"
                    @click.stop="toggleTagFilter(tag)">{{ tag }}</span>
            </div>
          </div>
        </li>
        <li v-if="searchResults.length === 0" class="entry-empty">
          一致するエントリがありません
        </li>
      </ul>

      <div class="sidebar-footer">
        <div class="export-row">
          <button @click="exportSelected" class="btn btn-export"
                  :disabled="checkedKeys.size === 0">
            .bib
            <span v-if="checkedKeys.size > 0" class="export-count">({{ checkedKeys.size }})</span>
          </button>
          <button @click="exportSelectedDb" class="btn btn-export"
                  :disabled="checkedKeys.size === 0">
            .db
            <span v-if="checkedKeys.size > 0" class="export-count">({{ checkedKeys.size }})</span>
          </button>
        </div>
        <div v-if="checkedKeys.size > 0" class="bulk-tag-row">
          <input v-model="bulkTagInput"
                 list="bulk-tag-datalist"
                 placeholder="タグを一括追加..."
                 class="bulk-tag-input"
                 @keydown.enter.prevent="bulkAddTag">
          <datalist id="bulk-tag-datalist">
            <option v-for="t in allTags" :key="t.name" :value="t.name"></option>
          </datalist>
          <button @click="bulkAddTag" class="btn btn-save"
                  :disabled="!bulkTagInput.trim()">追加</button>
        </div>
      </div>
    </aside>

    <!-- ── Detail ── -->
    <main class="detail" v-if="selectedEntry">

      <div class="detail-header">
        <h1 class="detail-key">{{ selectedEntry.cite_key }}</h1>
        <span class="detail-type-badge">{{ selectedEntry.entry_type }}</span>
      </div>

      <!-- Tab bar -->
      <nav class="tab-bar">
        <button class="tab-btn" :class="{ active: activeTab === 'info' }"
                @click="activeTab = 'info'">
          Info
          <span class="tab-count">{{ selectedEntry.fields.length }}</span>
        </button>
        <button class="tab-btn" :class="{ active: activeTab === 'figures' }"
                @click="activeTab = 'figures'">
          Exhibits
          <span class="tab-count">{{ figures.length }}</span>
        </button>
        <button class="tab-btn" :class="{ active: activeTab === 'markdown' }"
                @click="activeTab = 'markdown'"
                v-if="mdExtras.length > 0">
          Markdown
          <span class="tab-count">{{ mdExtras.length }}</span>
        </button>
        <button class="tab-btn" :class="{ active: activeTab === 'extras' }"
                @click="activeTab = 'extras'">
          Extras
          <span class="tab-count">{{ otherExtras.length }}</span>
        </button>
      </nav>

      <!-- ── Info tab ── -->
      <div v-show="activeTab === 'info'" class="tab-content"
           :class="{ 'tab-content-split': digestExtra }">

        <div class="fields-panel">
          <div class="fields-toolbar">
            <button @click="toggleFieldsEditMode" class="btn-edit-mode"
                    :class="{ active: fieldsEditMode }">
              {{ fieldsEditMode ? '編集モード終了' : '編集' }}
            </button>
          </div>

          <table class="kv-table">
            <tbody>
              <tr v-for="f in selectedEntry.fields" :key="f.field_key">
                <td class="kv-key">{{ f.field_key }}</td>
                <td class="kv-value">
                  <template v-if="editingFieldKey === f.field_key">
                    <textarea v-model="editingFieldVal" class="edit-textarea" rows="3"
                              @keydown.ctrl.enter="saveField" @keydown.meta.enter="saveField"></textarea>
                    <div class="edit-actions">
                      <button @click="saveField" class="btn btn-save">保存</button>
                      <button @click="cancelEditField" class="btn btn-cancel">キャンセル</button>
                    </div>
                  </template>
                  <template v-else>
                    <span class="kv-text">{{ f.field_value }}</span>
                    <div class="row-actions" v-if="fieldsEditMode">
                      <button @click="startEditField(f)" class="icon-btn" title="編集">✏️</button>
                      <button @click="deleteField(f.field_key)" class="icon-btn" title="削除">🗑️</button>
                    </div>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>

          <template v-if="fieldsEditMode">
            <div v-if="showNewField" class="add-form">
              <input v-model="newFieldKey" placeholder="field_key" class="add-key-input"
                     @keydown.enter.prevent="addField">
              <textarea v-model="newFieldVal" placeholder="値" class="add-value-input" rows="2"
                        @keydown.ctrl.enter="addField" @keydown.meta.enter="addField"></textarea>
              <div class="edit-actions">
                <button @click="addField" class="btn btn-save">追加</button>
                <button @click="showNewField = false; newFieldKey = ''; newFieldVal = ''"
                        class="btn btn-cancel">キャンセル</button>
              </div>
            </div>
            <button v-else @click="showNewField = true" class="btn btn-add">+ フィールド追加</button>
          </template>

          <!-- Tags section -->
          <div class="info-section">
            <div class="info-section-label">タグ</div>
            <div class="tags-pills">
              <span v-for="tag in entryTags" :key="tag" class="tag-pill">
                {{ tag }}
                <button class="tag-pill-remove" @click="removeTag(tag)" title="削除">×</button>
              </span>
              <span v-if="entryTags.length === 0" class="empty-hint">タグはまだありません。</span>
            </div>
            <div class="tag-add-row">
              <input v-model="newTagInput"
                     list="tag-datalist"
                     placeholder="タグを追加..."
                     class="tag-add-input"
                     @keydown.enter.prevent="addTag">
              <datalist id="tag-datalist">
                <option v-for="t in availableTags" :key="t.name" :value="t.name"></option>
              </datalist>
              <button @click="addTag" class="btn btn-save">追加</button>
            </div>
          </div>

          <!-- File links section -->
          <div class="info-section">
            <div class="info-section-label">ファイル</div>
            <ul class="file-list" v-if="fileExtras.length > 0">
              <li v-for="x in fileExtras" :key="x.id" class="file-list-item">
                <div class="file-list-main">
                  <a :href="x.extra_value" target="_blank" rel="noopener" class="file-link">
                    {{ fileLabel(x.extra_value) }}
                  </a>
                  <template v-if="editingFileNoteId === x.id">
                    <input v-model="editingFileNoteVal" placeholder="備考"
                           class="note-input"
                           @keydown.enter.prevent="saveFileNote(x)">
                    <div class="edit-actions">
                      <button @click="saveFileNote(x)" class="btn btn-save">保存</button>
                      <button @click="cancelEditFileNote" class="btn btn-cancel">キャンセル</button>
                    </div>
                  </template>
                  <div v-else-if="x.note" class="file-note" @click="startEditFileNote(x)"
                       title="クリックして編集">{{ x.note }}</div>
                </div>
                <div class="file-list-actions">
                  <button v-if="editingFileNoteId !== x.id" class="icon-btn" title="備考を編集"
                          @click="startEditFileNote(x)">📝</button>
                  <button class="icon-btn" title="削除" @click="removeFileLink(x.id)">🗑️</button>
                </div>
              </li>
            </ul>
            <span v-else class="empty-hint">ファイルリンクはまだありません。</span>

            <!-- ローカル限定パス（local_extras; 例: pdf_path）。表示専用、追加/編集/削除はGUI外で行う -->
            <template v-if="localFileExtras.length > 0">
              <div class="local-file-label">ローカルファイル</div>
              <ul class="file-list">
                <li v-for="x in localFileExtras" :key="x.id" class="file-list-item">
                  <div class="file-list-main">
                    <a :href="localFileUrl(selectedEntry.cite_key, x.extra_key)"
                       target="_blank" rel="noopener" class="file-link">
                      {{ localFileLabel(x.extra_key) }}
                    </a>
                    <div class="file-note-static">{{ x.extra_value }}</div>
                    <div v-if="x.note" class="file-note-static">{{ x.note }}</div>
                  </div>
                </li>
              </ul>
            </template>

            <div class="file-add-row">
              <div class="tag-add-row">
                <input v-model="newFileUrl" placeholder="https://... のURLを追加"
                       class="tag-add-input" @keydown.enter.prevent="addFileLink">
              </div>
              <div class="tag-add-row file-add-note-row">
                <input v-model="newFileNote" placeholder="備考（任意）例: 元論文 / アノテーションあり"
                       class="note-input file-add-note-input" @keydown.enter.prevent="addFileLink">
                <button @click="addFileLink" class="btn btn-save">追加</button>
              </div>
            </div>
          </div>

          <!-- Markdown (md.*) quick-add section -->
          <div class="info-section">
            <div class="info-section-label">Markdown</div>
            <div v-if="showMdAdd" class="add-form">
              <input v-model="mdAddKey" list="md-key-datalist"
                     placeholder="extra_key 例: md.digest" class="add-key-input">
              <datalist id="md-key-datalist">
                <option v-for="k in Object.keys(MD_KEY_LABELS)" :key="k" :value="k"></option>
              </datalist>
              <input v-model="mdAddNote" placeholder="備考（任意）例: 研究会報告資料"
                     class="note-input">
              <textarea v-model="mdAddVal" placeholder="内容を貼り付け、または下のボタンでファイルから読み込み"
                        class="add-value-input" rows="6"
                        @keydown.ctrl.enter="saveMdExtra" @keydown.meta.enter="saveMdExtra"></textarea>
              <label class="btn btn-add figure-file-label" style="align-self: flex-start;">
                ファイルから読み込む
                <input type="file" accept=".md,.markdown,.txt,text/*" class="figure-file-input"
                       @change="handleMdFileInput">
              </label>
              <div class="edit-actions">
                <button @click="saveMdExtra" class="btn btn-save" :disabled="mdAddBusy">
                  {{ existingMdExtra(mdAddKey.trim()) ? '上書き保存' : '追加' }}
                </button>
                <button @click="cancelMdAdd" class="btn btn-cancel">キャンセル</button>
              </div>
              <p v-if="existingMdExtra(mdAddKey.trim())" class="md-overwrite-hint">
                "{{ mdAddKey.trim() }}" は既に登録済みです。保存すると内容が上書きされます。
              </p>
            </div>
            <button v-else @click="startMdAdd" class="btn btn-add">+ md.* 追加</button>
          </div>
        </div>

        <div class="digest-panel" v-if="digestExtra" ref="digestPanelRef">
          <div v-if="digestExtra.extra_key !== 'md.digest'" class="digest-fallback-label">
            {{ mdKeyLabel(digestExtra.extra_key) }} を表示中
          </div>
          <div v-if="digestExtra.note" class="digest-note">{{ digestExtra.note }}</div>
          <markdown-renderer :content="digestExtra.extra_value"></markdown-renderer>
        </div>
      </div>

      <!-- ── Figures tab (図表メモ) ── -->
      <div v-show="activeTab === 'figures'" class="tab-content tab-content-figures"
           tabindex="0" ref="figuresPanelRef"
           @paste="handleFigurePaste" @dragover.prevent @drop.prevent="handleFigureDrop">

        <div class="figure-paste-zone">
          <span>画像をペースト (Ctrl+V) またはドラッグ&ドロップ</span>
          <label class="btn btn-add figure-file-label">
            ファイルを選択
            <input type="file" accept="image/*" class="figure-file-input"
                   @change="handleFigureFileInput">
          </label>
          <span v-if="figureBusy" class="figure-uploading">アップロード中…</span>
        </div>

        <div class="figure-list" v-if="figures.length > 0">
          <div class="figure-card" v-for="(fig, idx) in figures" :key="fig.id">
            <img :src="figureImageUrl(fig.id)" class="figure-thumb"
                 @click="openFigureLightbox(fig.id)" alt="">
            <div class="figure-body">
              <template v-if="editingFigureId === fig.id">
                <input v-model="editingFigureLabel" class="add-key-input"
                       placeholder="ラベル 例: Fig. 3 / Table 2">
                <textarea v-model="editingFigureMemo" class="edit-textarea" rows="3"
                          placeholder="メモ"
                          @keydown.ctrl.enter="saveFigureEdit" @keydown.meta.enter="saveFigureEdit"></textarea>
                <div class="edit-actions">
                  <button @click="saveFigureEdit" class="btn btn-save">保存</button>
                  <button @click="cancelFigureEdit" class="btn btn-cancel">キャンセル</button>
                </div>
              </template>
              <template v-else>
                <div class="figure-label">{{ fig.label || '(ラベルなし)' }}</div>
                <div class="figure-memo">{{ fig.memo }}</div>
              </template>
            </div>
            <div class="figure-actions" v-if="editingFigureId !== fig.id">
              <button class="icon-btn" title="上へ" :disabled="idx === 0"
                      @click="moveFigure(idx, -1)">↑</button>
              <button class="icon-btn" title="下へ" :disabled="idx === figures.length - 1"
                      @click="moveFigure(idx, 1)">↓</button>
              <button class="icon-btn" title="編集" @click="startEditFigure(fig)">✏️</button>
              <button class="icon-btn" title="削除" @click="deleteFigureNote(fig.id)">🗑️</button>
            </div>
          </div>
        </div>
        <p v-else class="empty-hint">まだ図表メモがありません。上の枠に画像をペーストしてください。</p>
      </div>

      <!-- ── Extras tab ── -->
      <div v-show="activeTab === 'extras'" class="tab-content">
        <table class="kv-table" v-if="otherExtras.length > 0">
          <tbody>
            <tr v-for="x in otherExtras" :key="x.id">
              <td class="kv-key">
                <span :class="x.extra_key.startsWith('md.') ? 'md-key-badge' : ''">
                  {{ x.extra_key }}
                </span>
              </td>
              <td class="kv-value">
                <template v-if="editingExtraId === x.id">
                  <textarea v-model="editingExtraVal" class="edit-textarea"
                            :rows="x.extra_key.startsWith('md.') ? 14 : 3"
                            @keydown.ctrl.enter="saveExtra" @keydown.meta.enter="saveExtra"></textarea>
                  <input v-model="editingExtraNote" placeholder="備考（任意）" class="note-input extra-note-input">
                  <div class="edit-actions">
                    <button @click="saveExtra" class="btn btn-save">保存</button>
                    <button @click="cancelEditExtra" class="btn btn-cancel">キャンセル</button>
                  </div>
                </template>
                <template v-else>
                  <span class="kv-text kv-truncate">{{ x.extra_value }}</span>
                  <div v-if="x.note" class="kv-note">📝 {{ x.note }}</div>
                  <div class="row-actions">
                    <button @click="startEditExtra(x)" class="icon-btn" title="編集">✏️</button>
                    <button @click="deleteExtra(x.id, x.extra_key)" class="icon-btn" title="削除">🗑️</button>
                  </div>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty-hint">extras はまだありません。</p>

        <div v-if="showNewExtra" class="add-form">
          <input v-model="newExtraKey"
                 placeholder="extra_key  例: md.digest, memo, file"
                 class="add-key-input"
                 @keydown.enter.prevent="addExtra">
          <textarea v-model="newExtraVal" placeholder="値" class="add-value-input" rows="3"
                    @keydown.ctrl.enter="addExtra" @keydown.meta.enter="addExtra"></textarea>
          <input v-model="newExtraNote" placeholder="備考（任意）" class="note-input">
          <div class="edit-actions">
            <button @click="addExtra" class="btn btn-save">追加</button>
            <button @click="showNewExtra = false; newExtraKey = ''; newExtraVal = ''; newExtraNote = ''"
                    class="btn btn-cancel">キャンセル</button>
          </div>
        </div>
        <button v-else @click="showNewExtra = true" class="btn btn-add">+ extras 追加</button>
      </div>

      <!-- ── Markdown tab ── -->
      <div v-if="activeTab === 'markdown'" class="tab-content tab-content-md">
        <nav class="md-tab-bar" v-if="mdExtras.length > 1">
          <button v-for="x in mdExtras" :key="x.id"
                  class="md-tab-btn" :class="{ active: activeMdKey === x.id }"
                  :title="x.note || ''"
                  @click="activeMdKey = x.id">
            {{ mdKeyLabel(x.extra_key) }}
          </button>
        </nav>

        <template v-for="x in mdExtras" :key="x.id">
          <div v-show="activeMdKey === x.id" class="md-viewer">
            <div v-if="x.note" class="md-note">{{ x.note }}</div>
            <markdown-renderer :content="x.extra_value"></markdown-renderer>
          </div>
        </template>
      </div>

    </main>

    <!-- Empty state -->
    <main class="detail detail-empty" v-else>
      <div class="empty-message">← エントリを選択してください</div>
    </main>

  </div>

  <!-- ── Figure lightbox ── -->
  <div v-if="lightboxFigureId" class="modal-overlay figure-lightbox-overlay" @click.self="closeFigureLightbox">
    <img :src="figureImageUrl(lightboxFigureId)" class="figure-lightbox-img" alt="">
    <button class="modal-close figure-lightbox-close" @click="closeFigureLightbox" title="閉じる">✕</button>
  </div>

  <!-- ── Add entry modal ── -->
  <div v-if="showAddEntry" class="modal-overlay" @click.self="closeAddEntry">
    <div class="modal-panel">
      <div class="modal-header">
        <h2>新規文献の登録</h2>
        <button class="modal-close" @click="closeAddEntry" title="閉じる">✕</button>
      </div>

      <div class="modal-body">
        <div class="add-entry-section">
          <div class="info-section-label">DOI から取得</div>
          <div class="doi-fetch-row">
            <input v-model="addDoiInput" class="doi-input"
                   placeholder="DOI または https://doi.org/... を貼り付け"
                   @keydown.enter.prevent="fetchDoiIntoBib">
            <button class="btn btn-save" :disabled="addBusy || !addDoiInput.trim()"
                    @click="fetchDoiIntoBib">
              {{ addBusy ? '取得中…' : 'Crossref から取得' }}
            </button>
          </div>
        </div>

        <div class="add-entry-section">
          <div class="info-section-label">BibTeX（1件のみ）</div>
          <textarea v-model="addBibText" class="edit-textarea add-bib-textarea" rows="8"
                    placeholder="@article{key, title={...}, author={Last, First and ...}, year={2026}, ...}"
                    @input="parseAddBibText"></textarea>
          <p v-if="addMultiWarn" class="warn-hint">
            複数エントリが検出されました。最初の1件のみ使用します（複数登録は bibdb を使ってください）。
          </p>
        </div>

        <p v-if="addError" class="error-hint">{{ addError }}</p>

        <div class="add-entry-section" v-if="addParsed">
          <div class="info-section-label">プレビュー</div>

          <div class="citekey-row">
            <span class="kv-key">citekey</span>
            <input v-model="addParsed.cite_key" class="add-key-input citekey-input"
                   @input="addCitekeyTouched = true">
            <button class="icon-btn" title="自動生成し直す" @click="regenAddCitekey">🔄</button>
            <span v-if="addCitekeyStatus === 'dup'" class="badge-dup">既存キーと衝突</span>
            <span v-else-if="addCitekeyStatus === 'ok'" class="badge-ok">OK（新規）</span>
          </div>

          <div class="similar-warning" v-if="similarEntries.length > 0">
            <div class="similar-warning-label">
              類似の登録が見つかりました（誤検出の可能性もあります。登録はブロックされません）
            </div>
            <div class="similar-item" v-for="c in similarEntries" :key="c.entry.cite_key">
              <span class="similar-key">{{ c.entry.cite_key }}</span>
              <span class="similar-title">{{ c.entry.title || '(no title)' }}</span>
              <span class="similar-meta">
                <template v-if="c.entry.author">{{ firstAuthor(c.entry.author) }}</template>
                <template v-if="c.entry.year"> · {{ c.entry.year }}</template>
              </span>
              <span class="similar-reason">{{ c.reason }}</span>
            </div>
          </div>

          <table class="kv-table">
            <tbody>
              <tr>
                <td class="kv-key">entry_type</td>
                <td class="kv-value"><input v-model="addParsed.entry_type" class="add-key-input"></td>
              </tr>
              <tr v-for="(val, key) in addParsed.fields" :key="key">
                <td class="kv-key">{{ key }}</td>
                <td class="kv-value">
                  <textarea v-model="addParsed.fields[key]" class="edit-textarea" rows="2"></textarea>
                  <div class="row-actions">
                    <button class="icon-btn" title="削除" @click="removeAddField(key)">🗑️</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          <div class="add-form">
            <input v-model="newAddFieldKey" placeholder="field_key" class="add-key-input"
                   @keydown.enter.prevent="addAddField">
            <textarea v-model="newAddFieldVal" placeholder="値" class="add-value-input" rows="2"
                      @keydown.ctrl.enter="addAddField" @keydown.meta.enter="addAddField"></textarea>
            <button @click="addAddField" class="btn btn-save">フィールド追加</button>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-cancel" @click="closeAddEntry">キャンセル</button>
        <button class="btn btn-save"
                :disabled="!addParsed || addBusy || addCitekeyStatus === 'dup' || !addParsed.cite_key.trim()"
                @click="submitAddEntry">
          {{ addBusy ? '登録中…' : '登録' }}
        </button>
      </div>
    </div>
  </div>
</div>
`,
});

app.mount('#app');
