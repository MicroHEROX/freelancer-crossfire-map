# -*- coding: utf-8 -*-
"""Analyse mission-phase system variants and gather evidence for picking the
final release version of each duplicated system."""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import extract_map as em  # noqa: E402

ROOT = em.ROOT
DATA = em.DATA
OUT = em.OUT

SUFFIX_RE = re.compile(r"^(?P<base>.*?)(?P<suffix>b|c|t|tk|tn|tn2|ts|tns|mp|sp|2|3b)?$", re.I)


def family_key(nick):
    n = nick.lower()
    m = re.match(r"^([a-z]{2}\d+)(b|c|t|tk|tn|tn2|ts|tns|mp|sp)?$", n)
    if m:
        return m.group(1)
    m = re.match(r"^(st0\d)(b|c|tk|2)?$", n)
    if m:
        return m.group(1)
    m = re.match(r"^(fp7_system)(mp)?$", n)
    if m:
        return m.group(1)
    return n


def main():
    resolver = em.IdsResolver()
    resolver.load()
    systems, bases = em.load_universe(resolver)
    sectors = em.load_sectors()
    archetypes = em.load_solar_archetypes()
    stars = em.load_star_archetypes()

    placed = {}
    for s in sectors:
        for sy in s["systems"]:
            placed.setdefault(sy["nick"], {"sector": s["id"], "x": sy["x"], "y": sy["y"]})

    # connections and bases per system
    links_from = defaultdict(list)
    links_to = defaultdict(list)
    parse_fail = []
    obj_by_system = {}
    for nick, info in systems.items():
        path = em.system_file_path(info["file"])
        if path is None or not path.exists():
            parse_fail.append(nick)
            continue
        objects, zones, conns = em.parse_system(path, archetypes, stars)
        obj_by_system[nick] = objects
        for c in conns:
            links_from[nick].append((c["to"], c["kind"], c["via"]))
            links_to[c["to"]].append((nick, c["kind"], c["via"]))

    bases_by_system = defaultdict(list)
    for b in bases.values():
        bases_by_system[b["system"]].append(b["nick"])

    families = defaultdict(list)
    for nick in systems:
        families[family_key(nick)].append(nick)

    lines = []
    lines.append(f"total systems: {len(systems)}")
    lines.append(f"parse fail: {parse_fail}")
    lines.append("")
    multi = {k: v for k, v in families.items() if len(v) > 1}
    lines.append(f"families with >1 member: {len(multi)}")
    for key in sorted(multi):
        members = sorted(multi[key])
        lines.append(f"===== family {key}: {members} =====")
        for nick in members:
            info = systems[nick]
            lay = placed.get(nick)
            lines.append(f"  {nick}")
            lines.append(f"     name: {info['name']}")
            lines.append(f"     file: {info['file']}  exists={em.system_file_path(info['file']) is not None and em.system_file_path(info['file']).exists()}")
            lines.append(f"     upos: {info['pos']}  sector: {lay}")
            lines.append(f"     visit={info['visit']}")
            lines.append(f"     bases: {bases_by_system.get(nick, [])[:8]}")
            lines.append(f"     out: {links_from.get(nick, [])[:10]}")
            lines.append(f"     in : {links_to.get(nick, [])[:10]}")
            objs = obj_by_system.get(nick, [])
            type_count = defaultdict(int)
            for o in objs:
                type_count[o["type"]] += 1
            lines.append(f"     objects: {dict(type_count)}")
        lines.append("")

    # systems with no layout
    lines.append("systems without layout: " + str([n for n in systems if n not in placed]))

    # sector dummy systems info
    for n in ["sector01", "sector02", "sector03", "sector04", "sector05"]:
        if n in systems:
            lines.append(f"{n}: name={systems[n]['name']} info={systems[n]['info']}")

    (OUT / "variants_report.txt").write_text("\n".join(lines), encoding="utf-8")
    print("done")


if __name__ == "__main__":
    main()
