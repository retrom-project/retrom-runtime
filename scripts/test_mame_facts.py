import importlib.util
import gzip
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("mame_facts", Path(__file__).with_name("mame-facts.py"))
facts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(facts)


class MameFactsTest(unittest.TestCase):
    def test_nodump_is_not_required_but_baddump_with_crc_is(self):
        result = facts.parse_mame(b'<mame><machine name="game">'
                                 b'<rom name="unknown" size="1" status="nodump"/>'
                                 b'<rom name="explicit" size="1" crc="00000001" status="nodump"/>'
                                 b'<rom name="known" size="548" crc="bdef9a1f" status="baddump"/>'
                                 b'</machine></mame>')
        self.assertEqual(result['game']['roms'], [{'name': 'known', 'size': '548', 'crc': 'bdef9a1f'}])

    def test_search_labels_survive_candidate_regeneration(self):
        result = facts.parse_mame(b'<mame><machine name="game"><description> Test  Game (World v2) </description>'
                                 b'<year>1990</year><manufacturer>Studio</manufacturer></machine></mame>')
        self.assertEqual(result['game']['description'], 'Test Game (World v2)')
        self.assertEqual(result['game']['year'], '1990')
        self.assertEqual(result['game']['manufacturer'], 'Studio')

    def test_device_refs_and_rom_identity(self):
        result = facts.parse_mame(b'<mame><machine name="game"><device_ref name="mcu"/></machine>'
                                 b'<machine name="mcu" isdevice="yes" runnable="no">'
                                 b'<rom name="boot" size="115" crc="f70a8620" sha1="abcd"/></machine></mame>')
        self.assertEqual(result['game']['devices'], ['mcu'])
        self.assertTrue(result['mcu']['device'])
        self.assertFalse(result['mcu']['runnable'])
        self.assertEqual(result['mcu']['roms'][0]['sha1'], 'abcd')

    def test_default_bios_only_and_optional_roms(self):
        result = facts.parse_mame(b'<mame><machine name="bios" isbios="yes">'
                                 b'<biosset name="a"/><biosset name="b" default="yes"/>'
                                 b'<rom name="a" bios="a" size="1" crc="00000001"/>'
                                 b'<rom name="b" bios="b" size="1" crc="00000002" optional="yes"/></machine></mame>')
        self.assertEqual([r['name'] for r in result['bios']['roms']], ['b'])
        self.assertTrue(result['bios']['roms'][0]['optional'])

    def test_missing_device_and_duplicate_record_fail(self):
        for data in [b'<mame><machine name="g"><device_ref name="missing"/></machine></mame>',
                     b'<mame><machine name="g"/><machine name="g"/></mame>']:
            with self.assertRaises(ValueError):
                facts.parse_mame(data)

    def test_candidate_updates_catalog_and_arcade_asset_families_together(self):
        with tempfile.TemporaryDirectory() as directory:
            candidate, repository = Path(directory) / "candidate", Path(directory) / "runtime"
            candidate.mkdir()
            (repository / "assets/facts").mkdir(parents=True)
            (repository / "src/runtime").mkdir(parents=True)
            (repository / "src/mame").mkdir(parents=True)
            (repository / "assets/facts/arcade-catalog.json.gz").write_bytes(gzip.compress(
                json.dumps({"fbneo": {"preserved": True}, "mame_arcade": {"old": {}}}).encode()))
            (repository / "src/runtime/arcade-provenance.json").write_text(json.dumps([
                {"coreId": "fbneo", "sha256": "unchanged"}, {"coreId": "mame_arcade"}]))
            families_path = repository / "src/mame/arcade-families.json"
            families_path.write_text('["old"]')
            payloads = {"mame-arcade.xml": b'<mame><machine name="new"/></mame>',
                        "mame-build.json": json.dumps({"adapterAbi": "retrom-mame-dylink-v1", "families": {
                            "arcade_new": {"arcade": True, "module": "mame-arcade_new.wasm", "machines": ["___empty", "new"]},
                            "apple": {"arcade": False, "module": "mame-apple.wasm", "machines": ["apple2p"]},
                        }}).encode()}
            descriptor = {"coreId": "mame", "dirty": False, "commit": "a" * 40,
                          "repository": "https://github.com/retrom-project/mame", "adapterAbi": "retrom-mame-dylink-v1",
                          "files": [{"filename": name, "sizeBytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
                                    for name, data in payloads.items()]}
            for name, data in payloads.items():
                (candidate / name).write_bytes(data)
            (candidate / "retrom-core-candidate.json").write_text(json.dumps(descriptor))
            facts.generate(candidate, repository)
            self.assertEqual(["arcade_new"], json.loads(families_path.read_text()))
            tables = json.loads(gzip.decompress((repository / "assets/facts/arcade-catalog.json.gz").read_bytes()))
            self.assertEqual({"preserved": True}, tables["fbneo"])
            self.assertEqual(["new"], list(tables["mame_arcade"]))
            provenance = json.loads((repository / "src/runtime/arcade-provenance.json").read_text())
            self.assertEqual("unchanged", provenance[0]["sha256"])
            self.assertEqual("a" * 40, provenance[1]["commit"])
            (candidate / "mame-build.json").write_bytes(b"unverified bytes")
            before = (repository / "assets/facts/arcade-catalog.json.gz").read_bytes()
            with self.assertRaisesRegex(ValueError, "identity mismatch"):
                facts.generate(candidate, repository)
            self.assertEqual(before, (repository / "assets/facts/arcade-catalog.json.gz").read_bytes())


if __name__ == '__main__':
    unittest.main()
