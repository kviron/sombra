import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
import uuid

spec = importlib.util.spec_from_file_location('cleanup_attachments', Path(__file__).with_name('cleanup-attachments.py'))
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)

class RetentionTests(unittest.TestCase):
    def test_only_old_regular_uuid_files_are_removed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            old = root / str(uuid.uuid4()); old.write_bytes(b'old')
            recent = root / str(uuid.uuid4()); recent.write_bytes(b'recent')
            unrelated = root / 'mines-db.json'; unrelated.write_bytes(b'database')
            directory = root / str(uuid.uuid4()); directory.mkdir()
            symlink = root / str(uuid.uuid4()); symlink.symlink_to(unrelated)
            now = 2_000_000_000
            for path in (old, unrelated): os.utime(path, (now - cleanup.RETENTION_SECONDS - 1,) * 2)
            os.utime(recent, (now - cleanup.RETENTION_SECONDS + 1,) * 2)
            self.assertEqual(cleanup.cleanup(root, now=now, dry_run=True), (1, 3))
            self.assertTrue(old.exists())
            self.assertEqual(cleanup.cleanup(root, now=now), (1, 3))
            self.assertFalse(old.exists())
            for path in (recent, unrelated, directory, symlink): self.assertTrue(path.exists())
            self.assertEqual(cleanup.cleanup(root, now=now), (0, 0))

    def test_symlink_root_is_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            real = Path(temporary) / 'real'; real.mkdir()
            link = Path(temporary) / 'link'; link.symlink_to(real, target_is_directory=True)
            with self.assertRaises(RuntimeError): cleanup.cleanup(link)

if __name__ == '__main__': unittest.main()
