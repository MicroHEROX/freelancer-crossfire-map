# -*- coding: utf-8 -*-
"""Print details for selected systems: name, links, bases, object counts."""
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import extract_map as em  # noqa: E402

TARGETS = [
    "CF99", "CF98", "CF41", "CF103", "CF13", "CF53", "CF54",
    "St02", "St02b", "St02c", "St02tk", "St03", "St03b", "St03b2",
    "FP7_system", "FP7_systemmp", "CF01", "CF01ts", "CF01tns",
    "Bw01", "Bw01b", "CF60", "CF60b", "CF60c", "CF20", "CF20t",
]


def main():
    resolver = em.IdsResolver()
    resolver.load()
    systems, bases = em.load_universe(resolver)
    archetypes = em.load_solar_archetypes()
    stars = em.load_star_archetypes()

    bases_by_system = defaultdict(list)
    for b in bases.values():
        bases_by_system[b["system"]].append((b["nick"], b["name"]))

    out = []
    for nick in TARGETS:
        info = systems.get(nick)
        if not info:
            out.append(f"{nick}: NOT in universe.ini")
            continue
        path = em.system_file_path(info["file"])
        out.append(f"===== {nick} =====")
        out.append(f"  name: {info['name']!r}  visit={info['visit']}")
        out.append(f"  info: {(info['info'] or '')[:200]!r}")
        if path and path.exists():
            objects, zones, conns = em.parse_system(path, archetypes, stars)
            tc = Counter(o["type"] for o in objects)
            out.append(f"  objects: {dict(tc)}")
            out.append(f"  zones: {len(zones)}")
            for c in conns:
                out.append(f"    {c['kind']:5s} -> {c['to']:12s} via {c['via']}")
            named = [o for o in objects if o["ids"]]
            out.append(f"  named objects: {len(named)}")
            for o in named[:25]:
                nm = resolver.name(o["ids"])
                out.append(f"    {o['type']:18s} {o['nick']:30s} {nm!r}")
        else:
            out.append(f"  file missing: {path}")
        out.append(f"  bases: {bases_by_system.get(nick, [])}")
        out.append("")

    (em.OUT / "system_details.txt").write_text("\n".join(out), encoding="utf-8")
    print("done")


if __name__ == "__main__":
    main()
