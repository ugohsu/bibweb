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

  let src = text.replace(/```mermaid\n([\s\S]*?)```/g, (_, code) => {
    const idx = mermaidBlocks.length;
    mermaidBlocks.push(code.trim());
    return `<div class="mermaid-placeholder" data-idx="${idx}"></div>`;
  });

  src = src.replace(/```plantuml\n([\s\S]*?)```/g, (_, code) => {
    const encoded = encodePlantUML(code.trim());
    return `<img src="https://www.plantuml.com/plantuml/svg/${encoded}" class="plantuml-img" alt="PlantUML diagram">`;
  });

  container.innerHTML = marked.parse(src);

  if (typeof renderMathInElement !== 'undefined') {
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
  async updateExtra(id, value) {
    return fetch(`/api/extras/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ extra_value: value }),
    });
  },
  async deleteExtra(id) {
    return fetch(`/api/extras/${id}`, { method: 'DELETE' });
  },
  async addExtra(citeKey, extraKey, value) {
    return fetch(`/api/entries/${encodeURIComponent(citeKey)}/extras`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ extra_key: extraKey, extra_value: value }),
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
  async bulkAddTag(keys, name) {
    return fetch('/api/tags/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys, name }),
    });
  },
};

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
    const showNewExtra     = ref(false);
    const newExtraKey      = ref('');
    const newExtraVal      = ref('');

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
        return pool.map(e => ({
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
          const score =
            (km?.score ?? 0) * 3 +
            (tm?.score ?? 0) * 2 +
            (am?.score ?? 0);
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

    const digestExtra = computed(() =>
      (selectedEntry.value?.extras ?? []).find(x => x.extra_key === 'md.digest') ?? null
    );

    const fileExtras = computed(() =>
      (selectedEntry.value?.extras ?? []).filter(x => x.extra_key === 'file')
    );

    // ── Watchers ───────────────────────────────────────────────────────────
    watch(activeTab, (tab) => {
      if (tab === 'markdown' && !activeMdKey.value && mdExtras.value.length > 0) {
        activeMdKey.value = mdExtras.value[0].extra_key;
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
      selectedEntry.value = await api.getEntry(key);
      activeTab.value = 'info';
      resetEditing();
      if (mdExtras.value.length > 0) {
        activeMdKey.value = mdExtras.value[0].extra_key;
      } else {
        activeMdKey.value = null;
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
      showNewExtra.value     = false;
      newExtraKey.value      = '';
      newExtraVal.value      = '';
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
      editingExtraId.value  = extra.id;
      editingExtraVal.value = extra.extra_value;
    }

    function cancelEditExtra() {
      editingExtraId.value  = null;
      editingExtraVal.value = '';
    }

    async function saveExtra() {
      await api.updateExtra(editingExtraId.value, editingExtraVal.value);
      cancelEditExtra();
      await refreshEntry();
    }

    async function deleteExtra(id, key) {
      if (!confirm(`"${key}" を削除しますか？`)) return;
      await api.deleteExtra(id);
      const deleted = mdExtras.value.find(x => x.id === id);
      if (deleted && activeMdKey.value === deleted.extra_key) {
        activeMdKey.value = null;
      }
      await refreshEntry();
    }

    async function addExtra() {
      const key = newExtraKey.value.trim();
      if (!key) return;
      await api.addExtra(selectedEntry.value.cite_key, key, newExtraVal.value);
      newExtraKey.value  = '';
      newExtraVal.value  = '';
      showNewExtra.value = false;
      await refreshEntry();
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
      allTags, tagFilterOpen, selectedTags, newTagInput, bulkTagInput,
      editingFieldKey, editingFieldVal, showNewField, newFieldKey, newFieldVal,
      editingExtraId, editingExtraVal, showNewExtra, newExtraKey, newExtraVal,
      // computed
      searchResults, filteredEntries, mdExtras, otherExtras, allChecked, digestExtra,
      fileExtras,
      entryTags, availableTags,
      // methods
      selectEntry, toggleCheck, toggleAll, exportSelected,
      toggleFieldsEditMode, fieldsEditMode,
      startEditField, cancelEditField, saveField, deleteField, addField,
      startEditExtra, cancelEditExtra, saveExtra, deleteExtra, addExtra,
      exportSelectedDb,
      toggleTagFilter, clearTagFilter, addTag, removeTag, bulkAddTag,
      // helpers exposed to template
      mdKeyLabel, fileLabel, firstAuthor,
    };
  },

  template: `
<div class="app">

  <!-- Header -->
  <header class="header">
    <span class="header-title">bibweb</span>
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
          <div class="info-section" v-if="fileExtras.length > 0">
            <div class="info-section-label">ファイル</div>
            <ul class="file-list">
              <li v-for="x in fileExtras" :key="x.id">
                <a :href="x.extra_value" target="_blank" rel="noopener" class="file-link">
                  {{ fileLabel(x.extra_value) }}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div class="digest-panel" v-if="digestExtra">
          <markdown-renderer :content="digestExtra.extra_value"></markdown-renderer>
        </div>
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
                  <div class="edit-actions">
                    <button @click="saveExtra" class="btn btn-save">保存</button>
                    <button @click="cancelEditExtra" class="btn btn-cancel">キャンセル</button>
                  </div>
                </template>
                <template v-else>
                  <span class="kv-text kv-truncate">{{ x.extra_value }}</span>
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
          <div class="edit-actions">
            <button @click="addExtra" class="btn btn-save">追加</button>
            <button @click="showNewExtra = false; newExtraKey = ''; newExtraVal = ''"
                    class="btn btn-cancel">キャンセル</button>
          </div>
        </div>
        <button v-else @click="showNewExtra = true" class="btn btn-add">+ extras 追加</button>
      </div>

      <!-- ── Markdown tab ── -->
      <div v-show="activeTab === 'markdown'" class="tab-content tab-content-md">
        <nav class="md-tab-bar" v-if="mdExtras.length > 1">
          <button v-for="x in mdExtras" :key="x.extra_key"
                  class="md-tab-btn" :class="{ active: activeMdKey === x.extra_key }"
                  @click="activeMdKey = x.extra_key">
            {{ mdKeyLabel(x.extra_key) }}
          </button>
        </nav>

        <template v-for="x in mdExtras" :key="x.id">
          <div v-show="activeMdKey === x.extra_key" class="md-viewer">
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
</div>
`,
});

app.mount('#app');
