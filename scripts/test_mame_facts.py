import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("mame_facts", Path(__file__).with_name("mame-facts.py"))
facts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(facts)


class MameFactsTest(unittest.TestCase):
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


if __name__ == '__main__':
    unittest.main()
