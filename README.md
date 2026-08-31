# bibweb

[bibdb](https://github.com/ugohsu/bibdb) が管理する SQLite データベースに Web ブラウザからアクセスするための GUI ツールです。

bibdb 本体のコード（CLI の動作）は変更しませんが、同じ DB ファイルを直接読み書きします。**図表メモ機能（後述）に限り、bibdb 側にも `figure_notes` テーブルと dedup/`.db` インポート時の統合ロジックを追加しています**。これは bibweb だけがテーブルを知っている状態だと、`bibdb dedup` や `bibdb import *.db` でエントリが統合されたときに図表メモが孤立・消失してしまうためです。それ以外の機能は従来どおり bibweb 側だけで完結しています。

逆に、**ローカル限定ファイルパス機能（後述）は意図的に bibdb 側に一切手を加えていません**。DB ファイルの置き場所に紐づく情報（PDF 本体への相対パスなど）は、`.db` エクスポートや `bibdb dedup`・`.db` インポートで別の場所に派生させた DB に持ち込まれると意味を失うため、逆に bibdb にその存在を一切感知させないことで、派生 DB への混入を防いでいます。

## 特徴

- **1 ファイル配布**: `bibweb` スクリプトを `$PATH` の通ったディレクトリに置くだけで使えます
- **UI の自動取得**: 初回起動時に UI ファイル群を GitHub から `~/.cache/bibweb/` にダウンロードします
- **オフライン動作**: 2 回目以降は UI 本体・Markdown/Mermaid レンダリングはキャッシュから動作します（数式・PlantUML のレンダリングと、DOI からの文献取得は都度ネットワークが必要）
- **新規文献の登録**: DOI 貼り付けによる Crossref からの自動取得、または BibTeX の直接貼り付けから新規エントリを登録できます（詳細は後述）
- **読み書き対応**: BibTeX フィールドと `extras` を GUI から追加・編集・削除できます
- **図表・表のメモ**: 「Exhibits」タブ（Info タブと Markdown タブの間）で、論文中の図表のスクリーンショットをペースト/ドラッグ&ドロップで貼り付け、キャプションとメモを残せます。画像はリサイズせず、PNG パレット削減のみ行って保存します。表示順は後から並べ替えられます（詳細は後述）
- **タグ管理**: `extras` の `tags` キーを使ったタグ付け・絞り込みができます
- **ファイルリンク**: `extras` の `file` キーに外部 URL（Dropbox・Google Drive・arXiv など）を Info タブから追加・閲覧・削除できます
- **ローカルPDFの表示**: DB ファイルの置き場所からの相対パスを専用テーブル（`local_extras`）に登録しておくと、Info タブから「PDFを開く」リンクとして開けます。表示専用（GUIからの追加・編集・削除は非対応）で、`.db` エクスポートや `bibdb dedup`/インポートの対象にも含まれません（詳細は後述）
- **Markdown レンダリング**: `extras` の `md.*` キーに格納した Markdown（論文・要約・翻訳など）を KaTeX・Mermaid・PlantUML つきで表示します。Info タブから貼り付け/ファイル読み込みで `md.*` を追加・上書きすることもできます
- **備考（note）**: `extras` の各行には自由記述の備考を1つ添えられます。ファイルリンクや `md.*` を複数登録する場合に、「元論文」「アノテーションあり」「研究会報告資料」のような用途を書き添えて、Info/Markdown/Extras タブに表示できます
- **`.db` エクスポート**: 選択したエントリを `extras`・図表メモ（`figure_notes`）ごと bibdb 互換の SQLite ファイルとして書き出せます
- **カスタムビュー**: 各プロジェクト側で作った文献横断的な静的HTML（マインドマップ・ダッシュボード等）を、ヘッダーの「カスタムビューを開く」から読み込み、別タブで表示できます。そのHTMLから`postMessage`で特定エントリを選択させられます（ページ遷移なし、詳細は後述）

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

**Info タブ**: BibTeX フィールドの表示・編集・削除・追加。セクションはタグ→ファイル→Markdownの順に並びます。タグの付け替え。ファイルリンクの一覧・追加・削除（`file` extra）、および登録されていればローカルPDFへの「開く」リンク（`local_extras`、表示専用・詳細は後述）。`md.*` extra のクイック追加（貼り付け or ファイル読み込み、詳細は後述）。`extras` に `md.digest` キーがある場合は右側にダイジェストを並べて表示します。

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
| **`file`** | **Info タブのファイルセクションで管理**（一覧・追加・削除）。値には `http://` または `https://` で始まる URL を登録します。クリックで新タブが開きます。1 エントリに複数行持てます（複数のリンクを登録可能）。Extras タブでも編集・削除できます。 |
| **`md.digest`** | **Info タブに分割表示**。Info タブを開いたとき右側にダイジェストを並べて表示します。Markdown タブでも表示されます。 |
| `md.*`（`md.` で始まる全キー） | **Info タブの Markdown セクションから追加・上書き**（詳細は後述）。**Markdown タブで表示**。Extras タブでも編集・削除できます。 |

Extras タブは `extras` テーブルの raw ビューとして機能し、特殊キーを含む全行を編集・削除できます。

**PDF本体のローカルパスなど、DBファイルの置き場所に依存する情報は `extras` には入れません。** 別テーブル `local_extras` で管理します（[ローカル限定ファイルパス](#ローカル限定ファイルパスlocal_extras)を参照）。

### 備考（`note` カラム）

`extras` の各行（`tags` を除く `file`・`md.*`・その他すべて）には、`extra_value` とは別に自由記述の備考を1つ持たせられます。同じ `extra_key`（例: `file`、あるいは複数登録した `md.*`）を何行も積む運用のときに、それぞれの用途（元論文・アノテーションあり・研究会報告資料、など）を書き添えるためのものです。

- **ファイルリンク**: Info タブの各リンクの下に表示され、📝 ボタンまたは備考テキストのクリックで編集できます。
- **`md.*`**: Info タブの Markdown クイック追加フォーム、Markdown タブの各キーの上部、Info タブのダイジェスト欄に表示されます。
- **Extras タブ**: 値の下に表示され、編集モードでは値と一緒に編集できます。
- `bibdb dedup` / `.db` インポートの重複判定（lossless マージ）には使われません。値（`extra_value`）が同じであれば備考が違っても1行に統合されます。

**既存 DB への追加が必要**: `note` カラムは `figure_notes` テーブルのように bibweb 起動時に自動追加はされません。古い（`note` カラムを持たない）`refs.db` に対して bibweb を実行すると、エントリの Info タブを開いた時点で `no such column: note` エラーになります。事前に `ALTER TABLE extras ADD COLUMN note TEXT;` を一度だけ実行しておいてください。

### ファイルリンクの登録

Dropbox・Google Drive・arXiv・機関リポジトリなど、任意の URL を登録できます。

- **Info タブから**: 「ファイル」セクションの入力欄に URL を貼り付けて「追加」を押すだけです（`http://`/`https://` 以外は拒否されます）。1 エントリに複数件登録でき、既存のリンクはそのまま残ります（常に追加）。一覧の 🗑️ ボタンから削除できます。
- **CLI から**（一括登録や既存データの移行など）: `bibdb set-extra` を使います。`file` は複数行を許容するキーなので `--append` を付けてください（[bibdb の README](https://github.com/ugohsu/bibdb) 参照）。

```bash
# 例: Dropbox の共有リンクを登録
echo 'https://www.dropbox.com/scl/fi/xxxx/Knuth1984.pdf' | bibdb set-extra Knuth1984 file --append
```

### Markdown コンテンツのキー命名規則

| `extra_key` | 用途 | bibweb での表示ラベル |
|---|---|---|
| `md.full` | フル論文 Markdown（opendataloader-pdf 等） | フル論文 |
| `md.full.ja` | フル論文の日本語訳 | フル論文（日本語） |
| `md.digest` | ダイジェスト・要約 | ダイジェスト |
| `md.*`（上記以外） | 用途に応じて自由に命名 | キー名をそのまま表示 |

### Info タブからの `md.*` 追加

Extras タブで `extra_key`/`extra_value` を直打ちしなくても、Info タブの「Markdown」セクションにある「＋ md.* 追加」から登録できます。

- **key**: デフォルトは `md.digest`。入力欄はテキストなので `md.full` など他の `md.*` キーにも自由に変更できます（`md.` で始まらないキーはエラーになります）。
- **value**: テキストエリアに直接貼り付けるか、「ファイルから読み込む」ボタンでローカルの `.md`/`.txt` ファイルを選択すると、その内容がそのままテキストエリアに読み込まれます（ファイルの中身をテキストとして読むだけで、`file` キーのような URL 登録とは別物です）。
- **既存キーとの関係**: `md.*` は「1 エントリにつき 1 つの値」という運用を前提にしているため、指定した key が既に存在する場合は常に**上書き**されます（`file`/`tags` のように複数値を積み増す挙動とは逆です）。上書きになる場合はボタンのラベルが「上書き保存」に変わり、警告文が表示されます。フォームは既存の内容を読み込まず空欄から始まるため、**備考（note）も含めて上書き**されます（空欄のまま保存すると既存の備考も消えます）。既存の値・備考を活かしたまま片方だけ直したい場合は Extras タブから編集してください。

エージェント型AIに要約を作らせてそのまま流し込みたい場合は、GUIを介さず `bibdb set-extra` を使うほうが手軽です（[bibdb の README](https://github.com/ugohsu/bibdb) 参照）。

extras への Markdown 挿入は `bibdb set-extra` または bibweb の Info/Extras タブから行えます：

```bash
# 例: Claude による AI 要約を登録
claude -p "Knuth1984.pdf を要約して" | bibdb set-extra Knuth1984 md.digest

# 既存の md.digest を上書きする場合
claude -p "..." | bibdb set-extra Knuth1984 md.digest --replace
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

## ローカル限定ファイルパス（local_extras）

PDF本体をDropbox等で同期し、DBファイル（`refs.db`）と同じ構成で持ち歩く運用の場合、「DBファイルを起点とした相対パス」は環境をまたいでも意味を持ちます。しかし、これを `extras` に入れてしまうと、`.db` エクスポートや `bibdb dedup`／`.db` インポートで**別の場所に派生させたDB**にまで、その環境では意味を持たない相対パスが紛れ込んでしまいます。この問題を避けるため、`extras` とは別の専用テーブル `local_extras`（スキーマは `extras` と同じ: `entry_id`/`extra_key`/`extra_value`/`note`、`entry_id` は `ON DELETE CASCADE`）を用意し、扱いを明確に分けています。

- **bibdbからは一切参照されません**: dedup・`.bib`/`.db` インポートは `entries`/`fields`/`extras`/`figure_notes` という決め打ちのテーブル名しか見ないため、`local_extras` はコード変更なしに自動的に無視されます（bibdb本体は無改修です）。
- **bibwebの `.db` エクスポートにも含まれません**: コピー対象テーブルを明示的に列挙している実装のため、`local_extras` は対象外です。
- **`bibdb dedup` でエントリが統合されるとき**、削除される側の `local_extras` 行は `ON DELETE CASCADE` でそのまま消えます。`extras`/`figure_notes` のような「残る側への再アサイン」は行いません（同一DB内での重複整理をほぼ行わない運用であれば実害は小さい想定です）。
- **GUIからの追加・編集・削除はサポートしていません**（Info タブでは表示専用）。登録はスクリプトや `sqlite3` での直接 `INSERT` で行う運用を想定しています。

### 使用中のキー

| `extra_key` | 用途 | Info タブでの表示ラベル |
|---|---|---|
| `pdf_path` | DBファイルのディレクトリを起点とした、PDF本体への相対パス | PDFを開く |

### 登録方法（GUI外）

`local_extras` テーブルは、対象DBに対して `bibweb` を一度でも起動すれば自動的に作成されます（`figure_notes` と同様、既存の古いDBにも自動追加されます）。登録はSQLで直接行ってください。

```bash
# 例: cite_key が Smith_2024_disclosure のエントリに pdf_path を登録
sqlite3 refs.db "
  INSERT INTO local_extras (entry_id, extra_key, extra_value)
  SELECT id, 'pdf_path', 'papers/TAR/2024/TAR_2024_v99n1_1475-679X.12345.pdf'
  FROM entries WHERE cite_key = 'Smith_2024_disclosure';
"
```

### API（参考）

| Method | Path | 用途 |
|---|---|---|
| GET | `/api/entries/{cite_key}/local-file/{extra_key}` | 相対パスをDBファイルのディレクトリを起点に解決し、ファイル本体を返す。ディレクトリトラバーサル対策あり（解決後のパスがDBディレクトリ外に出る場合・ファイルが存在しない場合は404） |

---

## エントリへの直接リンク（ディープリンク）

`/?entry=<cite_key>` の形式でアクセスすると、起動時にそのエントリを自動選択して詳細パネルを開きます。特定の論文へのリンクを人に共有する場合や、後述のカスタムビューが `window.opener` を使えない状況（bibwebをまだ開いていない等）でのフォールバックとして使う入口です。

```
http://localhost:8766/?entry=Smith_2024_disclosure
```

対象の `cite_key` が DB に存在しない場合は何も起きず、通常のエントリ一覧が表示されます。**書誌数が多いDBではこの方式は`loadEntries()`のやり直し等でエントリ選択が重くなるため、bibweb自身が開いているカスタムビューからのリンクには使わず、後述のpostMessage方式を使ってください。**

## カスタムビュー（外部HTMLを別タブで表示）

bibweb は特定のプロジェクト（journal_library 等）に特化させないという方針のため、「大分類ごとの研究動向マインドマップ」のような文献横断的な分析ビューは bibweb 本体には実装せず、**各プロジェクト側が自己完結の単一HTMLとして生成したものを、ヘッダーの「📄 カスタムビューを開く」からユーザーが都度選んで表示する**、という形にしています。

- 選んだファイルはブラウザの `File`/`FileReader` API でテキストとして読み込むだけで、**bibweb のサーバー側は一切ファイルパスを受け取りません**（サーバーが任意のローカルパスを読みにいく設計だと、パストラバーサル等の新たなリスクを負うことになるため、意図的にこの方式を避けています）。
- 読み込んだHTMLは `Blob` 化して `URL.createObjectURL()` で得たURLを `window.open(url, 'bibweb-custom-view')` に渡し、**別タブとして開きます**（同じターゲット名を使うため、開きっぱなしのタブがあれば使い回されます）。bibweb本体のタブ・カスタムビューのタブのどちらも操作できる状態を保てるので、文献横断的な確認と個々のエントリ閲覧を行き来しやすくなっています。
- Blob URLは生成元（bibweb自身）と同一オリジン扱いになるため、カスタムビュー側から `window.opener`（bibweb本体のタブ）へ `postMessage` で通知できます。特定の論文へリンクするには、次のように「ページ遷移せずに `postMessage` する」形にしてください（`/?entry=...` へのフルページ遷移は使わない）。
  ```js
  function openInBibweb(citeKey) {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: 'bibweb:select-entry', cite_key: citeKey }, window.opener.location.origin);
      window.opener.focus();
    }
  }
  ```
  bibweb側は `message` イベントで `{ type: 'bibweb:select-entry', cite_key }` を受け取ると、ページ遷移なしで `selectEntry()` を直接呼びます（一覧クリックと同じ経路・同じ速さで、`loadEntries()` のやり直しは発生しません）。書誌数が多いDBほど、この方式と `/?entry=...` フルページ遷移との体感速度の差は大きくなります。
- カスタムビューのHTML自体は完全に自己完結（データ・CSS・JSをすべてインライン化）である必要があります。相対パスで別ファイル（`./chart.js` 等）を参照する構成は `Blob` 経由の表示では読み込めません。
- カスタムビューが使うデータ（トピック分類・タグ集計等）をどう用意するかは各プロジェクト側の責務です。bibweb はそのデータの意味を一切解釈しません。

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

bibweb は bibdb の DB スキーマに直接アクセスします。bibdb 本体の CLI としての動作は変更しませんが、図表メモ機能に限っては bibdb 側のスキーマ定義・dedup・`.db` インポートのロジックにも `figure_notes` を追加しています（冒頭の説明を参照）。逆にローカル限定ファイルパス機能（`local_extras`）は bibdb 側に一切手を加えておらず、bibdb からは存在ごと感知されません（[ローカル限定ファイルパス](#ローカル限定ファイルパスlocal_extras)を参照）。

| | bibdb | bibweb |
|---|---|---|
| `.bib` のインポート | ✅（コンフリクト解決あり） | — |
| `.bib` のエクスポート | ✅ | ✅（選択エントリを GUI から） |
| `.db` のエクスポート | — | ✅（選択エントリを GUI から・extras / 図表メモごと。`local_extras` は含まれません） |
| フィールドの編集 | — | ✅ |
| 新規エントリの登録 | ✅（`.bib` インポート） | ✅（DOI 取得 / BibTeX 貼り付け） |
| extras の管理 | SQL 直接操作 / `set-extra`（書き込み専用） | ✅ GUI から |
| 図表メモの管理 | — | ✅ GUI から（Exhibits タブ） |
| タグ管理 | — | ✅ GUI から |
| ファイルリンク | — | ✅ GUI から閲覧・追加・削除（Info タブ） |
| ローカルPDFパス（`local_extras`） | — （意図的に非対応。SQL直接操作のみ） | ✅ GUI から閲覧のみ（Info タブ、追加/編集/削除は非対応） |
| 重複整理（dedup） | ✅（`extras`・`figure_notes` は lossless 統合、`local_extras` は対象外でcascade削除） | — |
| Markdown 閲覧 | — | ✅ |

## ライセンス

MIT License
