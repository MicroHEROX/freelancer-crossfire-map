/* Freelancer Crossfire 2.0.1 (SP) interactive star map
 * Levels: universe (all sectors merged) -> system (objects) -> object detail
 */
(function () {
  'use strict';

  const U = window.UNIVERSE;
  const IDS = window.IDS;
  window.__SYS = window.__SYS || {};

  const canvas = document.getElementById('map');
  const ctx = canvas.getContext('2d');
  const tooltip = document.getElementById('tooltip');
  const panel = document.getElementById('panel');
  const panelTitle = document.getElementById('panel-title');
  const panelSub = document.getElementById('panel-sub');
  const panelBody = document.getElementById('panel-body');
  const crumbs = document.getElementById('crumbs');
  const searchInput = document.getElementById('search');
  const searchResults = document.getElementById('search-results');
  const loading = document.getElementById('loading');

  const SECTOR_COLORS = {
    sector01: '#4fc3f7',
    sector02: '#ba68c8',
    sector03: '#ffb74d',
    sector04: '#81c784',
    sector05: '#ef5350',
  };
  const TYPE_COLORS = {
    sun: '#ffd54f',
    planet: '#b0bec5',
    base: '#81c784',
    station: '#4db6ac',
    gate: '#43d9ad',
    hole: '#ff8a65',
    ring: '#90a4ae',
    platform: '#f06292',
    satellite: '#9575cd',
    depot: '#a1887f',
    airlock: '#4fc3f7',
    misc: '#78909c',
  };
  const ROOM_NAMES = {
    bar: '酒吧', trader: '商品商', shipdealer: '飞船商', equipment: '装备商',
    cityscape: '城市景观', deck: '甲板', deck2: '甲板二', deck3: '甲板三',
    shipdealer2: '飞船商二', bar2: '酒吧二', trader2: '商品商二',
    equipment2: '装备商二', cityscape2: '城市景观二', room: '房间',
  };
  const DEFAULT_FILTERS = {
    sun: true, planet: true, base: true, station: true, gate: true, hole: true,
    ring: true, satellite: true, airlock: true, platform: false, depot: false, misc: false,
    fields: true, nebula: true, tradelane: true,
  };

  const state = {
    level: 'universe',
    system: null,
    systemData: null,
    selectedSystem: null,
    selectedObject: null,
    hover: null,
    scale: 1,
    ox: 0,
    oy: 0,
    dragging: false,
    dragStart: null,
    showVariants: false,
    showLabels: true,
    filters: Object.assign({}, DEFAULT_FILTERS),
  };

  let stars = [];

  // ---------------------------------------------------------------- utils
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function nameOf(ids) {
    if (!ids || ids === 1) return null;
    return IDS.names[String(ids)] || null;
  }
  function infoOf(ids) {
    if (!ids || ids === 1) return null;
    return IDS.infos[String(ids)] || null;
  }
  function systemName(nick) {
    const s = U.systems[nick];
    return (s && s.name) ? s.name.trim() : nick;
  }
  function sectorName(id) {
    const s = U.sectors.find((x) => x.id === id);
    return s && s.name ? s.name.replace(/星区$/, '') : (id || '');
  }
  function factionName(nick) {
    const f = U.factions[nick];
    return f && f.name ? f.name : nick;
  }
  function isFinal(nick) {
    const s = U.systems[nick];
    return s && !s.variantOf && !s.story;
  }
  function objCategory(o) {
    if (o.type === 'SUN') return 'sun';
    if (o.type === 'PLANET') return 'planet';
    if (o.base) return 'base';
    if (o.type === 'JUMP_GATE') return 'gate';
    if (o.type === 'JUMP_HOLE') return 'hole';
    if (o.type === 'STATION') return 'station';
    if (o.type === 'DOCKING_RING') return 'ring';
    if (o.type === 'WEAPONS_PLATFORM') return 'platform';
    if (o.type === 'SATELLITE' || o.type === 'MISSION_SATELLITE') return 'satellite';
    if (o.type === 'DESTROYABLE_DEPOT') return 'depot';
    if (o.type === 'AIRLOCK_GATE') return 'airlock';
    return 'misc';
  }
  function objVisible(o) {
    const cat = objCategory(o);
    if (!state.filters[cat]) return false;
    if (cat === 'satellite' && !o.ids) return false;
    return true;
  }
  function objName(o) {
    return nameOf(o.ids) || nameOf(o.archIds) || null;
  }
  function objInfo(o) {
    return infoOf(o.info) || infoOf(o.archInfo) || null;
  }
  function typeLabel(o) {
    const cat = objCategory(o);
    const map = {
      sun: '恒星', planet: '行星', base: '基地', station: '空间站', gate: '跳跃门',
      hole: '跳跃洞', ring: '停靠环', platform: '武器平台', satellite: '卫星/设施',
      depot: '补给仓库', airlock: '气闸', misc: '物体',
    };
    return map[cat] || cat;
  }

  // ---------------------------------------------------------------- view
  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    canvas.style.width = r.width + 'px';
    canvas.style.height = r.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function viewSize() {
    const r = canvas.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }

  function fitView(points, pad) {
    const { w, h } = viewSize();
    if (!points.length) { state.scale = 1; state.ox = 0; state.oy = 0; return; }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
    }
    const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
    const sx = (w - pad * 2) / bw, sy = (h - pad * 2) / bh;
    state.scale = clamp(Math.min(sx, sy), 0.002, 60);
    state.ox = w / 2 - ((minX + maxX) / 2) * state.scale;
    state.oy = h / 2 - ((minY + maxY) / 2) * state.scale;
  }

  // screen coords follow the game nav map: x right, y/z down
  function w2s(x, y) { return [x * state.scale + state.ox, y * state.scale + state.oy]; }
  function s2w(sx, sy) { return [(sx - state.ox) / state.scale, (sy - state.oy) / state.scale]; }

  function makeStars() {
    stars = [];
    const { w, h } = viewSize();
    for (let i = 0; i < 260; i++) {
      stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.2 + 0.2,
        a: Math.random() * 0.5 + 0.15,
      });
    }
  }

  function drawBackground() {
    const { w, h } = viewSize();
    const g = ctx.createRadialGradient(w * 0.5, h * 0.45, 40, w * 0.5, h * 0.5, Math.max(w, h) * 0.8);
    g.addColorStop(0, '#0a1224');
    g.addColorStop(1, '#04060b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (!stars.length) makeStars();
    for (const s of stars) {
      ctx.globalAlpha = s.a;
      ctx.fillStyle = '#cfe4ff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- universe
  function visibleSystems() {
    return Object.keys(U.systems).filter((n) => {
      const s = U.systems[n];
      if (!s.gx && s.gx !== 0) return false;
      if (state.showVariants) return true;
      return !s.variantOf && !s.story;
    });
  }

  function drawUniverse() {
    drawBackground();
    const nicks = visibleSystems();
    const visible = new Set(nicks);

    // sector regions
    for (const sec of U.sectors) {
      const [ox, oy] = sec.origin;
      const cell = U.cell;
      const p1 = w2s(ox - 2, oy + cell - 2);
      const p2 = w2s(ox + cell - 2, oy - 2);
      ctx.save();
      ctx.fillStyle = hexA(SECTOR_COLORS[sec.id] || '#4fc3f7', 0.045);
      roundRect(p1[0], p1[1], p2[0] - p1[0], p2[1] - p1[1], 14);
      ctx.fill();
      ctx.strokeStyle = hexA(SECTOR_COLORS[sec.id] || '#4fc3f7', 0.22);
      ctx.setLineDash([6, 8]);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      // sector name
      ctx.fillStyle = hexA(SECTOR_COLORS[sec.id] || '#4fc3f7', 0.5);
      ctx.font = '600 26px ' + getComputedStyle(document.body).fontFamily;
      const cp = w2s(ox + 1.5, oy + cell - 2.6);
      ctx.fillText(sectorName(sec.id), cp[0], cp[1]);
      // house labels are drawn later, on top of the systems (see below)
      ctx.restore();
    }

    // links
    for (const l of U.links) {
      if (!visible.has(l.a) || !visible.has(l.b)) continue;
      const a = U.systems[l.a], b = U.systems[l.b];
      const p1 = w2s(a.gx, a.gy), p2 = w2s(b.gx, b.gy);
      const variant = a.variantOf || b.variantOf || a.story || b.story;
      ctx.save();
      if (l.kind === 'gate') {
        ctx.strokeStyle = variant ? 'rgba(67,217,173,0.25)' : 'rgba(67,217,173,0.5)';
        ctx.lineWidth = 1.6;
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = variant ? 'rgba(255,138,101,0.25)' : 'rgba(255,138,101,0.55)';
        ctx.lineWidth = 1.3;
        ctx.setLineDash([5, 5]);
      }
      ctx.beginPath();
      ctx.moveTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]);
      ctx.stroke();
      if (l.random && l.random.length) {
        ctx.strokeStyle = 'rgba(179,136,255,0.85)';
        ctx.lineWidth = 2.2;
        ctx.setLineDash([2, 6]);
        ctx.beginPath();
        ctx.moveTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    // systems
    const labelOn = state.showLabels && state.scale > 0.35;
    const labelItems = [];
    for (const nick of nicks) {
      const s = U.systems[nick];
      const p = w2s(s.gx, s.gy);
      const r = nodeRadius(s);
      const color = SECTOR_COLORS[s.sector] || '#90a4ae';
      const isSel = state.selectedSystem === nick;
      const isHov = state.hover && state.hover.kind === 'system' && state.hover.nick === nick;

      if (!s.variantOf && !s.story) {
        const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r * 2.4);
        g.addColorStop(0, hexA(color, 0.35));
        g.addColorStop(1, hexA(color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p[0], p[1], r * 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
      ctx.fillStyle = s.story ? '#546e7a' : (s.variantOf ? hexA(color, 0.35) : color);
      ctx.fill();
      if (s.variantOf || s.story) {
        ctx.setLineDash([2, 2]);
        ctx.strokeStyle = hexA(color, 0.8);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (s.nonav) {
        ctx.strokeStyle = '#ffb74d';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(p[0], p[1], r + 2.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (isSel || isHov) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(p[0], p[1], r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (labelOn || isSel || isHov) {
        labelItems.push({
          x: p[0],
          y: p[1] + r + 13,
          h: 13,
          text: systemName(nick),
          font: (s.variantOf || s.story ? '' : '600 ') + '12px ' + getComputedStyle(document.body).fontFamily,
          color: isSel || isHov ? '#fff' : 'rgba(215,227,244,0.85)',
          priority: (isSel || isHov ? 1e6 : 0) + (s.objects || 0),
        });
      }
    }
    if (labelItems.length) {
      labelItems.sort((a, b) => b.priority - a.priority);
      placeLabels(labelItems);
    }

    // house name watermarks on top
    ctx.save();
    ctx.font = '700 22px ' + getComputedStyle(document.body).fontFamily;
    ctx.textAlign = 'center';
    for (const sec of U.sectors) {
      const [ox, oy] = sec.origin;
      ctx.fillStyle = hexA(SECTOR_COLORS[sec.id] || '#4fc3f7', 0.35);
      for (const lb of sec.labels) {
        const lp = w2s(ox + lb.x, oy + lb.y);
        ctx.fillText(lb.text, lp[0], lp[1]);
      }
    }
    ctx.restore();
  }

  function nodeRadius(s) {
    const base = 2.5 + Math.min(4, (s.objects || 0) / 45);
    const k = clamp(Math.pow(state.scale / 10, 0.4), 0.55, 2.0);
    return base * k;
  }

  function placeLabels(items) {
    // greedy label placement with overlap avoidance; items sorted by priority
    const placed = [];
    const pad = 2;
    for (const it of items) {
      ctx.font = it.font;
      const w = ctx.measureText(it.text).width;
      const rect = {
        x: it.x - w / 2 - pad,
        y: it.y - it.h + pad,
        w: w + pad * 2,
        h: it.h + pad * 2,
      };
      let ok = true;
      for (const r of placed) {
        if (rect.x < r.x + r.w && rect.x + rect.w > r.x && rect.y < r.y + r.h && rect.y + rect.h > r.y) {
          ok = false;
          break;
        }
      }
      if (ok) {
        placed.push(rect);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(4,8,16,0.85)';
        ctx.textAlign = 'center';
        ctx.strokeText(it.text, it.x, it.y);
        ctx.fillStyle = it.color;
        ctx.fillText(it.text, it.x, it.y);
        ctx.textAlign = 'left';
      }
    }
  }

  function hexA(hex, a) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------------------------------------------------------------- system
  function drawSystem() {
    drawBackground();
    const data = state.systemData;
    if (!data) return;
    const nick = state.system;
    const sys = U.systems[nick];

    // in-game style grid (8x8 cells, columns A-H, rows 1-8)
    drawGrid();

    // trade lanes (drawn under everything else, like the game)
    if (state.filters.tradelane && data.lanes) {
      ctx.save();
      ctx.strokeStyle = 'rgba(90,123,148,0.9)';
      ctx.lineWidth = 2;
      for (const lane of data.lanes) {
        ctx.beginPath();
        lane.pts.forEach((pt, i) => {
          const p = w2s(pt[0], pt[1]);
          if (i === 0) ctx.moveTo(p[0], p[1]);
          else ctx.lineTo(p[0], p[1]);
        });
        ctx.stroke();
      }
      if (state.scale > 0.006) {
        ctx.fillStyle = 'rgba(120,160,190,0.9)';
        for (const lane of data.lanes) {
          for (const pt of lane.pts) {
            const p = w2s(pt[0], pt[1]);
            ctx.beginPath();
            ctx.arc(p[0], p[1], 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.restore();
    }

    // zones
    for (const z of data.zones) {
      if (z.kind === 'nebula' && !state.filters.nebula) continue;
      if (z.kind !== 'nebula' && !state.filters.fields) continue;
      drawZone(z);
    }
    // objects
    for (const o of data.objects) {
      if (!objVisible(o)) continue;
      drawObject(o);
    }
    // labels
    if (state.showLabels) {
      const items = [];
      for (const o of data.objects) {
        if (!objVisible(o)) continue;
        const cat = objCategory(o);
        const important = cat === 'sun' || cat === 'planet' || cat === 'base' || cat === 'gate' || cat === 'hole' || cat === 'station';
        const nm = nameOf(o.ids) || (important ? nameOf(o.archIds) : null);
        if (!nm) continue;
        if (!important && state.scale < 0.3) continue;
        const p = w2s(o.pos[0], o.pos[2]);
        const r = objectRadius(o);
        const isSel = state.selectedObject === o.nick;
        const isHov = state.hover && state.hover.kind === 'object' && state.hover.obj.nick === o.nick;
        items.push({
          x: p[0],
          y: p[1] - r - 6,
          h: 12,
          text: nm,
          font: '11px ' + getComputedStyle(document.body).fontFamily,
          color: isSel || isHov ? '#fff' : 'rgba(200,216,236,0.8)',
          priority: (isSel || isHov ? 1e6 : 0) + (important ? 1000 : 0) + r * 10,
        });
      }
      if (state.filters.tradelane && data.lanes && state.scale > 0.008) {
        for (const lane of data.lanes) {
          if (!lane.name || lane.pts.length < 2) continue;
          const mid = lane.pts[Math.floor(lane.pts.length / 2)];
          const p = w2s(mid[0], mid[1]);
          items.push({
            x: p[0],
            y: p[1] + 12,
            h: 11,
            text: lane.name,
            font: '10px ' + getComputedStyle(document.body).fontFamily,
            color: 'rgba(140,180,205,0.85)',
            priority: 1,
          });
        }
      }
      items.sort((a, b) => b.priority - a.priority);
      placeLabels(items);
    }
  }

  function drawGrid() {
    // matches the in-game nav map (verified against a real navmap screenshot):
    // area = +/-131072m / NavMapScale, 8x8 cells, columns A-H, rows 1-8,
    // labels drawn at cell centres, +z downwards.
    const navscale = (state.systemData && state.systemData.navmapscale) ||
      (state.system && U.systems[state.system] && U.systems[state.system].navmapscale) || 1;
    const mapmax = 131072 / navscale;
    const step = mapmax / 4;
    const { w, h } = viewSize();
    ctx.save();
    ctx.strokeStyle = 'rgba(16,58,82,0.95)';
    ctx.lineWidth = 1;
    ctx.font = '11px ' + getComputedStyle(document.body).fontFamily;
    ctx.fillStyle = 'rgba(148,222,239,0.85)';
    // grid lines (9 lines -> 8 cells)
    for (let i = -4; i <= 4; i++) {
      const top = w2s(step * i, -mapmax);
      const bot = w2s(step * i, mapmax);
      if (bot[0] > -40 && top[0] < w + 40) {
        ctx.beginPath();
        ctx.moveTo(top[0], Math.max(0, Math.min(h, top[1])));
        ctx.lineTo(bot[0], Math.max(0, Math.min(h, bot[1])));
        ctx.stroke();
      }
      const left = w2s(-mapmax, step * i);
      const right = w2s(mapmax, step * i);
      if (right[1] > -40 && left[1] < h + 40) {
        ctx.beginPath();
        ctx.moveTo(Math.max(0, Math.min(w, left[0])), left[1]);
        ctx.lineTo(Math.max(0, Math.min(w, right[0])), right[1]);
        ctx.stroke();
      }
    }
    // cell labels A-H / 1-8 at cell centres
    ctx.textAlign = 'center';
    for (let i = 0; i < 8; i++) {
      const c = -mapmax + (i + 0.5) * step;
      const letter = String.fromCharCode(65 + i);
      const num = String(i + 1);
      const pb = w2s(c, mapmax);
      const pt = w2s(c, -mapmax);
      if (pb[0] > 8 && pb[0] < w - 8) {
        ctx.fillText(letter, pb[0], Math.min(h - 6, pb[1] + 14));
        ctx.fillText(letter, pt[0], Math.max(14, pt[1] - 6));
      }
      const pl = w2s(-mapmax, c);
      const pr = w2s(mapmax, c);
      if (pl[1] > 14 && pl[1] < h - 8) {
        ctx.textAlign = 'right';
        ctx.fillText(num, Math.max(14, pl[0] - 6), pl[1] + 4);
        ctx.textAlign = 'left';
        ctx.fillText(num, Math.min(w - 6, pr[0] + 6), pr[1] + 4);
      }
    }
    ctx.restore();
    // system name at the bottom centre (in-game map style)
    if (state.system) {
      ctx.save();
      ctx.font = '600 16px ' + getComputedStyle(document.body).fontFamily;
      ctx.fillStyle = 'rgba(148,222,239,0.55)';
      ctx.textAlign = 'center';
      ctx.fillText(systemName(state.system).toUpperCase(), w / 2, h - 14);
      ctx.restore();
    }
  }

  function fmtKm(v) {
    const a = Math.abs(v);
    if (a >= 1000000) return (v / 1000000).toFixed(1) + 'M';
    if (a >= 1000) return (v / 1000).toFixed(a % 1000 === 0 ? 0 : 1) + 'k';
    return String(v);
  }

  const ZONE_STYLE = {
    nebula: { fill: 'rgba(120,80,200,0.10)', stroke: 'rgba(160,120,255,0.35)' },
    asteroid: { fill: 'rgba(150,140,120,0.10)', stroke: 'rgba(190,180,150,0.30)' },
    ice: { fill: 'rgba(120,180,230,0.10)', stroke: 'rgba(150,210,255,0.30)' },
    debris: { fill: 'rgba(120,120,120,0.08)', stroke: 'rgba(160,160,160,0.25)' },
    mine: { fill: 'rgba(230,120,60,0.10)', stroke: 'rgba(255,150,80,0.35)' },
    lava: { fill: 'rgba(230,60,40,0.10)', stroke: 'rgba(255,90,60,0.35)' },
    gas: { fill: 'rgba(80,200,140,0.10)', stroke: 'rgba(110,230,170,0.30)' },
  };

  function drawZone(z) {
    const st = ZONE_STYLE[z.kind] || ZONE_STYLE.asteroid;
    const size = z.size || [1000, 0, 1000];
    const rx = Math.abs(size[0] || 1000) * state.scale;
    const ry = Math.abs(size[2] || size[0] || 1000) * state.scale;
    if (rx < 1 && ry < 1) return;
    const p = w2s(z.pos[0], z.pos[2]);
    const rot = z.rotate ? (-z.rotate[1] * Math.PI) / 180 : 0;
    ctx.save();
    ctx.translate(p[0], p[1]);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.max(rx, 1), Math.max(ry, 1), 0, 0, Math.PI * 2);
    ctx.fillStyle = st.fill;
    ctx.fill();
    ctx.strokeStyle = st.stroke;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function objectRadius(o) {
    const cat = objCategory(o);
    if (cat === 'sun') return clamp(3 + Math.sqrt(o.radius || 2000) / 12, 4, 22);
    if (cat === 'planet') return clamp(2 + Math.sqrt(o.radius || 1500) / 16, 2.5, 16);
    if (cat === 'gate' || cat === 'hole') return 7;
    if (cat === 'base') return 6;
    if (cat === 'station') return 5;
    return 3;
  }

  function drawObject(o) {
    const cat = objCategory(o);
    const p = w2s(o.pos[0], o.pos[2]);
    const r = objectRadius(o);
    const color = TYPE_COLORS[cat] || '#90a4ae';
    const isSel = state.selectedObject === o.nick;
    const isHov = state.hover && state.hover.kind === 'object' && state.hover.obj.nick === o.nick;

    ctx.save();
    if (cat === 'sun') {
      const rgb = o.burn ? [o.burn[0], o.burn[1], o.burn[2]] : [255, 213, 79];
      const c = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      const c0 = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`;
      const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r * 3);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.35, c);
      g.addColorStop(1, c0);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p[0], p[1], r * 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(p[0], p[1], r * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill();
    } else if (cat === 'planet') {
      const g = ctx.createRadialGradient(p[0] - r * 0.4, p[1] - r * 0.4, r * 0.1, p[0], p[1], r);
      g.addColorStop(0, '#e3ebf5');
      g.addColorStop(1, '#5c6f85');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fill();
      if (o.atmo) {
        ctx.strokeStyle = 'rgba(120,180,255,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p[0], p[1], r + 2, 0, Math.PI * 2); ctx.stroke();
      }
    } else if (cat === 'base') {
      ctx.fillStyle = color;
      roundRect(p[0] - r, p[1] - r, r * 2, r * 2, 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
      ctx.strokeRect(p[0] - r * 0.5, p[1] - r * 0.5, r, r);
    } else if (cat === 'gate') {
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(p[0], p[1], r * 0.35, 0, Math.PI * 2); ctx.fill();
    } else if (cat === 'hole') {
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p[0], p[1], r * 0.7, 0.4, Math.PI * 1.7); ctx.stroke();
      ctx.beginPath(); ctx.arc(p[0], p[1], r * 0.3, Math.PI * 1.2, Math.PI * 2.6); ctx.stroke();
    } else if (cat === 'station') {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(p[0], p[1] - r); ctx.lineTo(p[0] + r, p[1]);
      ctx.lineTo(p[0], p[1] + r); ctx.lineTo(p[0] - r, p[1]);
      ctx.closePath(); ctx.fill();
    } else if (cat === 'ring' || cat === 'airlock') {
      ctx.strokeStyle = color; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.stroke();
    } else if (cat === 'platform') {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(p[0], p[1] - r); ctx.lineTo(p[0] + r, p[1] + r);
      ctx.lineTo(p[0] - r, p[1] + r); ctx.closePath(); ctx.fill();
    } else {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(p[0], p[1], r * 0.6, 0, Math.PI * 2); ctx.fill();
    }
    if (isSel || isHov) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(p[0], p[1], r + 5, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- draw
  function draw() {
    if (state.level === 'universe') drawUniverse();
    else drawSystem();
  }

  // ---------------------------------------------------------------- hit test
  function hitUniverse(mx, my) {
    const nicks = visibleSystems();
    for (const nick of nicks) {
      const s = U.systems[nick];
      const p = w2s(s.gx, s.gy);
      const r = nodeRadius(s);
      if ((mx - p[0]) ** 2 + (my - p[1]) ** 2 <= (r + 5) ** 2) {
        return { kind: 'system', nick };
      }
    }
    return null;
  }

  function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = clamp(t, 0, 1);
    const x = ax + t * dx, y = ay + t * dy;
    return Math.hypot(px - x, py - y);
  }

  function hitSystem(mx, my) {
    const data = state.systemData;
    if (!data) return null;
    let best = null, bestD = Infinity;
    for (const o of data.objects) {
      if (!objVisible(o)) continue;
      const p = w2s(o.pos[0], o.pos[2]);
      const r = objectRadius(o) + 6;
      const d = (mx - p[0]) ** 2 + (my - p[1]) ** 2;
      if (d <= r * r && d < bestD) { best = o; bestD = d; }
    }
    if (best) return { kind: 'object', obj: best };
    // zones as fallback
    for (const z of data.zones) {
      if (z.kind === 'nebula' && !state.filters.nebula) continue;
      if (z.kind !== 'nebula' && !state.filters.fields) continue;
      const p = w2s(z.pos[0], z.pos[2]);
      const size = z.size || [1000, 0, 1000];
      const rx = Math.max(1, Math.abs(size[0] || 1000) * state.scale);
      const ry = Math.max(1, Math.abs(size[2] || size[0] || 1000) * state.scale);
      const dx = (mx - p[0]) / rx, dy = (my - p[1]) / ry;
      if (dx * dx + dy * dy <= 1) return { kind: 'zone', zone: z };
    }
    // trade lanes
    if (state.filters.tradelane && data.lanes) {
      for (const lane of data.lanes) {
        for (let i = 0; i + 1 < lane.pts.length; i++) {
          const a = w2s(lane.pts[i][0], lane.pts[i][1]);
          const b = w2s(lane.pts[i + 1][0], lane.pts[i + 1][1]);
          if (distToSegment(mx, my, a[0], a[1], b[0], b[1]) < 6) {
            return { kind: 'lane', lane };
          }
        }
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- panel
  function openPanel() {
    if (panel.classList.contains('hidden')) {
      panel.classList.remove('hidden');
      setTimeout(resize, 0);
    }
  }
  function closePanel() {
    panel.classList.add('hidden');
    state.selectedSystem = null;
    state.selectedObject = null;
    updateCrumbs();
    setTimeout(resize, 0);
  }

  function setPanel(title, sub, html) {
    panelTitle.textContent = title;
    panelSub.innerHTML = sub || '';
    panelBody.innerHTML = html || '';
    openPanel();
  }

  function updateCrumbs() {
    let html = '<a id="cr-universe">宇宙地图</a>';
    if (state.system) {
      html += '<span class="sep">/</span><a id="cr-sector">' + esc(sectorName(U.systems[state.system].sector)) + '</a>';
      html += '<span class="sep">/</span><span class="cur">' + esc(systemName(state.system)) + '</span>';
    }
    crumbs.innerHTML = html;
    const cu = document.getElementById('cr-universe');
    if (cu) cu.onclick = () => gotoUniverse();
    const cs = document.getElementById('cr-sector');
    if (cs) cs.onclick = () => gotoUniverse();
  }

  function showSystemPanel(nick) {
    const s = U.systems[nick];
    state.selectedSystem = nick;
    const badges = [];
    if (s.nonav) badges.push('<span class="badge warn">游戏内无导航图</span>');
    if (s.variantOf) badges.push('<span class="badge variant">剧情变体 · 正式版为 ' + esc(systemName(s.variantOf)) + '</span>');
    if (s.story) badges.push('<span class="badge story">剧情专用星系</span>');
    const bases = Object.values(U.bases).filter((b) => b.system === nick);
    const conns = U.links.filter((l) => l.a === nick || l.b === nick);

    let html = '';
    html += '<div class="kv"><div class="k">代号</div><div class="v">' + esc(nick) + '</div></div>';
    html += '<div class="kv"><div class="k">星区</div><div class="v">' + esc(sectorName(s.sector)) + '</div></div>';
    if (badges.length) html += '<div style="margin-top:6px">' + badges.join('') + '</div>';
    if (!(state.level === 'system' && state.system === nick)) {
      html += '<div style="margin-top:10px"><span class="btn" id="btn-enter">进入星系图</span></div>';
    }
    if (s.info) {
      html += '<div class="section"><h3>星系信息</h3><div class="infocard">' + s.info + '</div></div>';
    }
    if (bases.length) {
      html += '<div class="section"><h3>基地 (' + bases.length + ')</h3>';
      for (const b of bases) {
        const fac = U.baseFactions[b.nick];
        html += '<div class="list-item" data-base="' + esc(b.nick) + '">' +
          '<span class="li-icon base">■</span><span class="li-name">' + esc(b.name || b.nick) + '</span>' +
          '<span class="li-sub">' + esc(fac ? factionName(fac) : '') + '</span></div>';
      }
      html += '</div>';
    }
    if (conns.length) {
      html += '<div class="section"><h3>跳跃连接 (' + conns.length + ')</h3>';
      for (const l of conns) {
        const other = l.a === nick ? l.b : l.a;
        const cls = l.kind === 'gate' ? 'gate' : 'hole';
        const icon = l.kind === 'gate' ? '◎' : '◉';
        const rnd = (l.random && l.random.length)
          ? ' · 随机→' + l.random.map((r) => systemName(r)).join('/')
          : '';
        html += '<div class="list-item" data-goto="' + esc(other) + '">' +
          '<span class="li-icon ' + cls + '">' + icon + '</span>' +
          '<span class="li-name">' + esc(systemName(other)) + '</span>' +
          '<span class="li-sub">' + (l.kind === 'gate' ? '跳跃门' : '跳跃洞') + esc(rnd) + '</span></div>';
      }
      html += '</div>';
    }
    setPanel(s.name ? s.name.trim() : nick, '星系 · ' + esc(nick), html);
    const btn = document.getElementById('btn-enter');
    if (btn) btn.onclick = () => enterSystem(nick);
    panelBody.querySelectorAll('[data-goto]').forEach((el) => {
      el.onclick = () => {
        const other = el.dataset.goto;
        if (state.level === 'system') {
          enterSystem(other);
        } else {
          showSystemPanel(other);
          selectSystem(other);
        }
      };
    });
    panelBody.querySelectorAll('[data-base]').forEach((el) => {
      el.onclick = () => gotoBase(el.dataset.base);
    });
  }

  function showObjectPanel(o) {
    const cat = objCategory(o);
    const nm = objName(o) || o.nick;
    const badges = [];
    if (o.visit === 0 && o.ids) badges.push('<span class="badge">隐藏/未标记</span>');
    let html = '';
    html += '<div class="kv"><div class="k">类型</div><div class="v">' + typeLabel(o) + '</div></div>';
    html += '<div class="kv"><div class="k">代号</div><div class="v">' + esc(o.nick) + '</div></div>';
    if (o.rep) html += '<div class="kv"><div class="k">阵营</div><div class="v">' + esc(factionName(o.rep)) + '</div></div>';
    if (o.goto) {
      const target = o.goto.split(',')[0].trim();
      html += '<div class="kv"><div class="k">通向</div><div class="v">' + esc(systemName(target)) + ' (' + esc(target) + ')</div></div>';
    }
    if (o.radius) html += '<div class="kv"><div class="k">半径</div><div class="v">' + o.radius.toLocaleString() + ' m</div></div>';
    html += '<div class="kv"><div class="k">坐标</div><div class="v">' + o.pos.map((v) => v.toLocaleString()).join(', ') + '</div></div>';
    if (badges.length) html += '<div style="margin-top:6px">' + badges.join('') + '</div>';

    if (o.base) {
      const b = U.bases[o.base];
      const fac = U.baseFactions[o.base];
      const rooms = U.baseRooms[o.base] || [];
      html += '<div class="section"><h3>基地信息</h3>';
      html += '<div class="kv"><div class="k">基地</div><div class="v">' + esc(b ? (b.name || o.base) : o.base) + '</div></div>';
      if (fac) html += '<div class="kv"><div class="k">所属</div><div class="v">' + esc(factionName(fac)) + '</div></div>';
      if (rooms.length) {
        const svc = rooms.map((r) => ROOM_NAMES[r.toLowerCase()] || r).join('、');
        html += '<div class="kv"><div class="k">设施</div><div class="v">' + esc(svc) + '</div></div>';
      }
      html += '</div>';
      html += '<div id="market-section"></div>';
    }
    const info = objInfo(o);
    if (info) {
      html += '<div class="section"><h3>信息卡</h3><div class="infocard">' + info + '</div></div>';
    }
    html += '<div class="section"><div class="list-item" id="back-to-system"><span class="li-icon">↩</span><span class="li-name">返回 ' + esc(systemName(state.system)) + '</span></div></div>';
    setPanel(nm, typeLabel(o) + ' · ' + esc(state.system), html);
    if (o.base) {
      const baseKey = String(o.base).toLowerCase();
      loadMarkets().then((markets) => {
        const el = document.getElementById('market-section');
        if (!el) return;
        const m = markets.bases[baseKey];
        el.innerHTML = m ? marketHtml(m, markets) : '';
      }).catch(() => {});
    }
    const back = document.getElementById('back-to-system');
    if (back) back.onclick = () => { state.selectedObject = null; showSystemPanel(state.system); draw(); };
  }

  function itemName(nick, markets) {
    const it = markets.items[nick];
    return it ? it.n : nick;
  }

  function chips(title, list, cls, markets) {
    if (!list || !list.length) return '';
    return '<div class="section"><h3>' + title + ' (' + list.length + ')</h3>' +
      '<div class="chips ' + (cls || '') + '">' +
      list.map((n) => '<span class="chip" data-item="' + esc(n) + '">' +
        esc(itemName(n, markets)) + '</span>').join('') +
      '</div></div>';
  }

  function marketHtml(m, markets) {
    let html = '';
    html += chips('出售商品', m.sell, 'sell', markets);
    html += chips('收购商品', m.buy, 'buy', markets);
    if (m.ships && m.ships.length) html += chips('出售飞船', m.ships, 'ships', markets);
    if (m.equip && m.equip.length) {
      html += '<div class="section"><h3>出售装备 (' + m.equip.length + ')</h3>' +
        '<div class="scroll-box"><div class="chips equip">' +
        m.equip.map((n) => '<span class="chip" data-item="' + esc(n) + '">' +
          esc(itemName(n, markets)) + '</span>').join('') +
        '</div></div></div>';
    }
    return html;
  }

  const KIND_LABEL = { sell: '商品', buy: '商品', equip: '装备', ships: '飞船' };

  let baseIndex = null;
  function baseByLower(lower) {
    if (!baseIndex) {
      baseIndex = {};
      for (const [k, v] of Object.entries(U.bases)) baseIndex[k.toLowerCase()] = v;
    }
    return baseIndex[lower];
  }

  function showItemPanel(nick) {
    const markets = window.MARKETS || { items: {}, bases: {} };
    const it = markets.items[nick];
    const sellBases = [];
    const buyBases = [];
    for (const [base, m] of Object.entries(markets.bases || {})) {
      if ((m.sell && m.sell.includes(nick)) ||
          (m.equip && m.equip.includes(nick)) ||
          (m.ships && m.ships.includes(nick))) {
        sellBases.push(base);
      }
      if (m.buy && m.buy.includes(nick)) buyBases.push(base);
    }
    const baseList = (list) => '<div class="scroll-box" style="max-height:200px">' +
      list.map((b) => {
        const info = baseByLower(b);
        return '<div class="list-item" data-goto-base="' + esc(b) + '">' +
          '<span class="li-icon base">■</span><span class="li-name">' +
          esc(info ? (info.name || b) : b) + '</span>' +
          '<span class="li-sub">' + esc(info ? systemName(info.system) : '') + '</span></div>';
      }).join('') + '</div>';

    let html = '';
    html += '<div class="kv"><div class="k">类型</div><div class="v">' + (KIND_LABEL[it ? it.k : ''] || '物品') + '</div></div>';
    html += '<div class="kv"><div class="k">代号</div><div class="v">' + esc(nick) + '</div></div>';
    if (it && it.i) {
      html += '<div class="section"><h3>信息卡</h3><div class="infocard">' + it.i + '</div></div>';
    }
    if (sellBases.length) html += '<div class="section"><h3>出售基地 (' + sellBases.length + ')</h3>' + baseList(sellBases) + '</div>';
    if (buyBases.length) html += '<div class="section"><h3>收购基地 (' + buyBases.length + ')</h3>' + baseList(buyBases) + '</div>';
    setPanel(it ? it.n : nick, (KIND_LABEL[it ? it.k : ''] || '物品') + ' · 市场', html);
    panelBody.querySelectorAll('[data-goto-base]').forEach((el) => {
      el.onclick = () => gotoBase(el.dataset.gotoBase);
    });
  }

  function gotoBase(baseNick) {
    let ref = U.baseObjects[baseNick];
    if (!ref) {
      const info = baseByLower(String(baseNick).toLowerCase());
      if (info) ref = U.baseObjects[info.nick];
    }
    if (ref && ref.system) {
      enterSystem(ref.system).then(() => {
        const data = state.systemData;
        const obj = data && data.objects.find((x) => x.base === ref.object ||
          String(x.base || '').toLowerCase() === String(baseNick).toLowerCase());
        if (obj) {
          state.selectedObject = obj.nick;
          showObjectPanel(obj);
          centerObject(obj);
          draw();
        }
      });
    }
  }

  function centerObject(o) {
    const { w, h } = viewSize();
    state.ox = w / 2 - o.pos[0] * state.scale;
    state.oy = h / 2 - o.pos[2] * state.scale;
  }

  // ---------------------------------------------------------------- navigation
  function gotoUniverse() {
    state.level = 'universe';
    state.system = null;
    state.systemData = null;
    state.selectedObject = null;
    state.selectedSystem = null;
    closePanel();
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    updateCrumbs();
    const nicks = visibleSystems();
    const pts = nicks.map((n) => [U.systems[n].gx, U.systems[n].gy]);
    fitView(pts, 70);
    draw();
  }

  function enterSystem(nick) {
    if (!U.systems[nick]) return Promise.resolve();
    return loadSystem(nick).then((data) => {
      state.level = 'system';
      state.system = nick;
      state.systemData = data;
      state.selectedObject = null;
      if (location.hash.slice(1) !== nick) history.replaceState(null, '', '#' + nick);
      updateCrumbs();
      const navscale = data.navmapscale || 1;
      const mapmax = 131072 / navscale;
      const pts = [[-mapmax, -mapmax], [mapmax, mapmax]];
      for (const o of data.objects) if (objVisible(o)) pts.push([o.pos[0], o.pos[2]]);
      if (data.objects.length === 0) for (const z of data.zones) pts.push([z.pos[0], z.pos[2]]);
      fitView(pts, 40);
      showSystemPanel(nick);
      draw();
      setStatus('system=' + nick + ' objects=' + data.objects.length + ' zones=' + data.zones.length);
    }).catch((err) => {
      setStatus('ERR: ' + err.message);
    });
  }

  function selectSystem(nick) {
    state.selectedSystem = nick;
    const s = U.systems[nick];
    const { w, h } = viewSize();
    if (state.level === 'universe') {
      // pan so the node is centered
      state.ox = w / 2 - s.gx * state.scale;
      state.oy = h / 2 - s.gy * state.scale;
      draw();
    }
  }

  function loadSystem(nick) {
    if (window.__SYS[nick]) return Promise.resolve(window.__SYS[nick]);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'data/systems/' + encodeURIComponent(nick) + '.js';
      s.onload = () => resolve(window.__SYS[nick]);
      s.onerror = () => reject(new Error('无法加载星系数据: ' + nick));
      document.head.appendChild(s);
    });
  }

  let marketsPromise = null;
  function loadMarkets() {
    if (window.MARKETS) return Promise.resolve(window.MARKETS);
    if (!marketsPromise) {
      marketsPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'data/markets.js';
        s.onload = () => resolve(window.MARKETS || {});
        s.onerror = () => reject(new Error('无法加载市场数据'));
        document.head.appendChild(s);
      });
    }
    return marketsPromise;
  }

  // ---------------------------------------------------------------- events
  let hoverRaf = 0;
  function updateHover(mx, my) {
    const hit = state.level === 'universe' ? hitUniverse(mx, my) : hitSystem(mx, my);
    const prevKey = state.hover && (state.hover.nick || (state.hover.obj && state.hover.obj.nick) || (state.hover.zone && state.hover.zone.nick) || (state.hover.lane && state.hover.lane.name));
    const hitKey = hit && (hit.nick || (hit.obj && hit.obj.nick) || (hit.zone && hit.zone.nick) || (hit.lane && hit.lane.name));
    state.hover = hit;
    if (hit) {
      let html = '';
      if (hit.kind === 'system') {
        const s = U.systems[hit.nick];
        const bases = Object.values(U.bases).filter((b) => b.system === hit.nick).length;
        html = '<div class="tt-title">' + esc(systemName(hit.nick)) + '</div>' +
          '<div class="tt-sub">' + esc(sectorName(s.sector)) + ' · ' + esc(hit.nick) +
          (bases ? ' · ' + bases + ' 个基地' : '') +
          (s.nonav ? ' · 无导航图' : '') + '</div>' +
          '<div class="tt-sub">点击查看 · 双击进入</div>';
      } else if (hit.kind === 'object') {
        const o = hit.obj;
        const nm = objName(o);
        html = '<div class="tt-title">' + esc(nm || o.nick) + '</div>' +
          '<div class="tt-sub">' + typeLabel(o) + (o.base ? ' · 可停靠' : '') + '</div>';
      } else if (hit.kind === 'zone') {
        html = '<div class="tt-title">' + esc(nameOf(hit.zone.ids) || hit.zone.nick) + '</div>' +
          '<div class="tt-sub">区域 · ' + hit.zone.kind + '</div>';
      } else if (hit.kind === 'lane') {
        html = '<div class="tt-title">' + esc(hit.lane.name || '贸易航线') + '</div>' +
          '<div class="tt-sub">贸易航线 · ' + hit.lane.pts.length + ' 个环</div>';
      }
      tooltip.innerHTML = html;
      tooltip.style.display = 'block';
      const rect = canvas.getBoundingClientRect();
      tooltip.style.left = Math.min(mx + 16, rect.width - 310) + 'px';
      tooltip.style.top = (my + 16) + 'px';
      canvas.style.cursor = 'pointer';
    } else {
      tooltip.style.display = 'none';
      canvas.style.cursor = state.dragging ? 'grabbing' : 'grab';
    }
    if (prevKey !== hitKey) draw();
  }

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    if (state.dragging) {
      const dx = e.clientX - state.dragStart.x, dy = e.clientY - state.dragStart.y;
      state.ox += dx; state.oy += dy;
      state.dragStart = { x: e.clientX, y: e.clientY };
      draw();
      return;
    }
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      updateHover(mx, my);
    });
    // fallback for throttled background tabs
    setTimeout(() => {
      if (hoverRaf) {
        cancelAnimationFrame(hoverRaf);
        hoverRaf = 0;
        updateHover(mx, my);
      }
    }, 60);
  });

  canvas.addEventListener('mousedown', (e) => {
    state.dragging = true;
    state.dragStart = { x: e.clientX, y: e.clientY };
    canvas.classList.add('dragging');
  });
  window.addEventListener('mouseup', () => {
    state.dragging = false;
    canvas.classList.remove('dragging');
  });

  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    if (state.level === 'universe') {
      const hit = hitUniverse(mx, my);
      if (hit) {
        showSystemPanel(hit.nick);
        selectSystem(hit.nick);
      }
    } else {
      const hit = hitSystem(mx, my);
      if (hit && hit.kind === 'object') {
        state.selectedObject = hit.obj.nick;
        showObjectPanel(hit.obj);
        draw();
      } else if (hit && hit.kind === 'zone') {
        const z = hit.zone;
        setPanel(nameOf(z.ids) || z.nick, '区域 · ' + z.kind,
          '<div class="kv"><div class="k">类型</div><div class="v">' + z.kind + '</div></div>' +
          '<div class="kv"><div class="k">代号</div><div class="v">' + esc(z.nick) + '</div></div>' +
          '<div class="kv"><div class="k">坐标</div><div class="v">' + z.pos.join(', ') + '</div></div>' +
          (z.size ? '<div class="kv"><div class="k">尺寸</div><div class="v">' + z.size.join(' × ') + '</div></div>' : ''));
      } else if (hit && hit.kind === 'lane') {
        const lane = hit.lane;
        setPanel(lane.name || '贸易航线', '贸易航线 · ' + esc(state.system),
          '<div class="kv"><div class="k">终点</div><div class="v">' + esc(lane.name || '-') + '</div></div>' +
          '<div class="kv"><div class="k">航段</div><div class="v">' + lane.pts.length + ' 个航线环</div></div>');
      }
    }
  });

  canvas.addEventListener('dblclick', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    if (state.level === 'universe') {
      const hit = hitUniverse(mx, my);
      if (hit) enterSystem(hit.nick);
    } else {
      const hit = hitSystem(mx, my);
      if (hit && hit.kind === 'object') {
        showObjectPanel(hit.obj);
      }
    }
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const before = s2w(mx, my);
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    state.scale = clamp(state.scale * factor, 0.002, 80);
    const after = s2w(mx, my);
    state.ox += (after[0] - before[0]) * state.scale;
    state.oy += (after[1] - before[1]) * state.scale;
    draw();
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (state.level === 'system') gotoUniverse();
      else closePanel();
    }
  });

  document.getElementById('panel-close').onclick = closePanel;

  // market chips are clickable -> item info panel
  panelBody.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-item]');
    if (chip) showItemPanel(chip.dataset.item);
  });

  // zoom controls
  function zoomBy(factor) {
    const { w, h } = viewSize();
    const cx = w / 2, cy = h / 2;
    const before = s2w(cx, cy);
    state.scale = clamp(state.scale * factor, 0.002, 80);
    const after = s2w(cx, cy);
    state.ox += (after[0] - before[0]) * state.scale;
    state.oy += (after[1] - before[1]) * state.scale;
    draw();
  }
  document.getElementById('z-in').onclick = () => zoomBy(1.3);
  document.getElementById('z-out').onclick = () => zoomBy(1 / 1.3);
  document.getElementById('z-fit').onclick = () => {
    if (state.level === 'universe') gotoUniverse();
    else if (state.system) enterSystem(state.system);
  };

  // filters UI
  const filterDefs = [
    ['sun', '恒星'], ['planet', '行星'], ['base', '基地'], ['station', '空间站'],
    ['gate', '跳跃门'], ['hole', '跳跃洞'], ['tradelane', '贸易航线'], ['ring', '停靠环'], ['satellite', '卫星'],
    ['platform', '武器平台'], ['depot', '仓库'], ['airlock', '气闸'],
    ['fields', '小行星带'], ['nebula', '星云'],
  ];
  function buildFilterBar() {
    const bar = document.getElementById('filters');
    bar.innerHTML = '';
    for (const [key, label] of filterDefs) {
      const el = document.createElement('label');
      el.className = 'toggle' + (state.filters[key] ? ' on' : '');
      el.innerHTML = '<input type="checkbox" ' + (state.filters[key] ? 'checked' : '') + '> ' + label;
      el.querySelector('input').onchange = (ev) => {
        state.filters[key] = ev.target.checked;
        el.classList.toggle('on', ev.target.checked);
        draw();
      };
      bar.appendChild(el);
    }
  }

  const variantToggle = document.getElementById('toggle-variants');
  variantToggle.querySelector('input').onchange = (e) => {
    state.showVariants = e.target.checked;
    variantToggle.classList.toggle('on', e.target.checked);
    if (state.level === 'universe') gotoUniverse();
    else draw();
  };
  const labelToggle = document.getElementById('toggle-labels');
  labelToggle.querySelector('input').onchange = (e) => {
    state.showLabels = e.target.checked;
    labelToggle.classList.toggle('on', e.target.checked);
    draw();
  };

  // ---------------------------------------------------------------- search
  let searchIndex = [];
  function buildSearchIndex() {
    searchIndex = [];
    for (const nick of Object.keys(U.systems)) {
      const s = U.systems[nick];
      searchIndex.push({ type: 'system', nick, name: s.name ? s.name.trim() : nick, sub: sectorName(s.sector) + ' · ' + nick });
    }
    for (const b of Object.values(U.bases)) {
      if (!b.system) continue;
      searchIndex.push({ type: 'base', nick: b.nick, name: b.name || b.nick, sub: systemName(b.system) + ' · 基地' });
    }
  }

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) { searchResults.classList.remove('show'); return; }
    const res = searchIndex.filter((x) =>
      (x.name && x.name.toLowerCase().includes(q)) || (x.nick && x.nick.toLowerCase().includes(q))
    ).slice(0, 30);
    if (!res.length) { searchResults.classList.remove('show'); return; }
    searchResults.innerHTML = res.map((x, i) =>
      '<div class="sr-item" data-i="' + i + '"><div class="sr-name">' + esc(x.name) +
      '</div><div class="sr-sub">' + esc(x.sub) + '</div></div>'
    ).join('');
    searchResults.classList.add('show');
    searchResults.querySelectorAll('.sr-item').forEach((el) => {
      el.onclick = () => {
        const x = res[Number(el.dataset.i)];
        searchResults.classList.remove('show');
        searchInput.value = '';
        if (x.type === 'system') {
          enterSystem(x.nick);
        } else {
          gotoBase(x.nick);
        }
      };
    });
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#search-box')) searchResults.classList.remove('show');
  });

  // ---------------------------------------------------------------- init
  function setStatus(text) {
    const el = document.getElementById('status');
    if (el) el.textContent = text;
  }
  window.addEventListener('error', (e) => {
    setStatus('ERR: ' + (e.message || e.error));
  });

  function init() {
    buildFilterBar();
    buildSearchIndex();
    updateCrumbs();
    resize();
    window.addEventListener('resize', () => { makeStars(); resize(); });
    gotoUniverse();
    loading.classList.add('hidden');
    setStatus('systems=' + Object.keys(U.systems).length +
      ' visible=' + visibleSystems().length +
      ' links=' + U.links.length +
      ' bases=' + Object.keys(U.bases).length);
    const hash = decodeURIComponent(location.hash.slice(1));
    if (hash && U.systems[hash]) enterSystem(hash);
  }

  init();

  // small debug/automation API
  window.MAP = {
    state,
    enterSystem,
    gotoUniverse,
    showSystemPanel,
    showObjectPanel,
    gotoBase,
    universe: U,
    ids: IDS,
  };
})();
