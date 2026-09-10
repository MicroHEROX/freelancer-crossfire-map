# -*- coding: utf-8 -*-
"""
Freelancer Crossfire -> interactive star map data extractor.

Reads the game's INI files and resource DLLs and produces JS data files for
the HTML map viewer:
  map/data/ids.js          - referenced IDS strings (names, short names, infocards)
  map/data/universe.js     - sectors, systems, jump connections
  map/data/systems/*.js    - per-system objects / zones

Run:  python map/tools/extract_map.py
"""
import html as html_lib
import json
import os
import math
import re
import struct
import sys
from collections import Counter, OrderedDict, defaultdict
from pathlib import Path

import pefile

# ---------------------------------------------------------------------------
# 路径配置
#   REPO  = 本仓库根目录（本文件位于 <repo>/tools/）
#   GAME  = 游戏安装目录，内含 DATA 与 EXE 的 "Freelancer Crossfire" 文件夹
#           默认取仓库上一级的 Freelancer Crossfire，可用环境变量 FLCF_GAME 覆盖
# ---------------------------------------------------------------------------
REPO = Path(__file__).resolve().parent.parent
ROOT = REPO
GAME = Path(os.environ.get("FLCF_GAME", str(REPO.parent / "Freelancer Crossfire")))
DATA = GAME / "DATA"
EXE = GAME / "EXE"
OUT = REPO / "data"
SYS_OUT = OUT / "systems"

# ---------------------------------------------------------------------------
# SP final-state configuration (Crossfire 2.0.1, single player)
#
# Mission-phase copies of systems: same display name, same map slot, nearly
# identical content.  The plain system is the one that stays reachable after
# the campaign (openspm13 unlocks its gates), so it is the final version.
# ---------------------------------------------------------------------------
MISSION_VARIANTS = {
    "CF01t": "CF01",
    "CF01tk": "CF01",
    "CF01tn": "CF01",
    "CF01tn2": "CF01",
    "CF01ts": "CF01",
    "CF01tns": "CF01",
    "CF60b": "CF60",
    "CF60c": "CF60",
    "CF68b": "CF68",
    "CF90b": "CF90",
    "Ku03b": "Ku03",
    "Bw01b": "Bw01",
    "St02tk": "St02",
    "CF14tk": "CF14",
    "CF18tk": "CF18",
    "CF20t": "CF20",
    "CF41": "CF103",
    "FP7_system": "FP7_systemmp",
}

# Story-only systems (only reachable through mission teleports)
STORY_ONLY = {"CF99"}

# dummy navmap placeholders without a system file
DUMMY_SYSTEMS = {"sector01", "sector02", "sector03", "sector04", "sector05"}

# nav map sector label overrides (house_id -> display name; not present in the
# resource DLLs, taken from the game's own naming: 自由海军/库萨里/莱茵兰…)
LABEL_OVERRIDES = {
    1249: "自由联盟",
    1250: "布列塔尼亚",
    1251: "库萨里",
    1252: "莱茵兰",
    1381: "内核",
}


# ----------------------------------------------------------------------------
# INI parsing
# ----------------------------------------------------------------------------


def read_text(path):
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "utf-8", "cp936", "cp1252"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1", "replace")


def parse_ini(path):
    """Return list of sections: {'name': str, 'pairs': [(key, value), ...]}"""
    sections = []
    cur = None
    for raw in read_text(path).splitlines():
        line = raw.strip()
        if not line or line.startswith(";") or line.startswith("//"):
            continue
        if ";" in line:
            line = line.split(";", 1)[0].strip()
            if not line:
                continue
        if line.startswith("[") and "]" in line:
            cur = {"name": line[1 : line.index("]")].strip().lower(), "pairs": []}
            sections.append(cur)
        elif "=" in line and cur is not None:
            key, value = line.split("=", 1)
            cur["pairs"].append((key.strip().lower(), value.strip()))
    return sections


def first(pairs, key, default=None):
    for k, v in reversed(pairs):
        if k == key:
            return v
    return default


def all_values(pairs, key):
    return [v for k, v in pairs if k == key]


def to_vec(text, n=3, cast=float):
    if not text:
        return None
    parts = [p.strip() for p in text.split(",")]
    try:
        vals = [cast(p) for p in parts[:n]]
    except ValueError:
        return None
    while len(vals) < n:
        vals.append(cast(0))
    return vals


def ids_val(text):
    """IDS value from INI; 0/1/empty mean 'none'."""
    try:
        v = int(text or 0)
    except (TypeError, ValueError):
        return None
    return v if v > 1 else None


# ----------------------------------------------------------------------------
# Resource DLL / IDS resolution
# ----------------------------------------------------------------------------


def _pick_lang(entries):
    """Choose the best language variant of a resource block.

    Prefer Simplified Chinese (2052), then neutral (4), then English (1033);
    ties in non-empty string count fall back to that priority, otherwise the
    variant with the most non-empty strings wins.
    """
    priority = {2052: 0, 4: 1, 1033: 2}
    best = None
    best_key = None
    for e in entries:
        key = (priority.get(e.id, 9), 0)
        if best is None or key < best_key:
            best, best_key = e, key
    return best


def parse_string_table(path, lang=2052):
    pe = pefile.PE(str(path), fast_load=True)
    pe.parse_data_directories(
        directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_RESOURCE"]]
    )
    out = {}
    for entry in pe.DIRECTORY_ENTRY_RESOURCE.entries:
        if entry.id != 6:  # RT_STRING
            continue
        for block in entry.directory.entries:
            # pick language variant: prefer the requested language, else the
            # one with the most non-empty strings (game locale fallback)
            chosen = None
            for e in block.directory.entries:
                if e.id == lang:
                    chosen = e
                    break
            if chosen is None:
                chosen = _pick_lang(block.directory.entries)
            if chosen is None:
                continue
            base = (block.id - 1) * 16
            data = chosen.data.struct
            raw = pe.get_data(data.OffsetToData, data.Size)
            off = 0
            for i in range(16):
                (length,) = struct.unpack_from("<H", raw, off)
                off += 2
                if length:
                    out[base + i] = raw[off : off + length * 2].decode(
                        "utf-16-le", "replace"
                    )
                off += length * 2
    pe.close()
    return out


def parse_html_resources(path, lang=2052):
    pe = pefile.PE(str(path), fast_load=True)
    pe.parse_data_directories(
        directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_RESOURCE"]]
    )
    out = {}
    for entry in pe.DIRECTORY_ENTRY_RESOURCE.entries:
        if entry.id != 23:  # RT_HTML
            continue
        for res in entry.directory.entries:
            chosen = None
            for e in res.directory.entries:
                if e.id == lang:
                    chosen = e
                    break
            if chosen is None:
                chosen = _pick_lang(res.directory.entries)
            if chosen is None:
                continue
            data = chosen.data.struct
            raw = pe.get_data(data.OffsetToData, data.Size)
            out[res.id] = raw
    pe.close()
    return out


def decode_html_resource(raw):
    for enc in ("utf-16-le", "utf-8", "cp1252"):
        try:
            text = raw.decode(enc)
            if "\x00" not in text:
                return text
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1", "replace")


class IdsResolver:
    """IDS = (dll_index << 16) | string_id.

    dll_index 0 is EXE\\Resources.dll (implicit, loaded before the
    [Resources] list), the rest follow freelancer.ini order from 1.
    """

    def __init__(self):
        self.tables = {}  # dll_index -> {sid: text}
        self.infocards = {}  # dll_index -> {sid: html}
        self.loaded_ids = {}  # full ids -> text
        self.loaded_infos = {}  # full ids -> html

    def load(self):
        fl = parse_ini(EXE / "freelancer.ini")
        dlls = ["Resources.dll"]
        for sec in fl:
            if sec["name"] == "resources":
                for k, v in sec["pairs"]:
                    if k == "dll":
                        dlls.append(v.split(";")[0].strip())
        for i, name in enumerate(dlls):
            path = EXE / name
            if not path.exists():
                continue
            self.tables[i] = parse_string_table(path)
            htmls = parse_html_resources(path)
            if htmls:
                self.infocards[i] = {
                    k: rdl_to_html(decode_html_resource(v)) for k, v in htmls.items()
                }
        return dlls

    def name(self, ids):
        if ids is None:
            return None
        if ids in self.loaded_ids:
            return self.loaded_ids[ids]
        text = self.tables.get(ids >> 16, {}).get(ids & 0xFFFF)
        self.loaded_ids[ids] = text
        return text

    def info(self, ids):
        """Infocard: RT_HTML first, then plain RT_STRING text.

        Some mod infocards are stored as RT_STRING but still contain RDL XML
        (e.g. the Utopia system card) - parse those instead of escaping them.
        """
        if ids is None:
            return None
        if ids in self.loaded_infos:
            return self.loaded_infos[ids]
        html = self.infocards.get(ids >> 16, {}).get(ids & 0xFFFF)
        if html is None:
            text = self.tables.get(ids >> 16, {}).get(ids & 0xFFFF)
            if text:
                head = text.lstrip()[:200]
                if head.startswith("<?xml") or "<RDL>" in head:
                    html = rdl_to_html(text)
                else:
                    html = string_to_html(text)
        self.loaded_infos[ids] = html
        return html


# ----------------------------------------------------------------------------
# RDL infocard -> HTML
# ----------------------------------------------------------------------------

TOKEN_RE = re.compile(r"<[^>]+>|[^<]+")
TAG_RE = re.compile(r"</?([A-Za-z]+)")
TRA_RE = re.compile(r'def="(-?\d+)"')
TRA_DATA_RE = re.compile(r'data="(-?\d+)"')
TRA_MASK_RE = re.compile(r'mask="(-?\d+)"')


def rdl_to_html(rdl):
    if not rdl:
        return ""
    rdl = rdl.strip()
    if rdl.startswith("<?xml"):
        idx = rdl.find("?>")
        if idx >= 0:
            rdl = rdl[idx + 2 :]
    parts = []
    in_text = False
    style_stack = []
    for token in TOKEN_RE.findall(rdl):
        if token.startswith("<"):
            m = TAG_RE.match(token)
            if not m:
                continue
            tag = m.group(1).upper()
            if tag == "TEXT":
                if token.startswith("</"):
                    in_text = False
                    if style_stack:
                        parts.append("</span>")
                        style_stack.pop()
                else:
                    in_text = True
                    defs = TRA_RE.search(token)
                    if not defs and style_stack:
                        pass
            elif tag == "PARA":
                parts.append("<br>")
            elif tag == "TRA":
                # standalone style marker: apply to following TEXT
                dm = TRA_DATA_RE.search(token)
                mm = TRA_MASK_RE.search(token)
                dmv = int(dm.group(1)) if dm else 0
                mmv = int(mm.group(1)) if mm else 0
                cls = ""
                if mmv & 1 and dmv in (1, 2):
                    cls = "rdl-head"
                elif mmv & 4 and dmv in (5, 6):
                    cls = "rdl-sub"
                if cls:
                    parts.append(f'<span class="{cls}">')
                    style_stack.append(cls)
        elif in_text:
            # RDL text is XML-escaped in the source; unescape first, then
            # escape for HTML so entities are not double-escaped
            plain = html_lib.unescape(token)
            parts.append(
                plain.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            )
    while style_stack:
        parts.append("</span>")
        style_stack.pop()
    return "".join(parts).strip()


def rdl_to_text(rdl):
    if not rdl:
        return ""
    text = re.sub(r"<PARA\s*/?>", "\n", rdl)
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    return re.sub(r"\n{2,}", "\n", text).strip()


def string_to_html(text):
    """Plain RT_STRING infocard text -> HTML."""
    escaped = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    escaped = escaped.replace("\r\n", "\n").replace("\r", "\n")
    return escaped.replace("\n", "<br>")


# ----------------------------------------------------------------------------
# Static data: solar archetypes, factions, base factions
# ----------------------------------------------------------------------------


def load_solar_archetypes():
    arch = {}
    for sec in parse_ini(DATA / "SOLAR" / "solararch.ini"):
        if sec["name"] != "solar":
            continue
        nick = first(sec["pairs"], "nickname")
        if not nick:
            continue
        radius = first(sec["pairs"], "solar_radius")
        arch[nick.lower()] = {
            "type": (first(sec["pairs"], "type") or "").upper(),
            "radius": float(radius) if radius else None,
            "ids_name": ids_val(first(sec["pairs"], "ids_name")),
            "ids_info": ids_val(first(sec["pairs"], "ids_info")),
        }
    return arch


def load_star_archetypes():
    stars = {}
    path = DATA / "SOLAR" / "StarArch.ini"
    if not path.exists():
        return stars
    for sec in parse_ini(path):
        if sec["name"] != "star":
            continue
        nick = first(sec["pairs"], "nickname")
        if not nick:
            continue
        stars[nick.lower()] = {
            "color": to_vec(first(sec["pairs"], "color")),
            "star_type": first(sec["pairs"], "star_type"),
        }
    return stars


def load_factions(resolver):
    groups = {}
    for sec in parse_ini(DATA / "initialworld.ini"):
        if sec["name"] != "group":
            continue
        nick = first(sec["pairs"], "nickname")
        if not nick:
            continue
        name_ids = first(sec["pairs"], "ids_name")
        short_ids = first(sec["pairs"], "ids_short_name")
        info_ids = first(sec["pairs"], "ids_info")
        groups[nick] = {
            "name": resolver.name(int(name_ids)) if name_ids else None,
            "short": resolver.name(int(short_ids)) if short_ids else None,
            "info": resolver.info(int(info_ids)) if info_ids else None,
        }
    return groups


def load_base_factions():
    base_faction = {}
    for sec in parse_ini(DATA / "MISSIONS" / "mbases.ini"):
        if sec["name"] != "mbase":
            continue
        nick = first(sec["pairs"], "nickname")
        if nick:
            base_faction[nick] = first(sec["pairs"], "local_faction")
    return base_faction


def load_base_rooms():
    """base nickname -> list of room names (Bar/Trader/...)."""
    rooms = defaultdict(list)
    for sec in parse_ini(DATA / "UNIVERSE" / "universe.ini"):
        if sec["name"] != "base":
            continue
        nick = first(sec["pairs"], "nickname")
        if nick:
            rooms[nick] = []
    base_dir = DATA / "UNIVERSE" / "SYSTEMS"
    for base_ini in base_dir.rglob("Bases/*.ini"):
        if base_ini.name.lower().endswith(("mp.ini",)):
            continue
        sections = parse_ini(base_ini)
        if not sections or sections[0]["name"] != "baseinfo":
            continue
        nick = first(sections[0]["pairs"], "nickname")
        if not nick:
            continue
        names = []
        for sec in sections:
            if sec["name"] == "room":
                rn = first(sec["pairs"], "nickname")
                if rn:
                    names.append(rn)
        if nick in rooms or True:
            rooms[nick] = names
    return rooms


EQUIP_FILES = [
    "light_equip.ini",
    "select_equip.ini",
    "misc_equip.ini",
    "engine_equip.ini",
    "st_equip.ini",
    "weapon_equip.ini",
    "prop_equip.ini",
]


def load_item_names():
    """Equipment / commodity nickname -> {name: IDS, info: IDS}."""
    names = {}
    for fname in EQUIP_FILES:
        path = DATA / "EQUIPMENT" / fname
        if not path.exists():
            continue
        for sec in parse_ini(path):
            nick = first(sec["pairs"], "nickname")
            if not nick:
                continue
            ids = ids_val(first(sec["pairs"], "ids_name"))
            info = ids_val(first(sec["pairs"], "ids_info"))
            if ids or info:
                names[nick.lower()] = {"name": ids, "info": info}
    return names


def load_ship_names():
    """Market ship package -> {name: IDS, info: IDS}."""
    hull2ship = {}
    pack2hull = {}
    for sec in parse_ini(DATA / "EQUIPMENT" / "goods.ini"):
        if sec["name"] != "good":
            continue
        nick = first(sec["pairs"], "nickname")
        if not nick:
            continue
        cat = (first(sec["pairs"], "category") or "").lower()
        if cat == "shiphull":
            hull2ship[nick.lower()] = first(sec["pairs"], "ship")
        elif cat == "ship":
            pack2hull[nick.lower()] = first(sec["pairs"], "hull")
    ship_ids = {}
    for sec in parse_ini(DATA / "SHIPS" / "shiparch.ini"):
        if sec["name"] != "ship":
            continue
        nick = first(sec["pairs"], "nickname")
        if not nick:
            continue
        ship_ids[nick.lower()] = {
            "name": ids_val(first(sec["pairs"], "ids_name")),
            "info": ids_val(first(sec["pairs"], "ids_info")),
        }
    out = {}
    for pack, hull in pack2hull.items():
        ship = hull2ship.get((hull or "").lower())
        rec = ship_ids.get((ship or "").lower())
        if rec and (rec["name"] or rec["info"]):
            out[pack] = rec
    return out


def load_markets():
    """base nickname(lower) -> {sell:[commodity], buy:[commodity], equip:[], ships:[]}.

    marketgood flag (index 4 after nickname): 0 = base sells, 1 = base buys.
    """
    markets = {}
    specs = [
        ("market_commodities.ini", "commodity"),
        ("market_misc.ini", "equip"),
        ("market_ships.ini", "ship"),
    ]
    for fname, kind in specs:
        path = DATA / "EQUIPMENT" / fname
        if not path.exists():
            continue
        for sec in parse_ini(path):
            if sec["name"] != "basegood":
                continue
            base = first(sec["pairs"], "base")
            if not base:
                continue
            cur = markets.setdefault(
                base.lower(), {"sell": [], "buy": [], "equip": [], "ships": []}
            )
            for k, v in sec["pairs"]:
                if k != "marketgood":
                    continue
                parts = [x.strip() for x in v.split(",")]
                if not parts or not parts[0]:
                    continue
                nick = parts[0]
                flag = parts[5] if len(parts) > 5 else "0"
                sold = flag not in ("1",)
                if kind == "commodity":
                    cur["sell" if sold else "buy"].append(nick)
                elif kind == "equip":
                    cur["equip"].append(nick)
                else:
                    if sold:
                        cur["ships"].append(nick)
    return markets


# ----------------------------------------------------------------------------
# Universe / sectors
# ----------------------------------------------------------------------------


def load_universe(resolver):
    systems = OrderedDict()
    bases = {}
    for sec in parse_ini(DATA / "UNIVERSE" / "universe.ini"):
        pairs = sec["pairs"]
        if sec["name"] == "system":
            nick = first(pairs, "nickname")
            if not nick:
                continue
            strid = first(pairs, "strid_name")
            info = first(pairs, "ids_info")
            systems[nick] = {
                "nick": nick,
                "file": first(pairs, "file"),
                "pos": to_vec(first(pairs, "pos"), 2),
                "name": resolver.name(int(strid)) if strid else None,
                "info": resolver.info(int(info)) if info else None,
                "visit": int(first(pairs, "visit") or 0),
                "navmapscale": float(first(pairs, "NavMapScale") or 1.0),
            }
        elif sec["name"] == "base":
            nick = first(pairs, "nickname")
            if not nick:
                continue
            strid = first(pairs, "strid_name")
            bases[nick] = {
                "nick": nick,
                "system": first(pairs, "system"),
                "name": resolver.name(int(strid)) if strid else None,
            }
    return systems, bases


def load_sectors():
    sectors = []
    grid = {}
    cur = None
    for sec in parse_ini(DATA / "UNIVERSE" / "multiuniverse.ini"):
        if sec["name"] == "3x3":
            for k, v in sec["pairs"]:
                if k == "mapping":
                    parts = [p.strip() for p in v.split(",")]
                    grid[parts[0].lower()] = [float(parts[1]), float(parts[2])]
        elif sec["name"] == "sector":
            cur = {"id": None, "labels": [], "systems": []}
            sectors.append(cur)
            for k, v in sec["pairs"]:
                parts = [p.strip() for p in v.split(",")]
                if k == "mapping" and parts:
                    cur["id"] = parts[0].lower()
                elif k == "label":
                    cur["labels"].append(
                        {
                            "ids": int(parts[0]),
                            "x": float(parts[1]),
                            "y": float(parts[2]),
                        }
                    )
                elif k == "system":
                    cur["systems"].append(
                        {"nick": parts[0], "x": float(parts[1]), "y": float(parts[2])}
                    )
    for s in sectors:
        s["grid"] = grid.get(s["id"] or "", None)
    return sectors


# ----------------------------------------------------------------------------
# System files
# ----------------------------------------------------------------------------


def system_file_path(rel):
    if not rel:
        return None
    rel = rel.replace("/", "\\")
    if rel.lower().startswith("universe\\"):
        return DATA / rel
    return DATA / "UNIVERSE" / rel


def parse_system(path, archetypes, stars, sys_nick=None):
    sys_nick = sys_nick or path.stem
    objects = []
    zones = []
    connections = []
    for sec in parse_ini(path):
        pairs = sec["pairs"]
        if sec["name"] == "object":
            nick = first(pairs, "nickname")
            arch = first(pairs, "archetype")
            pos = to_vec(first(pairs, "pos"))
            if pos is None:
                continue
            a = archetypes.get((arch or "").lower(), {})
            otype = a.get("type", "")
            obj = {
                "nick": nick,
                "type": otype or "UNKNOWN",
                "arch": arch,
                "pos": [round(pos[0], 1), round(pos[1], 1), round(pos[2], 1)],
                "radius": a.get("radius"),
                "ids": ids_val(first(pairs, "ids_name")),
                "info": ids_val(first(pairs, "ids_info")),
                "archIds": a.get("ids_name"),
                "archInfo": a.get("ids_info"),
                "base": first(pairs, "base"),
                "goto": first(pairs, "goto"),
                "rep": first(pairs, "reputation"),
                "visit": int(first(pairs, "visit") or 0),
                "star": first(pairs, "star"),
                "burn": to_vec(first(pairs, "burn_color"), 3, int),
                "atmo": float(first(pairs, "atmosphere_range") or 0) or None,
                "difficulty": first(pairs, "difficulty_level"),
            }
            if otype == "TRADELANE_RING":
                obj["prev"] = first(pairs, "prev_ring")
                obj["next"] = first(pairs, "next_ring")
                obj["tlName"] = ids_val(first(pairs, "tradelane_space_name"))
            if otype in ("JUMP_GATE", "JUMP_HOLE") and obj["goto"]:
                parts = [p.strip() for p in obj["goto"].split(",")]
                if len(parts) >= 2:
                    connections.append(
                        {
                            "from": sys_nick,
                            "to": parts[0],
                            "via": nick,
                            "kind": "gate" if otype == "JUMP_GATE" else "hole",
                            "destObj": parts[1],
                        }
                    )
            objects.append(obj)
        elif sec["name"] == "zone":
            nick = first(pairs, "nickname")
            pos = to_vec(first(pairs, "pos"))
            if pos is None or not nick:
                continue
            flags = int(first(pairs, "property_flags") or 0)
            size = to_vec(first(pairs, "size"), 3)
            if size and len(size) == 1:
                size = [size[0]] * 3
            zones.append(
                {
                    "nick": nick,
                    "pos": [round(pos[0], 1), round(pos[1], 1), round(pos[2], 1)],
                    "shape": (first(pairs, "shape") or "").upper(),
                    "size": size,
                    "rotate": to_vec(first(pairs, "rotate")),
                    "flags": flags,
                    "ids": ids_val(first(pairs, "ids_name")),
                    "info": ids_val(first(pairs, "ids_info")),
                    "fog": to_vec(first(pairs, "property_fog_color"), 3, int),
                    "damage": float(first(pairs, "damage") or 0) or None,
                    "density": float(first(pairs, "density") or 0) or None,
                }
            )
    lanes = build_tradelanes(objects)
    return objects, zones, connections, lanes


def build_tradelanes(objects):
    """Chain Trade_Lane_Ring objects via prev_ring/next_ring into polylines."""
    rings = {o["nick"]: o for o in objects if o["type"] == "TRADELANE_RING" and o.get("nick")}
    if not rings:
        return []
    lanes = []
    visited = set()

    def chain(start):
        pts = []
        name = None
        cur = start
        while cur and cur["nick"] not in visited:
            visited.add(cur["nick"])
            pts.append([cur["pos"][0], cur["pos"][2]])
            if cur.get("tlName"):
                name = cur["tlName"]
            nxt = cur.get("next")
            cur = rings.get(nxt) if nxt else None
        return pts, name

    # start from chain heads (no prev_ring)
    for nick, r in rings.items():
        if nick in visited or r.get("prev"):
            continue
        pts, name = chain(r)
        if len(pts) >= 2:
            lanes.append({"pts": pts, "name": name})
    # leftovers: loops or chains whose head is missing
    for nick, r in rings.items():
        if nick in visited:
            continue
        cur = r
        guard = 0
        while cur and cur.get("prev") and rings.get(cur["prev"]) and guard < 500:
            cur = rings[cur["prev"]]
            guard += 1
        pts, name = chain(cur)
        if len(pts) >= 2:
            lanes.append({"pts": pts, "name": name})
    return lanes


# ----------------------------------------------------------------------------
# Zone classification
# ----------------------------------------------------------------------------

ZONE_SKIP_WORDS = (
    "tradelane",
    "exclusion",
    "atmosphere",
    "death",
    "jumpgate",
    "jumphole",
    "dockring",
    "docking",
    "station",
    "battleship",
    "patrol",
    "lane",
    "dock_ring",
)


def zone_kind(z):
    """Return a coarse kind for interesting zones, else None."""
    nick = z["nick"].lower()
    if any(w in nick for w in ZONE_SKIP_WORDS):
        return None
    f = z["flags"]
    if f & 0x8000:
        return "nebula"
    if f & 0x1000:
        return "mine"
    if f & 0x200 or "lava" in nick:
        return "lava"
    if f & 0x100 or "ice" in nick:
        return "ice"
    if f & 0x80:
        return "debris"
    if f & 0x4000 or "gas" in nick:
        return "gas"
    if f & 0x40 or "asteroid" in nick:
        return "asteroid"
    return None


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    SYS_OUT.mkdir(parents=True, exist_ok=True)
    report = []

    resolver = IdsResolver()
    dlls = resolver.load()
    report.append(f"Resource DLLs: {', '.join(dlls)}")

    archetypes = load_solar_archetypes()
    stars = load_star_archetypes()
    factions = load_factions(resolver)
    base_factions = load_base_factions()
    base_rooms = load_base_rooms()
    item_ids = load_item_names()
    ship_ids = load_ship_names()
    markets = load_markets()
    systems, bases = load_universe(resolver)
    sectors = load_sectors()

    report.append(f"solar archetypes: {len(archetypes)}")
    report.append(f"factions: {len(factions)}")
    report.append(f"universe systems: {len(systems)}")
    report.append(f"universe bases: {len(bases)}")
    report.append(f"sectors: {[(s['id'], len(s['systems'])) for s in sectors]}")

    # sector placement
    placed = {}
    duplicates = defaultdict(list)
    for s in sectors:
        for sy in s["systems"]:
            nick = sy["nick"]
            if nick in placed:
                duplicates[nick].append(s["id"])
            else:
                placed[nick] = {"sector": s["id"], "x": sy["x"], "y": sy["y"]}

    missing_layout = [n for n in systems if n not in placed]
    extra_layout = [n for n in placed if n not in systems]
    report.append(f"systems without sector layout: {len(missing_layout)} {missing_layout[:30]}")
    report.append(f"sector systems not in universe.ini: {len(extra_layout)} {extra_layout}")
    if duplicates:
        report.append(f"systems placed in multiple sectors: {dict(duplicates)}")

    # parse all system files
    sys_data = {}
    conn_all = []
    unknown_arch = Counter()
    type_counts = Counter()
    flag_counts = Counter()
    zone_kind_counts = Counter()
    flag_samples = defaultdict(list)
    parse_fail = []
    for nick, info in systems.items():
        if nick.lower().startswith("sector") and not info["file"]:
            continue
        path = system_file_path(info["file"])
        if path is None or not path.exists():
            parse_fail.append((nick, str(path)))
            continue
        objects, zones, conns, lanes = parse_system(path, archetypes, stars, nick)
        for o in objects:
            if o["ids"]:
                resolver.name(o["ids"])
            if o["info"]:
                resolver.info(o["info"])
            if o.get("archIds"):
                resolver.name(o["archIds"])
            if o.get("archInfo"):
                resolver.info(o["archInfo"])
        for z in zones:
            if z["ids"]:
                resolver.name(z["ids"])
            if z["info"]:
                resolver.info(z["info"])
        for lane in lanes:
            if lane["name"]:
                lane["name"] = resolver.name(lane["name"])
        sys_data[nick] = {"objects": objects, "zones": zones, "lanes": lanes}
        conn_all.extend(conns)
        for o in objects:
            type_counts[o["type"]] += 1
            if o["type"] == "UNKNOWN" and o["arch"]:
                unknown_arch[o["arch"]] += 1
        for z in zones:
            flag_counts[z["flags"]] += 1
            k = zone_kind(z)
            if k:
                zone_kind_counts[k] += 1
            if len(flag_samples[z["flags"]]) < 6:
                flag_samples[z["flags"]].append(z["nick"])
    report.append(f"parse failures: {parse_fail}")
    report.append(f"object type counts: {dict(type_counts)}")
    report.append(f"zone kinds: {dict(zone_kind_counts)}")
    report.append(f"top unknown archetypes: {unknown_arch.most_common(25)}")
    report.append("zone flag counts:")
    for flag, cnt in flag_counts.most_common():
        report.append(f"  0x{flag:08X} ({flag}) x{cnt}: {flag_samples[flag]}")

    # random jump destinations
    rj = parse_ini(DATA / "UNIVERSE" / "RandomJumps.ini")
    obj_system = {}
    for nick, sd in sys_data.items():
        for o in sd["objects"]:
            if o["nick"]:
                obj_system[o["nick"]] = nick
    random_jumps = defaultdict(list)
    for sec in rj:
        if sec["name"] != "randomjump":
            continue
        obj = first(sec["pairs"], "object")
        for v in all_values(sec["pairs"], "goto"):
            parts = [p.strip() for p in v.split(",")]
            if obj and parts:
                random_jumps[obj].append(parts[0])
    report.append(f"random jump objects: {len(random_jumps)}")

    # connections (case-insensitive target resolution, deduped)
    index = {n.lower(): n for n in systems}
    link_map = {}
    dangling = []
    for c in conn_all:
        target = index.get(c["to"].lower())
        if target is None:
            dangling.append((c["from"], c["to"], c["via"]))
            continue
        c["to"] = target
        key = tuple(sorted([c["from"], c["to"]])) + (c["kind"],)
        entry = link_map.get(key)
        if entry is None:
            entry = {
                "a": c["from"],
                "b": c["to"],
                "kind": c["kind"],
                "via": c["via"],
                "obj": c["destObj"],
                "random": list(random_jumps.get(c["via"], [])),
                "viaList": [c["via"]],
            }
            link_map[key] = entry
        else:
            entry["viaList"].append(c["via"])
            for t in random_jumps.get(c["via"], []):
                if t not in entry["random"]:
                    entry["random"].append(t)
    links = list(link_map.values())
    report.append(f"jump links: {len(links)} (dangling: {len(dangling)})")
    report.append(f"dangling sample: {dangling[:15]}")

    # base -> object link
    base_objects = {}
    for nick, sd in sys_data.items():
        for o in sd["objects"]:
            if o["base"]:
                base_objects[o["base"]] = {"system": nick, "object": o["nick"]}

    # NoNavMap (systems where the in-game nav map is unavailable)
    nonav = set()
    for sec in parse_ini(DATA / "UNIVERSE" / "NoNavMap.ini"):
        if sec["name"] == "systems":
            for k, v in sec["pairs"]:
                if k == "nickname":
                    nonav.add(v)
    report.append(f"no-navmap systems: {sorted(nonav)}")

    # neighbor graph
    neighbors = defaultdict(list)
    for l in links:
        neighbors[l["a"]].append(l["b"])
        neighbors[l["b"]].append(l["a"])

    # fallback layout for systems missing from multiuniverse.ini
    special_pos = {"CF99": ("sector03", 14.5, 9.5)}
    for nick in systems:
        if nick in placed or nick in DUMMY_SYSTEMS:
            continue
        if nick in special_pos:
            sec, x, y = special_pos[nick]
            placed[nick] = {"sector": sec, "x": x, "y": y, "approx": True}
            report.append(f"special placement: {nick} at {sec} ({x}, {y})")
            continue
        seen = {nick}
        queue = [nick]
        anchor = None
        while queue and not anchor:
            cur = queue.pop(0)
            for nb in neighbors.get(cur, []):
                if nb in placed:
                    anchor = nb
                    break
                if nb not in seen:
                    seen.add(nb)
                    queue.append(nb)
        if anchor:
            base = placed[anchor]
            placed[nick] = {
                "sector": base["sector"],
                "x": base["x"] + 0.6,
                "y": base["y"] + 0.6,
                "approx": True,
            }
            report.append(f"fallback placement: {nick} near {anchor}")

    # global layout: sectors merged into one big canvas.
    # Relative placement follows the official Crossfire galaxy map
    # (Inner Core centre, Altair left, Sirius bottom-left, Canis top-right,
    #  Sol right).  Screen y grows downwards.
    SECTOR_CELLS = {
        "sector02": (1, 1),  # Inner Core (centre)
        "sector03": (0, 1),  # Altair (left)
        "sector01": (0, 2),  # Sirius (bottom-left)
        "sector04": (2, 0),  # Canis (top-right)
        "sector05": (2, 1),  # Sol (right)
    }
    sector_cells = {}
    for s in sectors:
        if s["id"] in SECTOR_CELLS:
            sector_cells[s["id"]] = SECTOR_CELLS[s["id"]]
            continue
        g = s["grid"]
        if not g:
            continue
        col = int(round((g[0] + 0.245) / 0.245))
        row = int(round((0 - g[1]) / 0.275))
        sector_cells[s["id"]] = (col, row)
    CELL, GAP = 21.0, 6.0

    def to_global(sector_id, x, y):
        col, row = sector_cells.get(sector_id, (0, 0))
        return col * (CELL + GAP) + x, row * (CELL + GAP) + y

    layout_out = {}
    for nick in systems:
        if nick in DUMMY_SYSTEMS:
            continue
        lay = placed.get(nick)
        if not lay:
            continue
        gx, gy = to_global(lay["sector"], lay["x"], lay["y"])
        layout_out[nick] = {
            "gx": round(gx, 2),
            "gy": round(gy, 2),
            "sector": lay["sector"],
            "sx": lay["x"],
            "sy": lay["y"],
        }

    # spread only systems that share the exact same slot (variants / dungeons)
    slot_groups = defaultdict(list)
    for nick, lay in layout_out.items():
        slot_groups[(lay["sector"], round(lay["sx"], 1), round(lay["sy"], 1))].append(nick)
    for key, members in slot_groups.items():
        if len(members) < 2:
            continue
        members.sort(key=lambda n: (n in MISSION_VARIANTS, n in STORY_ONLY, n))
        base = layout_out[members[0]]
        count = len(members) - 1
        for i, nick in enumerate(members[1:], start=1):
            ang = i * (2 * math.pi / count)
            layout_out[nick]["gx"] = round(base["gx"] + 2.0 * math.cos(ang), 2)
            layout_out[nick]["gy"] = round(base["gy"] + 2.0 * math.sin(ang), 2)
            layout_out[nick]["offset"] = True

    # ---- write ids.js (only referenced ids) ----
    ids_out = {}
    for k, v in resolver.loaded_ids.items():
        if v:
            ids_out[str(k)] = v
    info_out = {}
    for k, v in resolver.loaded_infos.items():
        if v:
            info_out[str(k)] = v
    write_js(OUT / "ids.js", "window.IDS", {"names": ids_out, "infos": info_out})

    # ---- write markets.js (base -> sold/bought goods + item infos) ----
    ref = {"sell": set(), "buy": set(), "equip": set(), "ships": set()}
    for m in markets.values():
        for k in ref:
            ref[k].update(n.lower() for n in m[k])

    items_out = {}
    for kind, nicks in ref.items():
        ids_map = ship_ids if kind == "ships" else item_ids
        for n in nicks:
            if n in items_out:
                continue
            rec = ids_map.get(n) or {}
            items_out[n] = {
                "n": resolver.name(rec.get("name")) if rec.get("name") else n,
                "i": resolver.info(rec.get("info")) if rec.get("info") else None,
                "k": kind,
            }

    markets_out = {}
    for base, m in markets.items():
        entry = {k: sorted(set(x.lower() for x in m[k])) for k in ref}
        if any(entry.values()):
            markets_out[base] = entry
    write_js(
        OUT / "markets.js",
        "window.MARKETS",
        {"items": items_out, "bases": markets_out},
    )
    report.append(
        f"markets: {len(markets_out)} bases, {len(items_out)} items, "
        f"{sum(1 for it in items_out.values() if it['i'])} with infocards"
    )

    # ---- write universe.js ----
    sector_out = []
    for s in sectors:
        labels = []
        # house label ids -> system nickname prefixes (for centroid placement)
        house_prefix = {
            1249: ("li",),
            1250: ("br",),
            1251: ("ku",),
            1252: ("rh",),
        }
        sector_systems = [
            sy for sy in s["systems"] if sy["nick"] in layout_out
        ]
        for lb in s["labels"]:
            text = (
                LABEL_OVERRIDES.get(lb["ids"])
                or resolver.name(lb["ids"])
                or str(lb["ids"])
            )
            lx, ly = CELL * 0.5 + lb["x"] * CELL, CELL * 0.5 + lb["y"] * CELL
            prefixes = house_prefix.get(lb["ids"])
            members = []
            if prefixes:
                members = [
                    sy
                    for sy in sector_systems
                    if sy["nick"].lower().startswith(prefixes)
                ]
            elif len(s["labels"]) == 1:
                members = sector_systems
            if members:
                lx = sum(sy["x"] for sy in members) / len(members)
                ly = sum(sy["y"] for sy in members) / len(members)
            labels.append({"text": text, "x": round(lx, 3), "y": round(ly, 3)})
        col, row = sector_cells.get(s["id"], (0, 0))
        sector_out.append(
            {
                "id": s["id"],
                "name": systems.get(s["id"], {}).get("name") or s["id"],
                "grid": s["grid"],
                "cell": [col, row],
                "origin": [round(col * (CELL + GAP), 2), round(row * (CELL + GAP), 2)],
                "labels": labels,
            }
        )

    sys_out = {}
    for nick, info in systems.items():
        if nick in DUMMY_SYSTEMS:
            continue
        lay = layout_out.get(nick)
        entry = {
            "name": info["name"],
            "file": info["file"],
            "visit": info["visit"],
            "info": info["info"],
            "sector": lay["sector"] if lay else None,
            "sx": lay["sx"] if lay else None,
            "sy": lay["sy"] if lay else None,
            "gx": lay["gx"] if lay else None,
            "gy": lay["gy"] if lay else None,
            "upos": info["pos"],
            "objects": len(sys_data.get(nick, {}).get("objects", [])),
            "navmapscale": info.get("navmapscale", 1.0),
            "variantOf": MISSION_VARIANTS.get(nick),
            "story": nick in STORY_ONLY,
            "nonav": nick in nonav,
        }
        sys_out[nick] = entry

    universe = {
        "sectors": sector_out,
        "systems": sys_out,
        "links": links,
        "bases": bases,
        "baseFactions": base_factions,
        "baseRooms": {k: v for k, v in base_rooms.items() if v},
        "baseObjects": base_objects,
        "factions": factions,
        "cell": CELL + GAP,
    }
    write_js(OUT / "universe.js", "window.UNIVERSE", universe)

    # ---- write per-system js ----
    keep_types = {
        "SUN",
        "PLANET",
        "STATION",
        "JUMP_GATE",
        "JUMP_HOLE",
        "WEAPONS_PLATFORM",
        "DOCKING_RING",
        "DESTROYABLE_DEPOT",
        "SATELLITE",
        "MISSION_SATELLITE",
        "AIRLOCK_GATE",
    }
    for nick, sd in sys_data.items():
        objects = []
        for o in sd["objects"]:
            if o["type"] == "TRADELANE_RING":
                continue
            if o["type"] in keep_types or o["base"] or o["ids"] or o["info"] or o["goto"]:
                objects.append(o)
        zones = []
        for z in sd["zones"]:
            kind = zone_kind(z)
            if kind:
                z = dict(z)
                z["kind"] = kind
                zones.append(z)
        payload = {
            "objects": objects,
            "zones": zones,
            "lanes": sd.get("lanes", []),
            "navmapscale": systems[nick].get("navmapscale", 1.0),
        }
        write_js(
            SYS_OUT / f"{nick}.js",
            f'window.__SYS[{json.dumps(nick)}]',
            payload,
            raw_prefix=True,
        )

    report.append(f"systems parsed: {len(sys_data)}")
    report.append(
        "sample Li01: objects=%d zones=%d"
        % (
            len(sys_data.get("Li01", {}).get("objects", [])),
            len(sys_data.get("Li01", {}).get("zones", [])),
        )
    )
    (OUT / "extract_report.txt").write_text("\n".join(report), encoding="utf-8")
    print("done; see map/data/extract_report.txt")


def write_js(path, global_name, obj, raw_prefix=False):
    text = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    if raw_prefix:
        content = f"{global_name} = {text};\n"
    else:
        content = f"{global_name} = {text};\n"
    path.write_text(content, encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
