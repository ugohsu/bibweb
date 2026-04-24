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

  // Extract mermaid blocks before parsing
  let src = text.replace(/```mermaid\n([\s\S]*?)```/g, (_, code) => {
    const idx = mermaidBlocks.length;
    mermaidBlocks.push(code.trim());
    return `<div class="mermaid-placeholder" data-idx="${idx}"></div>`;
  });

  // Replace plantuml blocks with img tags
  src = src.replace(/```plantuml\n([\s\S]*?)```/g, (_, code) => {
    const encoded = encodePlantUML(code.trim());
    return `<img src="https://www.plantuml.com/plantuml/svg/${encoded}" class="plantuml-img" alt="PlantUML diagram">`;
  });

  container.innerHTML = marked.parse(src);

  // Render math with KaTeX
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

  // Render mermaid diagrams
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
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MD_KEY_LABELS = {
  'md.full':    'フル論文',
  'md.full.ja': 'フル論文（日本語）',
  'md.digest':  'ダイジェスト',
};

function mdKeyLabel(key) {
  return MD_KEY_LABELS[key] ?? key;
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
    const entries      = ref([]);
    const selectedEntry = ref(null);
    const searchQuery  = ref('');
    const checkedKeys  = ref(new Set());
    const activeTab    = ref('fields');
    const activeMdKey  = ref(null);
    const dbPath       = ref('');

    // Editing: fields
    const editingFieldKey  = ref(null);   // which field_key is being edited
    const editingFieldVal  = ref('');
    const showNewField     = ref(false);
    const newFieldKey      = ref('');
    const newFieldVal      = ref('');

    // Editing: extras
    const editingExtraId   = ref(null);   // which extra id is being edited
    const editingExtraVal  = ref('');
    const showNewExtra     = ref(false);
    const newExtraKey      = ref('');
    const newExtraVal      = ref('');

    // ── Computed ───────────────────────────────────────────────────────────
    const filteredEntries = computed(() => {
      const q = searchQuery.value.toLowerCase().trim();
      if (!q) return entries.value;
      return entries.value.filter(e =>
        (e.cite_key  || '').toLowerCase().includes(q) ||
        (e.title     || '').toLowerCase().includes(q) ||
        (e.author    || '').toLowerCase().includes(q)
      );
    });

    const mdExtras = computed(() =>
      (selectedEntry.value?.extras ?? []).filter(x => x.extra_key.startsWith('md.'))
    );

    const otherExtras = computed(() =>
      (selectedEntry.value?.extras ?? []).filter(x => !x.extra_key.startsWith('md.'))
    );

    const allChecked = computed(() =>
      filteredEntries.value.length > 0 &&
      filteredEntries.value.every(e => checkedKeys.value.has(e.cite_key))
    );

    // ── Watchers ───────────────────────────────────────────────────────────
    watch(activeMdKey, () => { /* rendering is handled by MarkdownRenderer */ });

    watch(activeTab, (tab) => {
      if (tab === 'markdown' && !activeMdKey.value && mdExtras.value.length > 0) {
        activeMdKey.value = mdExtras.value[0].extra_key;
      }
    });

    // ── Methods: navigation ────────────────────────────────────────────────
    async function loadEntries() {
      entries.value = await api.getEntries();
    }

    async function selectEntry(key) {
      selectedEntry.value = await api.getEntry(key);
      activeTab.value = 'fields';
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
      // Also refresh the summary row in the list
      const idx = entries.value.findIndex(e => e.cite_key === selectedEntry.value.cite_key);
      if (idx >= 0) entries.value = await api.getEntries();
    }

    function resetEditing() {
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
      // Reset activeMdKey if it was the deleted one
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
    });

    return {
      // state
      entries, selectedEntry, searchQuery, checkedKeys,
      activeTab, activeMdKey, dbPath,
      editingFieldKey, editingFieldVal, showNewField, newFieldKey, newFieldVal,
      editingExtraId, editingExtraVal, showNewExtra, newExtraKey, newExtraVal,
      // computed
      filteredEntries, mdExtras, otherExtras, allChecked,
      // methods
      selectEntry, toggleCheck, toggleAll, exportSelected,
      startEditField, cancelEditField, saveField, deleteField, addField,
      startEditExtra, cancelEditExtra, saveExtra, deleteExtra, addExtra,
      // helpers exposed to template
      mdKeyLabel, firstAuthor,
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
        <div class="sidebar-toolbar">
          <label class="check-all-label">
            <input type="checkbox" :checked="allChecked" @change="toggleAll">
            全選択
          </label>
          <span class="entry-count">{{ filteredEntries.length }} 件</span>
        </div>
      </div>

      <ul class="entry-list">
        <li v-for="e in filteredEntries" :key="e.cite_key"
            class="entry-item"
            :class="{ selected: selectedEntry && selectedEntry.cite_key === e.cite_key }"
            @click="selectEntry(e.cite_key)">
          <input type="checkbox" class="entry-check"
                 :checked="checkedKeys.has(e.cite_key)"
                 @click="toggleCheck(e.cite_key, $event)">
          <div class="entry-info">
            <div class="entry-key">{{ e.cite_key }}
              <span class="entry-type-pill">{{ e.entry_type }}</span>
            </div>
            <div class="entry-title">{{ e.title || '(no title)' }}</div>
            <div class="entry-meta">
              {{ firstAuthor(e.author) }}<template v-if="e.year"> · {{ e.year }}</template>
            </div>
          </div>
        </li>
        <li v-if="filteredEntries.length === 0" class="entry-empty">
          一致するエントリがありません
        </li>
      </ul>

      <div class="sidebar-footer">
        <button @click="exportSelected" class="btn btn-export"
                :disabled="checkedKeys.size === 0">
          .bib として書き出し
          <span v-if="checkedKeys.size > 0" class="export-count">({{ checkedKeys.size }})</span>
        </button>
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
        <button class="tab-btn" :class="{ active: activeTab === 'fields' }"
                @click="activeTab = 'fields'">
          Fields
          <span class="tab-count">{{ selectedEntry.fields.length }}</span>
        </button>
        <button class="tab-btn" :class="{ active: activeTab === 'extras' }"
                @click="activeTab = 'extras'">
          Extras
          <span class="tab-count">{{ selectedEntry.extras.length }}</span>
        </button>
        <button class="tab-btn" :class="{ active: activeTab === 'markdown' }"
                @click="activeTab = 'markdown'"
                v-if="mdExtras.length > 0">
          Markdown
          <span class="tab-count">{{ mdExtras.length }}</span>
        </button>
      </nav>

      <!-- ── Fields tab ── -->
      <div v-show="activeTab === 'fields'" class="tab-content">
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
                  <div class="row-actions">
                    <button @click="startEditField(f)" class="icon-btn" title="編集">✏️</button>
                    <button @click="deleteField(f.field_key)" class="icon-btn" title="削除">🗑️</button>
                  </div>
                </template>
              </td>
            </tr>
          </tbody>
        </table>

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
      </div>

      <!-- ── Extras tab ── -->
      <div v-show="activeTab === 'extras'" class="tab-content">
        <table class="kv-table" v-if="selectedEntry.extras.length > 0">
          <tbody>
            <tr v-for="x in selectedEntry.extras" :key="x.id">
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
                 placeholder="extra_key  例: md.digest, memo, tag, file"
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
