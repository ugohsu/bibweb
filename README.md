# bibweb

[bibdb](https://github.com/ugohsu/bibdb) が管理する SQLite データベースに Web ブラウザからアクセスするための GUI ツールです。

bibdb 本体には一切手を加えず、同じ DB ファイルを直接読み書きします。

## 特徴

- **1 ファイル配布**: `bibweb` スクリプトを `$PATH` の通ったディレクトリに置くだけで使えます
- **UI の自動取得**: 初回起動時に UI ファイル群を GitHub から `~/.cache/bibweb/` にダウンロードします
- **オフライン動作**: 2 回目以降はキャッシュから起動します（数式レンダリングのみネットワークが必要）
- **読み書き対応**: BibTeX フィールドと `extras` を GUI から追加・編集・削除できます
- **Markdown レンダリング**: `extras` の `md.*` キーに格納した Markdown（論文・要約・翻訳など）を KaTeX・Mermaid・PlantUML つきで表示します

## 必要要件

- Python 3.8+
- bibdb が作成した SQLite DB（デフォルト: `~/refs.db` または `$BIBDB_PATH`）
- 初回起動時のみインターネット接続

## インストール

```bash
curl -O https://raw.githubusercontent.com/ugohsu/bibweb/main/bibweb
chmod +x bibweb
mv bibweb ~/bin/        # $PATH の通ったディレクトリへ
```

または、リポジトリをクローンしてリンクを張る方法も使えます：

```bash
git clone https://github.com/ugohsu/bibweb.git
ln -s "$PWD/bibweb/bibweb" ~/bin/bibweb
```

## 使い方

```bash
bibweb                  # デフォルト DB ($BIBDB_PATH または ~/refs.db) で起動
bibweb ./project.db     # 任意の DB ファイルを指定
bibweb --port 9000      # ポートを変更（デフォルト: 8766）
bibweb --update         # UI ファイルを GitHub から再取得して終了
```

起動するとブラウザが自動的に開きます。Ctrl+C で停止します。

## DB パスの優先順位

| 指定方法 | 挙動 |
|---|---|
| 引数なし | `$BIBDB_PATH` 環境変数 → `~/refs.db` の順で使用 |
| 相対パス（例: `bibweb ./project.db`） | カレントディレクトリ基準で解決 |
| 絶対パス（例: `bibweb /data/refs.db`） | 指定パスをそのまま使用 |

## UI の機能

### エントリ一覧（左パネル）
- CiteKey・タイトル・著者でテキスト検索
- チェックボックスで複数選択 → `.bib` として書き出し

### エントリ詳細（右パネル）

**Fields タブ**: BibTeX フィールドの表示・編集・削除・追加

**Extras タブ**: `extras` テーブルの表示・編集・削除・追加

**Markdown タブ**: `extras` の `md.*` キーに格納した Markdown をレンダリング表示

### Markdown コンテンツのキー命名規則

`md.` プレフィックスで始まる `extra_key` を Markdown コンテンツとして扱います。

| `extra_key` | 用途 | bibweb での表示 |
|---|---|---|
| `md.full` | フル論文 Markdown（opendataloader-pdf 等） | 「フル論文」 |
| `md.full.ja` | フル論文の日本語訳 | 「フル論文（日本語）」 |
| `md.digest` | ダイジェスト・要約 | 「ダイジェスト」 |
| `md.*`（上記以外） | 用途に応じて自由に命名 | キー名をそのまま表示 |

extras への Markdown 挿入は SQL または bibweb の Extras タブから行えます：

```sql
-- 例: Claude による AI 要約を登録
INSERT INTO extras (entry_id, extra_key, extra_value)
SELECT id, 'md.digest', '## 概要\n...'
FROM entries WHERE cite_key = 'Knuth1984';
```

### Markdown レンダリング対応

| 機能 | 動作 |
|---|---|
| 通常の Markdown | marked.js によるオフラインレンダリング |
| 数式（`$...$` / `$$...$$`） | KaTeX（CDN 経由・ネットワーク必要） |
| Mermaid ダイアグラム | mermaid.js によるオフラインレンダリング |
| PlantUML | plantuml.com のパブリックサーバ（ネットワーク必要） |

## キャッシュの更新

UI やライブラリを最新版に更新するには：

```bash
bibweb --update
```

## bibdb との関係

bibweb は bibdb の DB スキーマに直接アクセスします。bibdb 本体のコードや動作には一切影響しません。

| | bibdb | bibweb |
|---|---|---|
| `.bib` のインポート | ✅（コンフリクト解決あり） | — |
| `.bib` のエクスポート | ✅ | ✅（選択エントリを GUI から） |
| フィールドの編集 | — | ✅ |
| extras の管理 | SQL 直接操作 | ✅ GUI から |
| 重複整理（dedup） | ✅ | — |
| Markdown 閲覧 | — | ✅ |

## ライセンス

MIT License
