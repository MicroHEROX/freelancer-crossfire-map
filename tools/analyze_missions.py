# -*- coding: utf-8 -*-
"""Count variant-system references in the campaign mission scripts."""
import re
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent))
import extract_map as em  # noqa: E402

MISSIONS = em.DATA / "MISSIONS"
OUT = em.OUT / "probe"
OUT.mkdir(parents=True, exist_ok=True)

VARIANTS = [
    "CF01t", "CF01tk", "CF01tn", "CF01tn2", "CF01ts", "CF01tns",
    "CF60", "CF60b", "CF60c",
    "CF68", "CF68b",
    "CF90", "CF90b",
    "Ku03", "Ku03b",
    "Bw01", "Bw01b",
    "St02", "St02tk", "St02b", "St02c",
    "St03", "St03b", "St03b2",
    "CF14", "CF14tk",
    "CF18", "CF18tk",
    "CF20", "CF20t",
    "FP7_system", "FP7_systemmp",
    "CF41", "CF103", "CF13",
    "CF99", "CF98",
    "CF53", "CF54",
]

texts = {}
for p in sorted(MISSIONS.rglob("*.ini")):
    try:
        texts[str(p.relative_to(MISSIONS))] = p.read_text(encoding="utf-8", errors="replace")
    except OSError:
        pass

lines = []
lines.append(f"mission ini files: {len(texts)}")
for v in VARIANTS:
    pat = re.compile(r"\b" + re.escape(v) + r"\b", re.I)
    hits = []
    for name, text in texts.items():
        n = len(pat.findall(text))
        if n:
            hits.append(f"{name}x{n}")
    lines.append(f"{v:16s} -> {'; '.join(hits) if hits else '-'}")

# also dump the full list of systems referenced in M13 (last mission)
m13 = {k: v for k, v in texts.items() if k.lower().startswith("m13")}
lines.append("")
lines.append("M13 files: " + ", ".join(m13))
for name, text in m13.items():
    sysrefs = re.findall(r"\b(?:Li0\d|Br0\d|Ku0\d|Rh0\d|Bw\d+|Ew\d+|Iw\d+|St0\w+|CF\d+\w*|Hi0\d|FP7\w*|rw01|sector\d+)\b", text, re.I)
    from collections import Counter

    lines.append(f"  {name}: {dict(Counter(sysrefs))}")

(OUT / "mission_variants.txt").write_text("\n".join(lines), encoding="utf-8")
print("done")
