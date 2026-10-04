'use strict';

const path = require('node:path');

function parseRunLogPath(workspaceRoot, filePath) {
  if (typeof workspaceRoot !== 'string' || typeof filePath !== 'string') {
    return null;
  }

  // Select by the input, so Windows paths also work in tests on other OSes.
  const root = workspaceRoot.replace(/\\/g, '/');
  const file = filePath.replace(/\\/g, '/');
  const pathApi = /^[a-z]:\//i.test(root) || root.startsWith('//')
    ? path.win32
    : path.posix;
  if (!pathApi.isAbsolute(root) || !pathApi.isAbsolute(file)) {
    return null;
  }

  const parts = pathApi.relative(root, file).replace(/\\/g, '/').split('/');
  if (parts.length !== 3 || parts[0] !== '.codex-runs' || !parts[1]
      || parts[2].length <= 4 || !parts[2].endsWith('.log')) {
    return null;
  }
  return { taskId: parts[1], fileName: parts[2] };
}

function terminalName(taskId, fileName) {
  return `Codex: ${taskId}/${fileName}`;
}

function tailCommand(filePath, platform) {
  if (platform === 'win32') {
    const quotedPath = `'${filePath.replace(/'/g, "''")}'`;
    return {
      shellPath: 'powershell.exe',
      shellArgs: [
        '-NoProfile',
        '-Command',
        '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); '
          + '$OutputEncoding = [Console]::OutputEncoding; '
          + `Get-Content -LiteralPath ${quotedPath} -Wait -Encoding UTF8`,
      ],
    };
  }

  const quotedPath = `'${filePath.replace(/'/g, "'\\''")}'`;
  return {
    shellPath: '/bin/sh',
    shellArgs: ['-c', `tail -n +1 -F ${quotedPath}`],
  };
}

function sortRunLogs(logs) {
  return [...logs].sort((left, right) => right.mtime - left.mtime
    || `${left.taskId}/${left.fileName}`.localeCompare(`${right.taskId}/${right.fileName}`));
}

module.exports = { parseRunLogPath, terminalName, tailCommand, sortRunLogs };
