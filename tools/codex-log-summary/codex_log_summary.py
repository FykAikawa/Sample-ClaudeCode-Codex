"""Summarize Codex JSONL on stdin without printing full command output."""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from datetime import datetime
import json
import ntpath
import os
import posixpath
import re
import shlex
import sys
from typing import Callable, TextIO


@dataclass
class SummaryState:
    root: str = field(default_factory=os.getcwd)
    previous_todos: tuple[tuple[str, bool], ...] | None = None


def _mapping(value: object) -> dict:
    return value if isinstance(value, dict) else {}


def _text(value: object, default: str = "") -> str:
    return value if isinstance(value, str) else default


def _single_line(value: object, default: str = "") -> str:
    return " ".join(
        line.strip() for line in _text(value, default).splitlines() if line.strip()
    )


def _truncate(text: str, limit: int) -> str:
    """Include the ellipsis in the character limit."""
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _unwrap_shell(command: str) -> str:
    """Recognize shell wrappers as text; never execute the command."""
    match = re.match(
        r"^\s*(?:\"([^\"]+)\"|'([^']+)'|(\S+))([\s\S]*)$", command
    )
    if match is None:
        return command
    executable = next(part for part in match.groups()[:3] if part is not None)
    shell = re.split(r"[/\\]", executable)[-1].lower()
    arguments = match.group(4)
    # A command switch on a later physical line is not a recognized wrapper.
    # Searching that line could otherwise expose embedded file contents.
    first_arguments = arguments.splitlines()[0] if arguments.splitlines() else ""
    if shell in {"powershell", "powershell.exe", "pwsh", "pwsh.exe"}:
        switch = re.search(r"(?:^|[ \t])-(?:command|c)(?:[ \t]+|$)", first_arguments, re.I)
    elif shell in {"bash", "bash.exe", "sh", "sh.exe", "zsh", "zsh.exe"}:
        switch = re.search(r"(?:^|[ \t])-[a-z]*c[a-z]*(?:[ \t]+|$)", first_arguments)
    else:
        return command
    if switch is None:
        return command
    body = arguments[switch.end() :].strip(" \t")
    if not body or body[0] not in {"'", '"'}:
        return body
    if shell in {"powershell", "powershell.exe", "pwsh", "pwsh.exe"}:
        if len(body) >= 2 and body[-1] == body[0]:
            quote, body = body[0], body[1:-1]
            return body.replace('\\"', '"') if quote == '"' else body.replace("''", "'")
        return body
    try:
        words = shlex.split(body, posix=True)
    except ValueError:
        return body
    return words[0] if len(words) == 1 else body


def summarize_command(command: object) -> str:
    """Show only the first physical line, plus the omitted line count."""
    body = _unwrap_shell(_text(command))
    lines = body.splitlines()
    first = _truncate((lines[0].strip() if lines else "") or "?", 120)
    return first + (f" (+{len(lines) - 1}行)" if len(lines) > 1 else "")


def relative_path(path: object, root: str) -> str:
    """Handle both Windows and POSIX paths, including different drives."""
    value = _text(path, "?")
    flavour = ntpath if ntpath.splitdrive(value)[0] or "\\" in value else posixpath
    if flavour.isabs(value):
        root_flavour = ntpath if ntpath.splitdrive(root)[0] or "\\" in root else posixpath
        if flavour is root_flavour:
            try:
                value = flavour.relpath(value, root)
            except ValueError:
                pass
    return _single_line(value.replace("\\", "/"))


def _integer(value: object, default: int = 0) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else default


def format_event(event: object, state: SummaryState) -> list[str]:
    """Return summary lines without timestamps; tolerate missing/wrong fields."""
    event = _mapping(event)
    event_type = _text(event.get("type"))
    if event_type == "thread.started":
        return [f"▶ 開始 thread={_single_line(event.get('thread_id'), '?')}"]
    if event_type == "error":
        return [f"⚠ {_single_line(event.get('message'), '不明なエラー')}"]
    if event_type == "turn.failed":
        message = _mapping(event.get("error")).get("message")
        return [f"✖ 失敗: {_single_line(message, '不明なエラー')}"]
    if event_type == "turn.completed":
        usage = _mapping(event.get("usage"))
        return [
            f"■ 完了 tokens: in={_integer(usage.get('input_tokens'))} "
            f"(cached {_integer(usage.get('cached_input_tokens'))}) "
            f"out={_integer(usage.get('output_tokens'))}"
        ]
    if event_type not in {"item.started", "item.updated", "item.completed"}:
        return []
    item = _mapping(event.get("item"))
    item_type = _text(item.get("type"))
    if item_type == "error":
        return [f"⚠ {_single_line(item.get('message'), '不明なエラー')}"]
    if item_type == "todo_list":
        entries = item.get("items")
        if not isinstance(entries, list):
            entries = []
        todos = tuple(
            (_text(entry.get("text")), entry.get("completed") is True)
            for entry in entries
            if isinstance(entry, dict)
        )
        if todos == state.previous_todos:
            return []
        state.previous_todos = todos
        completed = sum(done for _, done in todos)
        pending = next((text for text, done in todos if not done), "(未完了なし)")
        return [f"☑ TODO {completed}/{len(todos)}: {_single_line(pending)}"]
    if event_type != "item.completed":
        return []
    status = _text(item.get("status"))
    if item_type == "agent_message":
        return [f"💬 {_truncate(_single_line(item.get('text')), 300)}"]
    if item_type == "command_execution":
        if status not in {"", "completed", "failed"}:
            return []
        code = item.get("exit_code")
        numeric_code = isinstance(code, int) and not isinstance(code, bool)
        failed = status == "failed" or (numeric_code and code != 0)
        result = f"失敗 (exit {code if numeric_code else '?'})" if failed else "OK"
        lines = [f"$ {summarize_command(item.get('command'))}  → {result}"]
        if failed:
            lines.extend(
                f"    | {_truncate(line, 200)}"
                for line in _text(item.get("aggregated_output")).splitlines()[-5:]
            )
        return lines
    if item_type == "file_change":
        if status not in {"", "completed"}:
            return []
        changes = item.get("changes")
        changes = (
            [change for change in changes if isinstance(change, dict)]
            if isinstance(changes, list)
            else []
        )
        details = ", ".join(
            f"{_single_line(change.get('kind'), '?')} {relative_path(change.get('path'), state.root)}"
            for change in changes[:6]
        )
        if len(changes) > 6:
            details += f" ほか {len(changes) - 6} 件"
        return [f"✎ 変更: {details}"]
    if item_type == "web_search":
        return [f"🔎 検索: {_single_line(item.get('query'))}"]
    if item_type == "mcp_tool_call":
        if status not in {"", "completed", "failed"}:
            return []
        result = "失敗" if status == "failed" else "OK"
        return [
            f"🔧 {_single_line(item.get('server'), '?')}."
            f"{_single_line(item.get('tool'), '?')} → {result}"
        ]
    return []


def _configure_utf8(stream: TextIO, *, newline: str | None = None) -> None:
    reconfigure = getattr(stream, "reconfigure", None)
    if reconfigure is not None:
        reconfigure(encoding="utf-8", errors="replace", newline=newline)


def process_stream(
    input_stream: TextIO,
    output_stream: TextIO,
    state: SummaryState | None = None,
    *,
    now: Callable[[], datetime] = datetime.now,
) -> None:
    """Process one input line at a time and flush even suppressed events."""
    _configure_utf8(input_stream)
    _configure_utf8(output_stream, newline="\n")
    if state is None:
        state = SummaryState()
    for raw_line in input_stream:
        line = raw_line.rstrip("\r\n")
        try:
            event = json.loads(line)
        except (ValueError, RecursionError):
            lines = [f"· {_truncate(line, 200)}"]
        else:
            lines = format_event(event, state)
        timestamp = now().strftime("[%H:%M:%S]")
        for summary in lines:
            output_stream.write(f"{timestamp} {summary}\n")
        output_stream.flush()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Codex JSONL を UTF-8 の要約ログに変換します。")
    parser.add_argument("--root", default=os.getcwd(), help="変更パスの基準ディレクトリ（既定: cwd）")
    args = parser.parse_args(argv)
    process_stream(sys.stdin, sys.stdout, SummaryState(root=os.path.abspath(args.root)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
