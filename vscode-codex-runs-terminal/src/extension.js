'use strict';

const vscode = require('vscode');
const { parseRunLogPath, terminalName, tailCommand, sortRunLogs } = require('./lib');

const logGlob = '.codex-runs/*/*.log';
const terminals = new Map();
const watchers = new Map();

function activate(context) {
  function openLog(uri) {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const parsed = folder && parseRunLogPath(folder.uri.fsPath, uri.fsPath);
    if (!parsed) {
      return;
    }

    const key = uri.toString();
    let terminal = terminals.get(key);
    if (!terminal) {
      terminal = vscode.window.createTerminal({
        name: terminalName(parsed.taskId, parsed.fileName),
        ...tailCommand(uri.fsPath, process.platform),
      });
      terminals.set(key, terminal);
    }
    terminal.show(true);
  }

  function reportError(error) {
    vscode.window.showErrorMessage(`Codex 実行ログを開けませんでした: ${error.message || error}`);
  }

  function watchFolder(folder) {
    const key = folder.uri.toString();
    if (watchers.has(key)) {
      return;
    }

    // Only creation events; writes to an existing log must not reopen its terminal.
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, logGlob), false, true, true,
    );
    watcher.onDidCreate((uri) => {
      if (vscode.workspace.getConfiguration('codexRunsTerminal', uri).get('autoOpen', true)) {
        try {
          openLog(uri);
        } catch (error) {
          reportError(error);
        }
      }
    });
    watchers.set(key, watcher);
  }

  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((terminal) => {
      for (const [key, tracked] of terminals) {
        if (tracked === terminal) {
          terminals.delete(key);
        }
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders((event) => {
      for (const folder of event.removed) {
        const key = folder.uri.toString();
        const watcher = watchers.get(key);
        if (watcher) {
          watcher.dispose();
          watchers.delete(key);
        }
      }
      for (const folder of event.added) {
        watchFolder(folder);
      }
    }),
    vscode.commands.registerCommand('codexRunsTerminal.openLog', async () => {
      try {
        const groups = await Promise.all((vscode.workspace.workspaceFolders || []).map(async (folder) => {
          const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, logGlob), null);
          return Promise.all(uris.map(async (uri) => {
            const parsed = parseRunLogPath(folder.uri.fsPath, uri.fsPath);
            if (!parsed) {
              return null;
            }
            try {
              const stat = await vscode.workspace.fs.stat(uri);
              if (stat.type & vscode.FileType.Directory) {
                return null;
              }
              return { ...parsed, uri, mtime: stat.mtime, workspaceName: folder.name };
            } catch {
              // The file can disappear between findFiles and stat.
              return null;
            }
          }));
        }));
        const logs = sortRunLogs(groups.flat().filter(Boolean));
        if (!logs.length) {
          vscode.window.showInformationMessage('ワークスペース内に Codex 実行ログがありません。');
          return;
        }
        const picked = await vscode.window.showQuickPick(logs.map((log) => ({
          label: `${log.taskId}/${log.fileName}`,
          description: log.workspaceName,
          uri: log.uri,
        })), {
          placeHolder: '表示する Codex 実行ログを選択してください（更新日時の新しい順）',
          matchOnDescription: true,
        });
        if (picked) {
          openLog(picked.uri);
        }
      } catch (error) {
        reportError(error);
      }
    }),
    new vscode.Disposable(deactivate),
  );

  for (const folder of vscode.workspace.workspaceFolders || []) {
    watchFolder(folder);
  }
}

function deactivate() {
  for (const watcher of watchers.values()) {
    watcher.dispose();
  }
  watchers.clear();
  for (const terminal of terminals.values()) {
    terminal.dispose();
  }
  terminals.clear();
}

module.exports = { activate, deactivate };
