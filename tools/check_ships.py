# -*- coding: utf-8 -*-
"""Resolve ship packages at Li01_01_Base and inspect flag patterns."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import extract_map as em  # noqa: E402

EQUIP = em.DATA / "EQUIPMENT"
SHIPS = em.DATA / "SHIPS"


def main():
    # goods.ini: shiphull -> ship, package -> hull
    hull2ship = {}
    pack2hull = {}
    for sec in em.parse_ini(EQUIP / "goods.ini"):
        if sec["name"] != "good":
            continue
        nick = em.first(sec["pairs"], "nickname")
        cat = (em.first(sec["pairs"], "category") or "").lower()
        if cat == "shiphull":
            hull2ship[nick] = em.first(sec["pairs"], "ship")
        elif cat == "ship":
            pack2hull[nick] = em.first(sec["pairs"], "hull")
    print("shiphulls:", len(hull2ship), "packages:", len(pack2hull))

    # shiparch ship -> ids_name
    ship_ids = {}
    for sec in em.parse_ini(SHIPS / "shiparch.ini"):
        if sec["name"] != "ship":
            continue
        nick = em.first(sec["pairs"], "nickname")
        ship_ids[nick] = em.first(sec["pairs"], "ids_name")

    resolver = em.IdsResolver()
    resolver.load()

    # market_ships entries at Li01_01_Base
    cur = None
    print("\n=== Li01_01_Base ships ===")
    for sec in em.parse_ini(EQUIP / "market_ships.ini"):
        if sec["name"] != "basegood":
            continue
        base = em.first(sec["pairs"], "base")
        if (base or "").lower() != "li01_01_base":
            continue
        for k, v in sec["pairs"]:
            if k != "marketgood":
                continue
            parts = [p.strip() for p in v.split(",")]
            pack = parts[0]
            flags = parts[1:]
            hull = pack2hull.get(pack)
            ship = hull2ship.get(hull)
            ids = ship_ids.get(ship)
            name = resolver.name(int(ids)) if ids else None
            print(f"{pack:16s} flags={flags} hull={hull} ship={ship} name={name}")


if __name__ == "__main__":
    main()
