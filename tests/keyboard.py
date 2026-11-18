import fcntl
import json
import os
import pty
import re
import select
import struct
import subprocess
import tempfile
import termios
import time
import uuid
from pathlib import Path

colors = {"original": None}
for table in sorted((Path(__file__).resolve().parents[1] / "assets/Color").glob("*.md")):
    colors.update(re.findall(r"\| \*\*(.+?)\*\* \| `#(\w{6})`", table.read_text()))
settings = Path(os.environ.get("PI_CODING_AGENT_DIR", Path.home() / ".pi/agent")) / "pi-welcome.json"
palette = json.loads(settings.read_text()).get("palette", "original") if settings.exists() else "original"
steps = 1 if list(colors).index(palette) < len(colors) - 1 else 2
expected_bg = list(colors.values())[(list(colors).index(palette) + steps) % len(colors)]
expected_sgr = ("48;2;" + ";".join(map(str, bytes.fromhex(expected_bg)))).encode()

for history_count in [0, 1, 8]:
    with tempfile.TemporaryDirectory(prefix="pi-welcome-keys-") as root:
        sessions = Path(root) / "sessions"
        sessions.mkdir()
        for i in range(history_count):
            sid = str(uuid.uuid4())
            stamp = f"2026-11-17T09:00:0{i}.000Z"
            entries = [
                dict(type="session", version=3, id=sid, timestamp=stamp, cwd=root),
                dict(type="message", id=f"m{i}", parentId=None, timestamp=stamp,
                     message=dict(role="user", content=f"RESTORED_HISTORY_{i}", timestamp=1794906000000 + i)),
                dict(type="session_info", id=f"n{i}", parentId=f"m{i}", timestamp=stamp, name=f"Fixture {i}"),
            ]
            file = sessions / f"{sid}.jsonl"
            file.write_text("".join(json.dumps(entry) + "\n" for entry in entries))
            os.utime(file, (1794906000 + i, 1794906000 + i))
        histories = {file: [json.loads(line) for line in file.read_text().splitlines()] for file in sessions.iterdir()}
        timestamps = {file: file.stat().st_mtime for file in histories}

        for mode in ["fullscreen", "regular"]:
            for file, stamp in timestamps.items():
                os.utime(file, (stamp, stamp))
            master, slave = pty.openpty()
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 32, 100, 0, 0))
            args = ["pi", "--offline", "--no-skills", "--no-prompt-templates", "--no-context-files",
                    "--no-mcp", "--no-approve", "--session-dir", str(sessions), "--tui-mode", mode]
            if history_count == 1:
                args += ["--session", str(next(iter(histories)))]
            proc = subprocess.Popen(
                args, cwd=root, stdin=slave, stdout=slave, stderr=slave, start_new_session=True,
                env={**os.environ, "TERM": "xterm-256color", "COLORTERM": "truecolor"},
            )
            os.close(slave)
            data = bytearray()

            def collect(seconds):
                deadline = time.monotonic() + seconds
                while time.monotonic() < deadline:
                    if select.select([master], [], [], 0.05)[0]:
                        try:
                            data.extend(os.read(master, 65536))
                        except OSError:
                            break

            def wait_for(needle, start=0):
                deadline = time.monotonic() + 16
                while needle not in data[start:] and time.monotonic() < deadline:
                    collect(0.2)
                assert needle in data[start:], data[-2000:].decode(errors="replace")

            try:
                wait_for(f"Fixture {history_count - 1}".encode() if history_count else b"Enter/Esc")
                start = len(data)
                collect(0.5)
                assert b"\x1b[38;2;" in data[start:], f"{mode}: gradient animation did not keep rendering"
                if history_count == 8:
                    for key in [b"\x1b[B", b"\x1b[A", b"\x1b[B"]:
                        os.write(master, key)
                        collect(0.7)
                start = len(data)
                os.write(master, b"\r")
                collect(2)
                if history_count:
                    expected = 6 if history_count == 8 else 0
                    assert f"RESTORED_HISTORY_{expected}".encode() in data, f"{mode}: wrong restored session"
                else:
                    start = len(data)
                    os.write(master, b"/name WELCOME_ENTER_OK\r")
                    wait_for(b"Session name set: WELCOME_ENTER_OK", start)
                    start = len(data)
                    os.write(master, b"/welcome\r")
                    wait_for(b"Enter/Esc", start)
                    assert "新建会话".encode() not in data[start:]
                    start = len(data)
                    os.write(master, b"\x1b")
                    collect(1)
                    start = len(data)
                    os.write(master, b"/name WELCOME_ESCAPE_OK\r")
                    wait_for(b"Session name set: WELCOME_ESCAPE_OK", start)
                if history_count == 8:
                    start = len(data)
                    os.write(master, b"/pi-welcome themes\r")
                    wait_for("开机动画".encode(), start)
                    start = len(data)
                    for key in [b"\x1b[B", b"\t"] * 3 + [b"\x1b[B"] * steps:
                        os.write(master, key)
                        collect(0.2)
                    wait_for(expected_sgr, start)
                    os.write(master, b"\x1b")
                    collect(0.5)
                    start = len(data)
                    os.write(master, b"/name THEME_CANCEL_OK\r")
                    wait_for(b"Session name set: THEME_CANCEL_OK", start)
                for file, original in histories.items():
                    current = [json.loads(line) for line in file.read_text().splitlines()]
                    assert current[:len(original)] == original, "existing history entries were modified"
                assert b"\x1b_Ga=T,f=100," not in data, "welcome must not transmit PNG frames"
                print(f"PASS {mode}: {history_count} histories, startup animation, entry/resume, history content preserved")
            finally:
                Path(f"/tmp/pi-welcome-{history_count}-{mode}.ansi").write_bytes(data)
                os.write(master, b"\x04")
                try:
                    proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    proc.terminate()
                    proc.wait(timeout=5)
                os.close(master)
