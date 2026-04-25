# ファイルリンク機能・UI 再編 設計メモ

## 概要

bibweb にエントリへの外部ファイルリンク機能を追加する。
あわせて、右パネルのタブ構成を再編し、Fields / Tags / Markdown / Extras の 4 タブから
**Info / Markdown / Extras** の 3 タブに整理する。

---

## ファイルリンクの仕様

### 保存場所

`extras` テーブルに `extra_key = 'file'` として登録する。

```sql
INSERT INTO extras (entry_id, extra_key, extra_value)
SELECT id, 'file', 'https://www.dropbox.com/scl/fi/xxxx/Knuth1984.pdf'
FROM entries WHERE cite_key = 'Knuth1984';
```

### 値のフォーマット

`extra_value` は `http://` または `https://` で始まる URL を想定する。
Dropbox・Google Drive・arXiv・機関リポジトリなど、どんな URL でも登録できる。

ローカルパス（相対・絶対）は対象外とする。

### バックエンドへの変更

**なし。** URL は直接 `<a href>` に使うため、サーバ側のファイル配信エンドポイントは不要。
既存の `GET /api/entries/{cite_key}` が `extras` をそのまま返しているので追加 API も不要。

---

## タブ再編

### 変更前

| タブ | 内容 |
|---|---|
| Fields | BibTeX フィールド表・編集 |
| Tags | タグ管理 |
| Markdown | `md.*` extra のレンダリング |
| Extras | 全 extra の raw 一覧・編集 |

### 変更後

| タブ | 表示条件 | 内容 |
|---|---|---|
| **Info** | 常時 | BibTeX フィールド表 ＋ タグ ＋ ファイルリンク |
| **Markdown** | `md.*` extra が 1 件以上 | Markdown ドキュメント |
| **Extras** | 常時 | 全 extra の raw 一覧・編集 |

Tags タブを廃止し、Info タブに統合する。

---

## Info タブのレイアウト

```
[ BibTeX フィールド表（kv-table）＋ 編集ボタン ]

[ タグ pills ＋ 追加フォーム ]       ← 旧 Tags タブを統合

[ ファイルリンク一覧 ]               ← file extra がある場合のみ表示
```

`md.digest` が存在する場合は、現行の Fields タブと同様に右カラムにダイジェストを表示する split レイアウトを維持する。

### ファイルリンクの表示仕様

- `extra_key = 'file'` の extra を登録順に列挙する
- ラベルは `extra_value` の URL からファイル名部分（最終パス要素）を取り出して表示する
  - 例: `https://www.dropbox.com/scl/fi/xxx/Knuth1984.pdf?rlkey=yyy` → `Knuth1984.pdf`
  - パス要素が取り出せない場合は URL 全体をラベルにする
- クリックで新タブを開く（`target="_blank"`）
- ファイルが複数ある場合はリスト表示する

---

## 実装スコープ

### バックエンド（`bibweb` スクリプト）

変更なし。

### フロントエンド（`web/app.js`、`web/style.css`）

- `activeTab` の初期値・遷移先を `'fields'` → `'info'` に変更
- Tab bar から Tags ボタンを削除し、Fields ボタンを Info に改名
- Info タブのテンプレートに旧 Fields タブ・旧 Tags タブの内容を統合
- Info タブにファイルリンクセクションを追加
  - `fileExtras` computed: `extras.filter(x => x.extra_key === 'file')`
  - URL からラベルを取り出すヘルパー関数 `fileLabel(url)` を追加
- Tags タブのテンプレート・関連ロジックを削除（機能自体は Info タブに残す）
- CSS: Info タブ内のタグ・ファイルリンク用スタイルを追加
