'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const lib = require('../src/lib');
const { parseRunLogPath, terminalName, tailCommand, sortRunLogs } = lib;

test('parseRunLogPath accepts direct POSIX run logs', () => {
  assert.deepEqual(parseRunLogPath('/work/repo', '/work/repo/.codex-runs/002/codex.log'), {
    taskId: '002', fileName: 'codex.log',
  });
  assert.deepEqual(parseRunLogPath('/work/my repo/', '/work/my repo/.codex-runs/日本語/修正 1.log'), {
    taskId: '日本語', fileName: '修正 1.log',
  });
  assert.deepEqual(parseRunLogPath('/', '/.codex-runs/002/codex.log'), {
    taskId: '002', fileName: 'codex.log',
  });
});

test('parseRunLogPath supports Windows separators, drive casing and UNC paths', () => {
  assert.deepEqual(parseRunLogPath('C:\\Work\\Repo', 'c:\\work\\repo\\.codex-runs\\002\\codex.log'), {
    taskId: '002', fileName: 'codex.log',
  });
  assert.deepEqual(parseRunLogPath('C:/Work/Repo/', 'C:\\Work\\Repo\\.codex-runs\\002/codex-fix1.log'), {
    taskId: '002', fileName: 'codex-fix1.log',
  });
  assert.deepEqual(parseRunLogPath('\\\\server\\share\\repo', '\\\\server\\share\\repo\\.codex-runs\\002\\codex.log'), {
    taskId: '002', fileName: 'codex.log',
  });
});

test('parseRunLogPath rejects extensions, wrong depth and paths outside the workspace', () => {
  const rejected = [
    '/work/repo/.codex-runs/002/codex.txt',
    '/work/repo/.codex-runs/002/codex.LOG',
    '/work/repo/.codex-runs/002/.log',
    '/work/repo/.codex-runs/codex.log',
    '/work/repo/.codex-runs/002/nested/codex.log',
    '/work/repo/nested/.codex-runs/002/codex.log',
    '/work/other/.codex-runs/002/codex.log',
    '/work/repo-other/.codex-runs/002/codex.log',
    '/work/repo/../other/.codex-runs/002/codex.log',
    '.codex-runs/002/codex.log',
    '', null, undefined,
  ];
  for (const file of rejected) {
    assert.equal(parseRunLogPath('/work/repo', file), null, String(file));
  }
  assert.equal(parseRunLogPath('C:\\Work\\Repo', 'D:\\Work\\Repo\\.codex-runs\\002\\codex.log'), null);
  assert.equal(parseRunLogPath('C:\\Work\\Repo', 'C:\\Work\\Repo-other\\.codex-runs\\002\\codex.log'), null);
  assert.equal(parseRunLogPath('repo', 'repo/.codex-runs/002/codex.log'), null);
  assert.equal(parseRunLogPath(null, '/work/repo/.codex-runs/002/codex.log'), null);
});

test('terminalName uses the required task/file format', () => {
  assert.equal(terminalName('001-dlsite-genres', 'codex.log'), 'Codex: 001-dlsite-genres/codex.log');
});

test('tailCommand uses PowerShell UTF-8 and literal single-quote escaping on Windows', () => {
  const prefix = '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); '
    + '$OutputEncoding = [Console]::OutputEncoding; ';
  assert.deepEqual(tailCommand('C:\\repo\\codex.log', 'win32'), {
    shellPath: 'powershell.exe',
    shellArgs: ['-NoProfile', '-Command', prefix + "Get-Content -LiteralPath 'C:\\repo\\codex.log' -Wait -Encoding UTF8"],
  });
  assert.deepEqual(tailCommand("C:\\my repo\\O'Brien\\日本語 [1] $(example)`x.log", 'win32'), {
    shellPath: 'powershell.exe',
    shellArgs: ['-NoProfile', '-Command', prefix
      + "Get-Content -LiteralPath 'C:\\my repo\\O''Brien\\日本語 [1] $(example)`x.log' -Wait -Encoding UTF8"],
  });
});

test('tailCommand uses sh and quotes spaces, apostrophes and shell metacharacters on Linux', () => {
  assert.deepEqual(tailCommand('/repo/codex.log', 'linux'), {
    shellPath: '/bin/sh', shellArgs: ['-c', "tail -n +1 -F '/repo/codex.log'"],
  });
  const escaped = {
    shellPath: '/bin/sh',
    shellArgs: ['-c', "tail -n +1 -F '/my repo/O'\\''Brien/$(example);`x`.log'"],
  };
  assert.deepEqual(tailCommand("/my repo/O'Brien/$(example);`x`.log", 'linux'), escaped);
  assert.deepEqual(tailCommand("/my repo/O'Brien/$(example);`x`.log", 'darwin'), escaped);
});

test('sortRunLogs orders by newest mtime then label without changing its input', () => {
  const logs = [
    { taskId: '002', fileName: 'z.log', mtime: 10 },
    { taskId: '003', fileName: 'codex.log', mtime: 20 },
    { taskId: '002', fileName: 'a.log', mtime: 10 },
  ];
  const original = [...logs];
  assert.deepEqual(sortRunLogs(logs), [logs[1], logs[2], logs[0]]);
  assert.deepEqual(logs, original);
});

// The extension is evaluated with a small in-memory VSCode API, without installing it.
function extensionFixture() {
  class Disposable {
    constructor(callback) { this.callback = callback; this.disposed = false; }
    dispose() {
      if (!this.disposed) {
        this.disposed = true;
        this.callback();
      }
    }
  }
  function event() {
    const handlers = new Set();
    return {
      listen(handler) {
        handlers.add(handler);
        return new Disposable(() => handlers.delete(handler));
      },
      fire(value) { return Promise.all([...handlers].map((handler) => handler(value))); },
      clear() { handlers.clear(); },
    };
  }
  function uri(fsPath) { return { fsPath, toString: () => `file://${fsPath}` }; }
  function folder(root, name) { return { name, uri: uri(root) }; }
  const closed = event();
  const foldersChanged = event();
  const state = {
    autoOpen: true, watchers: [], terminals: [], commands: new Map(),
    entries: [], quickPicks: [], infos: [], errors: [], searches: [], pickIndex: 0,
  };
  const workspace = {
    workspaceFolders: [folder('/work/repo', 'repo')],
    getWorkspaceFolder(file) {
      return [...(workspace.workspaceFolders || [])]
        .sort((a, b) => b.uri.fsPath.length - a.uri.fsPath.length)
        .find((item) => file.fsPath.startsWith(`${item.uri.fsPath}/`));
    },
    getConfiguration(section, resource) {
      assert.equal(section, 'codexRunsTerminal');
      assert.ok(resource.fsPath);
      return { get(key, fallback) {
        assert.equal(key, 'autoOpen');
        assert.equal(fallback, true);
        return state.autoOpen;
      } };
    },
    createFileSystemWatcher(pattern, ignoreCreate, ignoreChange, ignoreDelete) {
      const created = event();
      const watcher = new Disposable(() => created.clear());
      Object.assign(watcher, {
        pattern, ignoreCreate, ignoreChange, ignoreDelete,
        onDidCreate: created.listen, fire: created.fire,
      });
      state.watchers.push(watcher);
      return watcher;
    },
    onDidChangeWorkspaceFolders: foldersChanged.listen,
    async findFiles(pattern, exclude) {
      state.searches.push({ pattern, exclude });
      if (state.searchError) { throw new Error('search failed'); }
      return state.entries.filter((entry) => workspace.getWorkspaceFolder(entry.uri) === pattern.base)
        .map((entry) => entry.uri);
    },
    fs: { async stat(file) {
      const entry = state.entries.find((item) => item.uri.toString() === file.toString());
      if (!entry || entry.missing) { throw new Error('file disappeared'); }
      return { mtime: entry.mtime, type: entry.directory ? 2 : 1 };
    } },
  };
  const api = {
    Disposable, workspace, FileType: { Directory: 2 },
    RelativePattern: class {
      constructor(base, pattern) { this.base = base; this.pattern = pattern; }
    },
    window: {
      createTerminal(options) {
        if (state.terminalError) { throw new Error('terminal failed'); }
        const terminal = new Disposable(() => { closed.fire(terminal); });
        Object.assign(terminal, { options, shows: [], show(preserveFocus) { this.shows.push(preserveFocus); } });
        state.terminals.push(terminal);
        return terminal;
      },
      onDidCloseTerminal: closed.listen,
      async showQuickPick(items, options) {
        state.quickPicks.push({ items, options });
        return state.pickIndex === null ? undefined : items[state.pickIndex];
      },
      async showInformationMessage(message) { state.infos.push(message); },
      async showErrorMessage(message) { state.errors.push(message); },
    },
    commands: { registerCommand(name, handler) {
      state.commands.set(name, handler);
      return new Disposable(() => state.commands.delete(name));
    } },
  };
  const extensionPath = path.join(__dirname, '../src/extension.js');
  const extensionModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(extensionPath, 'utf8'), {
    module: extensionModule, process: { platform: 'linux' },
    require(id) {
      if (id === 'vscode') { return api; }
      if (id === './lib') { return lib; }
      throw new Error(`Unexpected dependency: ${id}`);
    },
  }, { filename: extensionPath });
  const context = { subscriptions: [] };
  extensionModule.exports.activate(context);
  return {
    state, workspace, uri, folder, closed, foldersChanged, extension: extensionModule.exports,
    open: () => state.commands.get('codexRunsTerminal.openLog')(),
    dispose() {
      extensionModule.exports.deactivate();
      context.subscriptions.forEach((subscription) => subscription.dispose());
    },
  };
}

test('extension watches only creation and reuses terminals until they are closed', async (t) => {
  const fixture = extensionFixture();
  t.after(() => fixture.dispose());
  const { state, uri } = fixture;
  const watcher = state.watchers[0];
  assert.equal(state.terminals.length, 0);
  assert.equal(watcher.pattern.base, fixture.workspace.workspaceFolders[0]);
  assert.equal(watcher.pattern.pattern, '.codex-runs/*/*.log');
  assert.equal(watcher.ignoreCreate, false);
  assert.equal(watcher.ignoreChange, true);
  assert.equal(watcher.ignoreDelete, true);
  const log = uri('/work/repo/.codex-runs/002/codex.log');
  await watcher.fire(log);
  await watcher.fire(uri(log.fsPath));
  assert.equal(state.terminals.length, 1);
  assert.equal(state.terminals[0].options.name, 'Codex: 002/codex.log');
  assert.equal(state.terminals[0].options.shellPath, '/bin/sh');
  assert.deepEqual(state.terminals[0].options.shellArgs, tailCommand(log.fsPath, 'linux').shellArgs);
  assert.deepEqual(state.terminals[0].shows, [true, true]);
  state.terminals[0].dispose();
  await watcher.fire(log);
  assert.equal(state.terminals.length, 2);
  for (const invalid of ['/work/repo/nested/.codex-runs/002/codex.log', '/elsewhere/.codex-runs/002/codex.log']) {
    await watcher.fire(uri(invalid));
  }
  assert.equal(state.terminals.length, 2);
});

test('autoOpen changes immediately while the manual command sorts logs and reuses terminals', async (t) => {
  const fixture = extensionFixture();
  t.after(() => fixture.dispose());
  const { state, uri, workspace, folder } = fixture;
  const second = folder('/work/second', 'second');
  workspace.workspaceFolders.push(second);
  await fixture.foldersChanged.fire({ added: [second], removed: [] });
  const older = uri('/work/repo/.codex-runs/002/older.log');
  const newest = uri('/work/second/.codex-runs/003/newest.log');
  state.entries = [{ uri: older, mtime: 10 }, { uri: newest, mtime: 30 }];
  state.autoOpen = false;
  await state.watchers[0].fire(older);
  assert.equal(state.terminals.length, 0);
  await fixture.open();
  assert.deepEqual(Array.from(state.quickPicks[0].items, (item) => item.label), ['003/newest.log', '002/older.log']);
  assert.equal(state.quickPicks[0].items[0].description, 'second');
  assert.equal(state.terminals[0].options.name, 'Codex: 003/newest.log');
  await fixture.open();
  assert.equal(state.terminals.length, 1);
  assert.deepEqual(state.terminals[0].shows, [true, true]);
  assert.ok(state.searches.every(({ pattern, exclude }) => pattern.pattern === '.codex-runs/*/*.log' && exclude === null));
  state.autoOpen = true;
  await state.watchers[0].fire(older);
  assert.equal(state.terminals.length, 2);
});

test('workspace folder changes and deactivation dispose the owned watchers and terminals', async (t) => {
  const fixture = extensionFixture();
  t.after(() => fixture.dispose());
  const original = fixture.workspace.workspaceFolders.pop();
  await fixture.foldersChanged.fire({ added: [], removed: [original] });
  assert.equal(fixture.state.watchers[0].disposed, true);
  fixture.workspace.workspaceFolders.push(original);
  await fixture.foldersChanged.fire({ added: [original], removed: [] });
  await fixture.foldersChanged.fire({ added: [original], removed: [] });
  assert.equal(fixture.state.watchers.length, 2);
  await fixture.state.watchers[1].fire(fixture.uri('/work/repo/.codex-runs/002/codex.log'));
  fixture.extension.deactivate();
  assert.ok(fixture.state.watchers.every((watcher) => watcher.disposed));
  assert.ok(fixture.state.terminals.every((terminal) => terminal.disposed));
});

test('manual command handles missing logs, cancellation and errors without opening extra terminals', async (t) => {
  const fixture = extensionFixture();
  t.after(() => fixture.dispose());
  const { state, uri } = fixture;
  await fixture.open();
  assert.equal(state.infos.length, 1);
  state.entries = [
    { uri: uri('/work/repo/.codex-runs/002/missing.log'), mtime: 30, missing: true },
    { uri: uri('/work/repo/.codex-runs/002/directory.log'), mtime: 20, directory: true },
    { uri: uri('/work/repo/.codex-runs/002/codex.log'), mtime: 10 },
  ];
  state.pickIndex = null;
  await fixture.open();
  assert.equal(state.quickPicks[0].items.length, 1);
  assert.equal(state.terminals.length, 0);
  state.searchError = true;
  await fixture.open();
  assert.match(state.errors[0], /search failed/);
  state.searchError = false;
  state.terminalError = true;
  await state.watchers[0].fire(state.entries[2].uri);
  assert.match(state.errors[1], /terminal failed/);
  fixture.workspace.workspaceFolders = undefined;
  await fixture.open();
  assert.equal(state.infos.length, 2);
});
