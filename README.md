# bibweb

[bibdb](https://github.com/ugohsu/bibdb) が管理する SQLite データベースに Web ブラウザからアクセスするための GUI ツールです。

bibdb 本体のコード（CLI の動作）は変更しませんが、同じ DB ファイルを直接読み書きします。**図表メモ機能（後述）に限り、bibdb 側にも `figure_notes` テーブルと dedup/`.db` インポート時の統合ロジックを追加しています**。これは bibweb だけがテーブルを知っている状態だと、`bibdb dedup` や `bibdb import *.db` でエントリが統合されたときに図表メモが孤立・消失してしまうためです。それ以外の機能は従来どおり bibweb 側だけで完結しています。

## 特徴

- **1 ファイル配布**: `bibweb` スクリプトを `$PATH` の通ったディレクトリに置くだけで使えます
- **UI の自動取得**: 初回起動時に UI ファイル群を GitHub から `~/.cache/bibweb/` にダウンロードします
- **オフライン動作**: 2 回目以降は UI 本体・Markdown/Mermaid レンダリングはキャッシュから動作します（数式・PlantUML のレンダリングと、DOI からの文献取得は都度ネットワークが必要）
- **新規文献の登録**: DOI 貼り付けによる Crossref からの自動取得、または BibTeX の直接貼り付けから新規エントリを登録できます（詳細は後述）
- **読み書き対応**: BibTeX フィールドと `extras` を GUI から追加・編集・削除できます
- **図表・表のメモ**: 「Exhibits」タブ（Info タブと Markdown タブの間）で、論文中の図表のスクリーンショットをペースト/ドラッグ&ドロップで貼り付け、キャプションとメモを残せます。画像はリサイズせず、PNG パレット削減のみ行って保存します。表示順は後から並べ替えられます（詳細は後述）
- **タグ管理**: `extras` の `tags` キーを使ったタグ付け・絞り込みができます
- **ファイルリンク**: `extras` の `file` キーに登録した外部 URL（Dropbox・Google Drive・arXiv など）を開けます
- **Markdown レンダリング**: `extras` の `md.*` キーに格納した Markdown（論文・要約・翻訳など）を KaTeX・Mermaid・PlantUML つきで表示します
- **`.db` エクスポート**: 選択したエントリを `extras`・図表メモ（`figure_notes`）ごと bibdb 互換の SQLite ファイルとして書き出せます

## 必要要件

- Python 3.8+
- bibdb が作成した SQLite DB（デフォルト: `~/refs.db` または `$BIBDB_PATH`）
- 初回起動時のインターネット接続（UI・ライブラリファイルの取得に必要）
- 継続して使う機能によっては起動後もネットワークが必要です: 数式（KaTeX）・PlantUML のレンダリング、DOI からの文献取得（Crossref API）
- 任意: [Pillow](https://python-pillow.org/)（`pip install Pillow`）— 図表メモの画像を PNG パレット削減してから保存するために使う。無ければ削減せずそのまま保存する

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

- CiteKey・タイトル・著者でテキスト検索（fuzzy マッチ）
- 並び順: 「著者順」（yomi があればそれを、無ければ著者姓を使ったソート）と「追加順」（`added_at` 降順）をラジオボタンで切り替えられます
- タグフィルタ: 検索ボックスの下に表示されるアコーディオンからタグを選択してエントリを絞り込めます（複数選択時は AND 条件）
- 各エントリにタグがあればピルとして表示されます。ピルをクリックするとそのタグで絞り込みます
- チェックボックスで複数選択 → `.bib` または `.db` として書き出し・一括タグ追加
- ヘッダーの「＋ 新規登録」ボタンから新規エントリを登録できます（詳細は後述）

### エントリ詳細（右パネル）

**Info タブ**: BibTeX フィールドの表示・編集・削除・追加。タグの付け替え。ファイルリンクの一覧（`file` extra がある場合）。`extras` に `md.digest` キーがある場合は右側にダイジェストを並べて表示します。

**Exhibits タブ**: 論文中の図・表・数式のスクリーンショットにキャプションとメモを添えて保存できます（詳細は後述）。専用の `figure_notes` テーブルに保存され、`extras` には影響しません。

**Markdown タブ**: `extras` の `md.*` キーに格納した Markdown をレンダリング表示（`md.*` キーが存在する場合のみ表示）。

**Extras タブ**: `extras` テーブルの全行を表示・編集・削除・追加できる raw ビューです。`tags`・`file`・`md.*` キーも含めてすべて表示されます（図表メモは別テーブルのためここには表示されません）。

---

## 新規文献の登録

ヘッダーの「＋ 新規登録」ボタンから、以下の2通りの方法で新規エントリを登録できます。

- **DOI から取得**: DOI または `https://doi.org/...` 形式の URL を貼り付けて「Crossref から取得」を押すと、[Crossref API](https://api.crossref.org/) から BibTeX を自動取得します（ネットワーク接続が必要）。
- **BibTeX を直接貼り付け**: `@article{key, title={...}, ...}` 形式のテキストを直接貼り付けてパースします（1 件のみ。複数エントリを貼り付けた場合は先頭の 1 件だけを使い、複数登録は `bibdb import` を使うよう案内します）。

貼り付け後は以下が自動で行われます。

- **CiteKey の自動生成**: `{著者姓（yomi があればそれ、無ければローマ字化した姓）}_{年}_{タイトルの主要単語}` 形式で生成します。5 名以上の共著は「第一著者\_EtAl」に短縮します。既存キーと衝突する場合は末尾にアルファベットを付加します。手動で書き換えることもできます。
- **類似エントリの警告**: `bibdb dedup` と同じ基準（DOI 完全一致、またはタイトル類似度 ≥ 0.9）で、DB 内の既存エントリと似ていないかチェックし、見つかった場合は警告を表示します（登録はブロックされません）。
- 登録前にフィールドの追加・削除・編集、entry_type の変更が可能です。

---

## extras の特殊キー

bibweb は `extras` テーブルの一部のキーを予約済みとして特別扱いします。

| `extra_key` | 扱い |
|---|---|
| **`tags`** | **Info タブのタグセクションで管理**。1 エントリに複数行持てます（1 行 = 1 タグ）。Extras タブでも表示・編集・削除できます。 |
| **`file`** | **Info タブのファイルセクションに表示**。値には `http://` または `https://` で始まる URL を登録します。クリックで新タブが開きます。Extras タブでも編集・削除できます。 |
| **`md.digest`** | **Info タブに分割表示**。Info タブを開いたとき右側にダイジェストを並べて表示します。Markdown タブでも表示されます。 |
| `md.*`（`md.` で始まる全キー） | **Markdown タブで表示**。Extras タブでも編集・削除できます。 |

Extras タブは `extras` テーブルの raw ビューとして機能し、特殊キーを含む全行を編集・削除できます。

### ファイルリンクの登録

Dropbox・Google Drive・arXiv・機関リポジトリなど、任意の URL を登録できます。SQL または bibweb の Extras タブから登録します：

```sql
-- 例: Dropbox の共有リンクを登録
INSERT INTO extras (entry_id, extra_key, extra_value)
SELECT id, 'file', 'https://www.dropbox.com/scl/fi/xxxx/Knuth1984.pdf'
FROM entries WHERE cite_key = 'Knuth1984';
```

### Markdown コンテンツのキー命名規則

| `extra_key` | 用途 | bibweb での表示ラベル |
|---|---|---|
| `md.full` | フル論文 Markdown（opendataloader-pdf 等） | フル論文 |
| `md.full.ja` | フル論文の日本語訳 | フル論文（日本語） |
| `md.digest` | ダイジェスト・要約 | ダイジェスト |
| `md.*`（上記以外） | 用途に応じて自由に命名 | キー名をそのまま表示 |

extras への Markdown 挿入は SQL または bibweb の Extras タブから行えます：

```sql
-- 例: Claude による AI 要約を登録
INSERT INTO extras (entry_id, extra_key, extra_value)
SELECT id, 'md.digest', '## 概要\n...'
FROM entries WHERE cite_key = 'Knuth1984';
```

---

## 図表メモ（Exhibits タブ）

実証研究では表・図・数式の読解が本文の要約以上に重要になることが多いため、Info タブと Markdown タブの間に「Exhibits」タブを設け、論文中の図表を画像として直接貼り付けてメモを残せるようにしています。

- **貼り付け方法**: Exhibits タブ内をクリックしてフォーカスした状態で画像をペースト（Ctrl+V / Cmd+V）するか、画像ファイルをドラッグ&ドロップ、または「ファイルを選択」ボタンから選択します。
- **保存時の圧縮（PNG パレット削減・リサイズなし）**: 解像度は変えず、Pillow で PNG のパレット（色数）を削減してから SQLite の BLOB として保存します。文字・罫線中心の論文の図表スクリーンショットは実質的に使っている色数が少ないため、見た目の劣化はほぼ生じません（実測例: 780×761 の表画像で 140KB → 43KB、目視でも劣化を確認できませんでした）。カラー写真やグラデーションを含む図はこの限りではありません。削減後のほうが大きくなる場合や Pillow が無い環境では、元のバイト列をそのまま保存します。枚数が多くなると DB ファイルは大きくなっていくので、その点は変わらず注意してください。
- **キャプション・メモ**: 各画像に「ラベル」（例: `Fig. 3`, `Table 2`）と自由記述の「メモ」を付けられます。あとから編集できます。
- **表示順の変更**: カードの ↑ / ↓ ボタンで並び順を後から入れ替えられます。
- **拡大表示**: サムネイルをクリックすると原寸に近いサイズでライトボックス表示します。
- 保存先は `extras` とは別の専用テーブル `figure_notes` です（`extras` は値が TEXT のみの key-value テーブルで、画像バイナリや表示順を自然に表現できないため）。
- `.db` エクスポート/インポート、`bibdb dedup` によるエントリ統合でも、`extras` と同じ lossless 方針で図表メモが引き継がれます（bibdb 側の対応が必要なため、bibdb 本体にも `figure_notes` を認識させています。詳細は冒頭の説明と [bibdb の README](https://github.com/ugohsu/bibdb) を参照してください）。

### API（参考）

| Method | Path | 用途 |
|---|---|---|
| GET | `/api/entries/{cite_key}/figures` | 図表メモ一覧（画像本体は含まない） |
| GET | `/api/figures/{id}/image` | 画像本体の取得 |
| POST | `/api/entries/{cite_key}/figures` | 追加（`image_base64` で画像を送信） |
| PUT | `/api/figures/{id}` | ラベル・メモの更新 |
| PUT | `/api/entries/{cite_key}/figures/order` | 表示順の一括更新（`ids` に並び替え後の ID 配列） |
| DELETE | `/api/figures/{id}` | 削除 |

---

## Markdown レンダリング対応

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

bibweb は bibdb の DB スキーマに直接アクセスします。bibdb 本体の CLI としての動作は変更しませんが、図表メモ機能に限っては bibdb 側のスキーマ定義・dedup・`.db` インポートのロジックにも `figure_notes` を追加しています（冒頭の説明を参照）。

| | bibdb | bibweb |
|---|---|---|
| `.bib` のインポート | ✅（コンフリクト解決あり） | — |
| `.bib` のエクスポート | ✅ | ✅（選択エントリを GUI から） |
| `.db` のエクスポート | — | ✅（選択エントリを GUI から・extras / 図表メモごと） |
| フィールドの編集 | — | ✅ |
| 新規エントリの登録 | ✅（`.bib` インポート） | ✅（DOI 取得 / BibTeX 貼り付け） |
| extras の管理 | SQL 直接操作 | ✅ GUI から |
| 図表メモの管理 | — | ✅ GUI から（Exhibits タブ） |
| タグ管理 | — | ✅ GUI から |
| ファイルリンク | — | ✅ GUI から閲覧（登録は Extras タブ or SQL） |
| 重複整理（dedup） | ✅（`extras`・`figure_notes` とも lossless 統合） | — |
| Markdown 閲覧 | — | ✅ |

## ライセンス

MIT License
