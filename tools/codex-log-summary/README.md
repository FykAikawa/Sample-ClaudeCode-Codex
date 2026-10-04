# Codex 実行ログの要約フィルタ

`codex exec --json` の JSONL を標準入力から読み、進捗を追うための短い日本語ログを標準出力へ書きます。Python 3.10 以上と標準ライブラリだけで動きます。

## 使い方

リポジトリのルートから Bash で実行します。

```bash
codex exec --json ... < /dev/null 2> .codex-runs/<id>/codex-stderr.txt \
  | tee .codex-runs/<id>/codex.jsonl \
  | python tools/codex-log-summary/codex_log_summary.py > .codex-runs/<id>/codex.log
```

`.codex-runs/<id>/` は事前に用意してください。VSCode のターミナルで追従表示する例:

```powershell
Get-Content -LiteralPath .codex-runs/<id>/codex.log -Encoding UTF8 -Wait
```

変更されたファイルの相対パスの基準は、既定でフィルタを実行したカレントディレクトリです。別のディレクトリを基準にする場合は `--root` を指定します。

```bash
python tools/codex-log-summary/codex_log_summary.py --root /path/to/project < codex.jsonl
```

入力・出力の文字コードを UTF-8 に設定するため、Windows の cp932 設定にも依存しません。不正な入力バイトは `�` に置換して続行し、出力側の変換不能な文字も置換します。出力の改行は LF です。入力が途中で終わった場合も、最後の行まで処理して終了コード 0 で終了します。

## 要約のルール

- 各出力行に、イベントを処理した時点のローカル時刻 `[HH:MM:SS]` を付けます。1 イベントで複数行出す場合は、すべて同じ時刻です。非表示のイベントや壊れた JSON 行を含め、入力の各行を処理した後に必ず `flush()` します。
- エージェントの完了メッセージは、改行を空白 1 つに連結して最大 300 文字に要約します。空行と各行の前後の空白は除去します。推論は表示しません。
- コマンドは完了イベントでだけ表示します。引用された実行ファイルのパスにも対応し、PowerShell / pwsh の `-Command` / `-c`、bash などの `-lc` / `-c` から中身を取り出します。コマンド文字列を実行することはありません。
- コマンド本文は **1 行目だけ**を最大 120 文字で表示し、残りの行数を ` (+N行)` で示します。末尾の改行だけでは行数を増やしません。外側が想定外、または引用が壊れている場合も元の文字列の 1 行目だけに制限します。
- コマンドの `status` が `failed`、または終了コードが非ゼロなら失敗です。失敗時だけ出力の末尾 5 行を各行最大 200 文字で表示します。成功時のコマンド出力は表示しません。
- 変更ファイルは先頭 6 件を表示し、残りは `ほか N 件` と示します。Windows と POSIX のパスを扱い、同じファイルシステムでは基準外のパスも `../` を使って相対化します。Windows の別ドライブなど相対化できないパスは絶対パスを残します。表示の区切りは `/` に統一します。
- TODO は項目のテキスト・完了状態・順序が前回から変わった場合だけ表示します。先頭の未完了項目を示し、全件完了または空リストの場合は `(未完了なし)` と表示します。
- 検索、MCP ツール、エラー、ターンの完了・失敗も要約します。未知のイベントや項目の type は無視し、JSON として読めない行は `·` に続けて最大 200 文字で表示します。

文字数の上限は末尾の `…` を含みます。コマンドの行数表記、各種接頭辞、時刻は上限に含めません。エージェント・コマンド・ファイル変更・検索・MCP の表示は `item.completed` に限定し、コマンドと MCP の `in_progress` / `declined` は表示しません。TODO と項目エラーは `item.started` / `item.updated` でも処理します。

欠落した文字列は空文字列、識別子や終了コードは `?`、トークン数は `0`、エラー本文は `不明なエラー` として扱います。完了イベントで `status` が欠落した場合は完了として処理し、コマンドの非ゼロ終了コードは失敗として扱います。不正な型の項目も処理を止めません。

## 合成 JSONL の出力例

[tests/fixtures/all-items.jsonl](tests/fixtures/all-items.jsonl) は全 `item.type` を網羅した合成ログです。検索や MCP 呼び出しも入力イベントとして用意したもので、フィルタ自身はネットワークやツールにアクセスしません。以下はこのフィクスチャを通した出力例です（時刻を `12:34:56` に固定）。

```text
[12:34:56] ▶ 開始 thread=demo-thread
[12:34:56] ☑ TODO 0/2: 要約フィルタを実装
[12:34:56] 💬 要約フィルタを実装します。 完了後にテストします。
[12:34:56] $ python -m unittest  → OK
[12:34:56] $ Set-Content example.py @' (+2行)  → OK
[12:34:56] $ python broken.py  → 失敗 (exit 1)
[12:34:56]     | Traceback (most recent call last):
[12:34:56]     |   File "broken.py", line 1
[12:34:56]     |     missing_name()
[12:34:56]     |     ^^^^^^^^^^^^
[12:34:56]     | NameError: name 'missing_name' is not defined
[12:34:56] ✎ 変更: add src/a.py, update src/b.py, delete old.py
[12:34:56] ☑ TODO 1/2: テストを実行
[12:34:56] 🔎 検索: Python 標準ライブラリ JSONL
[12:34:56] 🔧 demo.read_file → OK
[12:34:56] 🔧 demo.write_file → 失敗
[12:34:56] ⚠ ツールの入力が不正です。
[12:34:56] ⚠ 接続が中断しました。
[12:34:56] ✖ 失敗: 再試行が必要です。
[12:34:56] ☑ TODO 2/2: (未完了なし)
[12:34:56] ■ 完了 tokens: in=1200 (cached 800) out=250
```

## テスト

```bash
python -m unittest discover -s tools/codex-log-summary/tests -v
python tools/codex-log-summary/codex_log_summary.py < .codex-runs/004-codex-log-summary/sample-real.jsonl
```

PowerShell では `<` による標準入力リダイレクトが使えないため、2 つ目は以下のように cmd 経由で実行できます。

```powershell
cmd /d /c "python tools/codex-log-summary/codex_log_summary.py < .codex-runs/004-codex-log-summary/sample-real.jsonl"
```

実ログと合成ログの出力を、時刻を除いて期待値と照合します。シェルの外側の除去、コードを含む複数行コマンドの抑制、文字数の制限、失敗時の末尾 5 行、パスの相対化、TODO の変化、未知・欠落・壊れた入力、UTF-8 の置換、イベントごとの flush、途中終了を検証します。

テストから利用する主な関数は `summarize_command(command)`、`format_event(event, SummaryState(...))`、`process_stream(input_stream, output_stream, state, now=...)` です。`format_event` は時刻を含まない行のリストを返し、`process_stream` が時刻の付加と flush を行います。
