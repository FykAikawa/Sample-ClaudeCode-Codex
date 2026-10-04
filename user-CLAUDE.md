## Codexとの分担

- Claudeは要件整理、設計、タスク分割、レビューを担当する。
- 実装と実装に必要なテストはCodex CLIへ依頼する。
- 依頼ごとに .codex-runs/<task-id>/task.md を作成する。
- task.mdには目的、変更範囲、禁止事項、受け入れ条件、
  実行するテスト、最終報告に含める内容を記載する。
- Codexはメイン会話のBashツールから
  run_in_background: true で起動する。
- Codexは `--json` 付きで起動し、出力は要約フィルタを通して
  .codex-runs/<task-id>/codex.log に書く（コード本文はログに出さない）。
  元のJSONLは codex.jsonl、標準エラーは codex-stderr.txt に残す。
  ```
  codex exec --json ... -o .codex-runs/<id>/final.md "<prompt>" \
    < /dev/null 2> .codex-runs/<id>/codex-stderr.txt \
    | tee .codex-runs/<id>/codex.jsonl \
    | python ~/.claude/tools/codex_log_summary.py --root . \
    > .codex-runs/<id>/codex.log; echo "EXIT=${PIPESTATUS[0]}"
  ```
- Codexの実行中は、依頼対象のファイルをClaudeが編集しない。
- 完了通知を受けたら、追加のユーザー指示を待たずに
  終了結果、最終報告、変更されたファイルの内容、テスト結果を確認する。
- 問題があれば具体的な修正内容をCodexへ再依頼する。
  修正依頼は最大2回とし、残る問題はユーザーへ報告する。
- コミット、push、PR作成は別途指示された場合に行う。
