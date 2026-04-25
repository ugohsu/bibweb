# PDF 表示機能 設計メモ

## 概要

bibweb に、エントリに紐付いた PDF ファイルをブラウザで開く機能を追加する。
共同研究での Dropbox 共有など、ユーザーごとに絶対パスが異なる環境でも動作することを要件とする。

---

## パスの保存方法

### 保存場所

`extras` テーブルに `extra_key = 'file'` として登録する。

```sql
INSERT INTO extras (entry_id, extra_key, extra_value)
SELECT id, 'file', 'papers/Knuth1984.pdf'
FROM entries WHERE cite_key = 'Knuth1984';
```

`extras` を選ぶ理由：
- `fields` の `(entry_id, field_key)` UNIQUE 制約により、1エントリに1ファイルしか持てない
- `extras` は UNIQUE 制約がないため、本文・補足資料など複数 PDF を自然に登録できる
- bibdb の設計思想（ユーザー独自データは `extras`）に沿っている

### パスの解釈規則

| `extra_value` の形式 | 解釈 |
|---|---|
| 相対パス（例: `papers/Knuth1984.pdf`） | **DB ファイルの親ディレクトリ**を基点として解決 |
| 絶対パス（例: `/home/alice/papers/Knuth1984.pdf`） | そのまま使用 |

相対パスを推奨とし、絶対パスはフォールバックとして受け付ける。
絶対パスを登録した場合、他ユーザーに DB を共有しても PDF は開けない（ユーザーの責任範囲）。

### DB-relative パスを採用する理由

環境変数（`BIBWEB_PDF_ROOT` など）による設定は採用しない。

- DB はプロジェクトごとに複数存在しうる（例: `~/Dropbox/project_A/refs.db`, `~/Dropbox/project_B/refs.db`）
- グローバルな環境変数はそれらを同時に扱えない
- DB の場所が基点となることで、プロジェクトフォルダごと移動・共有しても相対パスが壊れない

**Dropbox 共有の例：**

```
~/Dropbox/refs/
├── refs.db          ← DB
└── papers/
    ├── Knuth1984.pdf
    └── Ohsu2024.pdf
```

`extra_value = 'papers/Knuth1984.pdf'` と登録すれば、同じフォルダ構成を持つ共同研究者全員で機能する。

---

## サーバ側の実装

### エンドポイント

```
GET /api/entries/{cite_key}/pdf
GET /api/entries/{cite_key}/pdf?index=1    # 複数ファイルがある場合
```

`index` 省略時は最初の `file` エントリを返す。

### パス解決ロジック

1. `extras` から `extra_key = 'file'` の行を取得
2. 絶対パスならそのまま使用、相対パスなら `Path(db_path).parent / value` に解決
3. ファイルの存在確認
4. PDF をストリーム配信（`Content-Type: application/pdf`）

### セキュリティ

相対パスの場合、解決後のパスが DB ディレクトリ以下にあるかを確認する（path traversal 対策）。
絶対パスはこのチェックをスキップする（ユーザーが明示的に指定したものとして扱う）。

---

## フロントエンド

- エントリに `file` extra が存在する場合、詳細パネルに「PDF を開く」リンクを表示する
- クリックで新タブを開く（`window.open` または `target="_blank"`）
- 複数ファイルがある場合はリスト表示し、それぞれ別タブで開けるようにする
- ファイルが存在しない場合はサーバが 404 を返し、UI にエラーを表示する

---

## 未決事項

- 複数 `file` エントリがある場合の `index` 以外の識別方法（`extra_value` のファイル名をラベルにするなど）
- Fields タブへの統合か、専用タブを作るか
