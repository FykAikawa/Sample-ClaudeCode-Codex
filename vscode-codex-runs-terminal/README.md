# Codex Runs Terminal

Codex CLI が新しく作成した実行ログを VSCode の統合ターミナルで追従表示する、ビルド不要の JavaScript 拡張機能です。VSCode 1.90.0 以降で使用できます。

## 機能

- 各ワークスペースルートの `.codex-runs/<task-id>/<name>.log` の新規作成を監視します。さらに深い階層やルート以外の `.codex-runs` は対象外です。
- `Codex: <task-id>/<ファイル名>` というターミナルを開き、ログの先頭から既存内容と追記を表示します。エディタのフォーカスは維持します。
- 同じファイルのターミナルが開いていれば再利用します。閉じた後は、手動コマンドや同じファイルの再作成によって新しいターミナルを開けます。
- 起動時の既存ログや既存ログへの追記だけでは自動表示しません。ログはファイルの新規作成時に開かれます。
- コマンドパレットの **Codex Runs: Open Log in Terminal** から既存ログを選べます。更新日時の新しい順に並び、同じ日時ならタスク ID / ファイル名順です。複数ルートの場合はワークスペース名も表示します。
- ワークスペースフォルダーの追加・削除に合わせて監視を開始・解除します。

Windows では `powershell.exe -NoProfile -Command` を使い、コンソールと出力のエンコーディングを UTF-8 に設定して `Get-Content -LiteralPath '<path>' -Wait -Encoding UTF8` を実行します。パス中のシングルクオートは二重化します。それ以外では `/bin/sh -c` から `tail -n +1 -F '<path>'` を実行し、シングルクオートを安全に分割して引用します。コマンドはターミナル作成時の `shellPath` / `shellArgs` で渡します。

Windows では PowerShell、Linux / macOS などでは `/bin/sh` と `tail` が必要です。ログは UTF-8 を想定しています。拡張機能はワークスペース側で動くため、リモート接続では拡張機能が動く環境の OS とファイルパスを使用します。

## 設定

`codexRunsTerminal.autoOpen` は boolean、初期値は `true` です。ユーザー・ワークスペース・フォルダーの設定で変更できます。変更は次の新規作成イベントから反映されます。

```json
{
  "codexRunsTerminal.autoOpen": false
}
```

`false` にしてもコマンドパレットからはログを開けます。既に開いたターミナルはそのまま追従を続けます。

## テストと VSIX の生成

リポジトリのルートで、Node.js（`node:test` 対応版）と Python 3 を使って次を実行します。npm パッケージやネットワーク接続は不要です。

```text
node --test vscode-codex-runs-terminal/test/
node -e "require('./vscode-codex-runs-terminal/src/lib.js')"
python vscode-codex-runs-terminal/build_vsix.py
python -c "import zipfile; print('\n'.join(zipfile.ZipFile('vscode-codex-runs-terminal/dist/codex-runs-terminal-0.0.1.vsix').namelist()))"
```

生成先は `vscode-codex-runs-terminal/dist/codex-runs-terminal-0.0.1.vsix` です。VSIX にはマニフェスト、`package.json`、`README.md`、`src/` の JavaScript だけを含め、テストやビルドスクリプトは含めません。

`test/index.js` は、テストディレクトリをモジュールとして解決する Node.js でも上記の `node --test .../test/` を実行できるようにする入口です。テスト本体は `test/lib.test.js` にあります。

## レビュー後のインストール

VSCode の拡張機能ビューのメニューから **Install from VSIX...**（VSIX からのインストール）を選び、生成した VSIX を指定します。CLI を使う場合は、レビュー後にリポジトリのルートで次を実行できます。

```text
code --install-extension vscode-codex-runs-terminal/dist/codex-runs-terminal-0.0.1.vsix
```

実装・ビルド作業ではインストールを行いません。インストール後は必要に応じてウィンドウを再読み込みしてください。拡張機能は `.codex-runs` を含むワークスペース、または起動完了時に有効化されます。

## VSCode 上での手動確認

1. ワークスペース内に `.codex-runs/manual/first.log` を新規作成し、自動表示・ターミナル名・エディタのフォーカス維持を確認します。
2. UTF-8 の日本語をログに追記し、追従表示を確認します。
3. コマンドから同じログを開き、ターミナルが増えないことを確認します。閉じてから再度開き、再作成も確認します。
4. `autoOpen` を `false` にして別のログを新規作成し、自動では開かず、コマンドから開けることを確認します。
5. 空白・シングルクオートを含むパス、複数ルート、フォルダーの追加・削除について確認します。

Node のテストでは VSCode API を模擬して監視・重複防止・コマンド等を確認します。実際の VSCode のフォーカス、シェル起動、継続的な追従表示は上記の手動確認が必要です。
