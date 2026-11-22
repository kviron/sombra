#!/usr/bin/env python3
"""Monthly retention for Sombra message files; message history is never edited."""
import argparse
import fcntl
import logging
import os
from pathlib import Path
import stat
import syslog
import time
import uuid

DIRECTORY = Path('/var/lib/sombra/message-attachments')
RETENTION_SECONDS = 30 * 24 * 60 * 60


def cleanup(directory, *, now=None, dry_run=False):
    directory = Path(directory)
    if directory.is_symlink():
        raise RuntimeError('Refusing a symlink attachment directory')
    if not directory.exists():
        return 0, 0
    cutoff = (time.time() if now is None else now) - RETENTION_SECONDS
    count = total = 0
    # Lock only the cleanup job, not the live API. New uploads have recent mtimes.
    with (directory / '.cleanup.lock').open('a') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        for path in directory.iterdir():
            try:
                if str(uuid.UUID(path.name)) != path.name:
                    continue
                info = path.lstat()
                if not stat.S_ISREG(info.st_mode) or info.st_mtime >= cutoff:
                    continue
                if not dry_run:
                    path.unlink()
                count += 1
                total += info.st_size
            except ValueError:
                continue
            except FileNotFoundError:
                continue
    return count, total


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true', help='Report eligible files without removing them')
    options = parser.parse_args()
    try:
        count, size = cleanup(DIRECTORY, dry_run=options.dry_run)
        message = f"{'dry-run' if options.dry_run else 'cleanup'}: files={count}, bytes={size}, retention_days=30"
        print(message)
        syslog.syslog(syslog.LOG_INFO, 'sombra-attachments: ' + message)
    except Exception:
        logging.exception('Sombra attachment cleanup failed')
        syslog.syslog(syslog.LOG_ERR, 'sombra-attachments: cleanup failed; see cron log')
        raise
