#!/usr/bin/env python3
"""Regenerate only Current MAME facts from a verified native core candidate DAT."""
import gzip
import hashlib
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET


def parse_mame(data):
    root = ET.fromstring(data)
    if root.tag != "mame":
        raise ValueError("MAME XML root required")
    games = {}
    for machine in root.findall("machine"):
        name = machine.attrib["name"]
        if name in games:
            raise ValueError(f"Duplicate MAME record: {name}")
        bios = machine.findall("biosset")
        default = next((b.get("name") for b in bios if b.get("default") == "yes"),
                       bios[0].get("name") if bios else None)
        roms = []
        for rom in machine.findall("rom"):
            if not rom.get("crc") or rom.get("bios") not in (None, default):
                continue
            entry = {key: rom.attrib[key] for key in ("name", "size", "crc")}
            for key in ("sha1", "merge", "bios"):
                if rom.get(key):
                    entry[key] = rom.get(key)
            if rom.get("optional") == "yes":
                entry["optional"] = True
            roms.append(entry)
        games[name] = {"parent": machine.get("romof") or machine.get("cloneof"),
                       "bios": machine.get("isbios") == "yes", "device": machine.get("isdevice") == "yes",
                       "runnable": machine.get("runnable") != "no",
                       "devices": sorted({r.attrib["name"] for r in machine.findall("device_ref")}), "roms": roms}
    for name, machine in games.items():
        for ref in machine["devices"]:
            if ref not in games or not games[ref]["device"]:
                raise ValueError(f"Missing device definition: {name}/{ref}")
    return dict(sorted(games.items()))


def generate(candidate, repository):
    descriptor = json.loads((candidate / "retrom-core-candidate.json").read_text())
    if descriptor["coreId"] != "mame" or descriptor["dirty"]:
        raise ValueError("Clean MAME candidate required")
    declared = next(f for f in descriptor["files"] if f["filename"] == "mame-arcade.xml")
    data = (candidate / "mame-arcade.xml").read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    if len(data) != declared["sizeBytes"] or sha != declared["sha256"]:
        raise ValueError("MAME DAT identity mismatch")
    facts = repository / "assets/facts/arcade-catalog.json.gz"
    tables = json.loads(gzip.decompress(facts.read_bytes()))
    tables["mame_arcade"] = parse_mame(data)
    facts.write_bytes(gzip.compress(json.dumps(tables, separators=(",", ":"), ensure_ascii=False).encode(), mtime=0))
    provenance = repository / "src/runtime/arcade-provenance.json"
    sources = json.loads(provenance.read_text())
    record = next(source for source in sources if source["coreId"] == "mame_arcade")
    record.update(sha256=sha, commit=descriptor["commit"],
                  source=descriptor["repository"] + "/tree/" + descriptor["commit"], assetPath="mame-arcade.xml")
    provenance.write_text(json.dumps(sources, indent=2) + "\n")
    print(json.dumps({"machines": len(tables["mame_arcade"]), "sha256": sha, "commit": descriptor["commit"]}))


if __name__ == "__main__":
    generate(Path(sys.argv[1]).resolve(), Path(__file__).resolve().parents[1])
