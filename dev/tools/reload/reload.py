# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#    https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Runs a command in a container and restarts it when its source changes.

For the services that have no reloader of their own. Their source is
bind-mounted into the container (see compose.yml), and this wraps their
command:

    python /opt/openrelik-dev/reload.py <dir>... -- <command>...

It polls modification times instead of waiting for file events, so it doesn't
depend on Docker Desktop forwarding them through the bind mount. Standard
library only: it runs with the Python of whatever image it's mounted into.
"""

import os
import signal
import subprocess
import sys
import time

POLL_SECONDS = 1.0
# A change is acted on once the files have been quiet this long, so that an
# editor's save or a git checkout restarts the command once, not per file.
SETTLE_SECONDS = 0.3
STOP_TIMEOUT_SECONDS = 10
IGNORED_DIRS = {"__pycache__", ".git", "node_modules", ".pytest_cache"}
IGNORED_SUFFIXES = (".pyc", ".swp", "~")


def log(message: str) -> None:
    print(f"[reload] {message}", file=sys.stderr, flush=True)


def snapshot(dirs: list[str]) -> dict[str, tuple[int, int]]:
    """The (mtime, size) of every watched file."""
    files = {}
    for top in dirs:
        for root, subdirs, names in os.walk(top):
            subdirs[:] = [d for d in subdirs if d not in IGNORED_DIRS]
            for name in names:
                if name.endswith(IGNORED_SUFFIXES):
                    continue
                path = os.path.join(root, name)
                try:
                    stat = os.stat(path)
                except FileNotFoundError:
                    continue
                files[path] = (stat.st_mtime_ns, stat.st_size)
    return files


def changed(old: dict, new: dict) -> list[str]:
    return sorted(path for path in old.keys() | new.keys() if old.get(path) != new.get(path))


def start(command: list[str]) -> subprocess.Popen:
    # Its own process group, so that stopping it also stops its children
    # (Celery's worker processes, for example).
    return subprocess.Popen(command, start_new_session=True)


def stop(child: subprocess.Popen) -> int:
    if child.poll() is None:
        os.killpg(child.pid, signal.SIGTERM)
        try:
            child.wait(STOP_TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            log(f"still running after {STOP_TIMEOUT_SECONDS}s, killing it")
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
    return child.returncode


def main(argv: list[str]) -> int:
    if "--" not in argv or argv.index("--") in (0, len(argv) - 1):
        log("usage: reload.py <dir>... -- <command>...")
        return 2
    split = argv.index("--")
    dirs, command = argv[:split], argv[split + 1 :]

    child = start(command)

    def shut_down(signum, frame):
        sys.exit(stop(child))

    # As PID 1 the reloader gets the container's stop signal; pass it on.
    signal.signal(signal.SIGTERM, shut_down)
    signal.signal(signal.SIGINT, shut_down)

    files = snapshot(dirs)
    log(f"watching {len(files)} files in {', '.join(dirs)}")
    exited_reported = False
    while True:
        time.sleep(POLL_SECONDS)
        if child.poll() is not None and not exited_reported:
            log(f"command exited with {child.returncode}; restarting it on the next change")
            exited_reported = True
        new = snapshot(dirs)
        if new == files:
            continue
        while True:
            time.sleep(SETTLE_SECONDS)
            settled = snapshot(dirs)
            if settled == new:
                break
            new = settled
        paths = changed(files, new)
        files = new
        more = f" and {len(paths) - 1} more" if len(paths) > 1 else ""
        log(f"{paths[0]}{more} changed, restarting")
        stop(child)
        child = start(command)
        exited_reported = False


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
