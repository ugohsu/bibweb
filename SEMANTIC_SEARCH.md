# セマンティック検索 拡張案

## 概要

現在の検索（fzf スタイルの fuzzy マッチ）に加え、Transformer モデルを用いた意味的類似度検索を opt-in 機能として追加する案。

- `sentence-transformers` がインストールされているユーザは使える
- インストールされていないユーザには機能ごと非表示にする

---

## 現在の検索との比較

| | fuzzy 検索（現行） | セマンティック検索（拡張案） |
|---|---|---|
| 対象フィールド | `cite_key` / `title` / `author` | `title` / `abstract` / `md.digest` |
| マッチ方式 | 文字列の部分一致・順序 | ベクトルのコサイン類似度 |
| 「deep learning」→「neural network」 | ヒットしない | ヒットする |
| 日本語クエリで英語論文を検索 | 不可 | 多言語モデル使用時は可 |
| 依存ライブラリ | なし | `sentence-transformers`（＋PyTorch or ONNX Runtime） |
| 初回起動時のオーバーヘッド | なし | モデルロード＋インデックス構築（数秒〜数分） |

---

## 推奨モデル

| モデル名 | 特徴 | サイズ |
|---|---|---|
| `paraphrase-multilingual-MiniLM-L12-v2` | 日英両対応・バランス良好（**推奨デフォルト**） | 約 470 MB |
| `all-MiniLM-L6-v2` | 英語のみ・軽量 | 約 80 MB |
| `sonoisa/sentence-luke-japanese-base-lite` | 日本語特化 | 約 400 MB |

モデルは環境変数 `BIBWEB_SEMANTIC_MODEL` で切り替え可能にする予定。

---

## 埋め込み対象フィールド

各エントリについて以下を連結してベクトル化する：

1. `title`（BibTeX フィールド）
2. `abstract`（BibTeX フィールド、存在する場合）
3. `md.digest`（extras、先頭 2000 文字）

`md.full` は長大なため原則対象外（必要なら別途チャンク分割 + RAG 構成）。

---

## アーキテクチャ

### バックエンド（Python）

```
[bibweb 起動時]
  sentence-transformers が import できれば SemanticIndex を初期化
  → バックグラウンドスレッドでモデルロード＋インデックス構築
  → 完了後に status: "ready"

[新 API]
  GET  /api/capabilities           → { semantic_search: bool, semantic_status: str }
  POST /api/search/semantic        → [{ cite_key, score }, ...]
  POST /api/search/semantic/rebuild → インデックス再構築
```

- `status` は `"loading"` → `"ready"` または `"unavailable"` に遷移
- 埋め込みはメモリ上の numpy 配列で保持（起動のたびに再構築）
- 類似度計算はコサイン類似度（`normalize_embeddings=True` → 内積で代用可）

### フロントエンド（Vue / JS）

```
[マウント時]
  /api/capabilities を取得
  → semantic_search: true なら「意味検索」トグルを表示
  → status: "loading" の間は 2 秒ごとにポーリング

[意味検索モード ON + クエリ入力]
  400 ms デバウンス後に /api/search/semantic を呼び出し
  → 返ってきた cite_key リストの順に entries を並べ替えて表示
  → スコア（類似度 %）を各エントリに小バッジで表示

[空クエリのとき]
  全エントリをデフォルト順（added_at DESC）で表示
```

---

## 依存関係の分離方針

`sentence-transformers` は任意依存とし、bibweb 本体には追加しない。

```bash
# 使いたいユーザだけインストール
pip install sentence-transformers
```

PyTorch を避けたい場合は ONNX Runtime で代替できる：

```bash
pip install sentence-transformers[onnx]
```

（`SentenceTransformer(..., backend="onnxruntime")` で指定）

---

## 未解決の検討事項

- **インデックスの永続化**: 再起動のたびに再構築するか、SQLite BLOB や `sqlite-vec` 拡張に保存するか
- **インデックスの更新タイミング**: エントリ追加・編集時に自動再構築するか、手動（`/rebuild`）のみにするか
- **スコアのしきい値**: 低スコアのエントリを結果から除外するか、全件を類似度順に並べるか
- **fuzzy との併用（ハイブリッド）**: Reciprocal Rank Fusion 等で両方の結果をマージする案
