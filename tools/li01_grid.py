# -*- coding: utf-8 -*-
"""Print Li01 objects with grid cell candidates for in-game map verification."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import extract_map as em  # noqa: E402

MAPMAX = 131072.0


def cell(v, mapmax=MAPMAX):
    i = int((v + mapmax) / (mapmax / 4))
    return max(0, min(7, i))


def label(i, letters=True):
    return chr(65 + i) if letters else str(i + 1)


def main():
    r = em.IdsResolver()
    r.load()
    a = em.load_solar_archetypes()
    objs, zones, conns = em.parse_system(
        em.DATA / "UNIVERSE" / "SYSTEMS" / "LI01" / "li01.ini", a, {}, "Li01"
    )
    print(f"{'nick':30s} {'type':10s} {'x':>9s} {'z':>9s}  cell(cs32768)  cell(cs16384)")
    for o in objs:
        if o["type"] not in ("JUMP_GATE", "JUMP_HOLE", "PLANET", "STATION", "SUN"):
            continue
        if not (o["goto"] or o["base"] or o["ids"]):
            continue
        x, z = o["pos"][0], o["pos"][2]
        c1 = f"{label(cell(x))}{cell(z, MAPMAX) + 1}"
        # alternative: 16 cells? try cell size 16384 with 16x16? just show
        print(
            f"{o['nick']:30s} {o['type']:10s} {x:9.0f} {z:9.0f}  {c1}"
        )


if __name__ == "__main__":
    main()
