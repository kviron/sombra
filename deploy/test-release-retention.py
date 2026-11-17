import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('retention',Path(__file__).with_name('release-retention.py'))
retention=importlib.util.module_from_spec(spec);spec.loader.exec_module(retention)

class RetentionTests(unittest.TestCase):
 def fixture(self,base):
  root=base/'updates';stage=base/'stage';root.mkdir();stage.mkdir()
  for number in range(10,18):
   name=f'0.1.{number}';directory=root/name;directory.mkdir()
   for suffix in ['.exe','.exe.sig']:(directory/f'Sombra_{name}_x64-setup{suffix}').write_bytes(b'artifact')
  manifest={'version':'0.1.16','platforms':{'windows-x86_64':{'url':'https://sombra.mi-nerva.ru/updates/0.1.16/Sombra_0.1.16_x64-setup.exe'}}}
  (root/'latest.json').write_text(json.dumps(manifest))
  return root,stage
 def test_numeric_sort_keep_five_and_ignore_unpublished(self):
  with tempfile.TemporaryDirectory() as temp:
   root,stage=self.fixture(Path(temp).resolve())
   (stage/'Sombra_0.1.10_x64-setup.exe').write_bytes(b'old')
   (stage/'Sombra_0.1.18_x64-setup.exe').write_bytes(b'pending')
   _,_,keep,remove,loose=retention.plan(root,stage)
   self.assertEqual(keep,['0.1.16','0.1.15','0.1.14','0.1.13','0.1.12'])
   self.assertEqual({path.name for path,_ in remove},{'0.1.10','0.1.11'})
   self.assertEqual([path.name for path in loose],['Sombra_0.1.10_x64-setup.exe'])
   self.assertTrue((root/'0.1.10').exists())
 def test_unknown_content_refuses_entire_deletion_plan(self):
  with tempfile.TemporaryDirectory() as temp:
   root,stage=self.fixture(Path(temp).resolve())
   (root/'0.1.10'/'unrelated-data').write_text('keep')
   with self.assertRaises(ValueError):retention.plan(root,stage)
   self.assertTrue((root/'0.1.11').exists())
 def test_active_manifest_reference_cannot_be_deleted(self):
  with tempfile.TemporaryDirectory() as temp:
   root,stage=self.fixture(Path(temp).resolve())
   manifest=json.loads((root/'latest.json').read_text())
   manifest['platforms']['windows-x86_64']['url']='https://sombra.mi-nerva.ru/updates/0.1.10/Sombra_0.1.10_x64-setup.exe'
   (root/'latest.json').write_text(json.dumps(manifest))
   with self.assertRaises(ValueError):retention.plan(root,stage)
 def test_version_named_file_is_not_a_deletable_directory(self):
  with tempfile.TemporaryDirectory() as temp:
   root,stage=self.fixture(Path(temp).resolve())
   (root/'0.1.9').write_text('not a release')
   with self.assertRaises(ValueError):retention.plan(root,stage)

if __name__=='__main__':unittest.main()
