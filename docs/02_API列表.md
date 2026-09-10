# 02 API 列表

> 本项目的「API」分三层：**数据产物格式**（`map\data\*.js`）、**前端接口**（`window.MAP`）、**工具脚本**（`map\tools\*.py`）。
> 全部为本地/离线使用，无网络依赖。

## 1. 数据产物格式

### 1.1 `data/ids.js` → `window.IDS`

```js
window.IDS = {
  names: { "196766": "Manhattan行星", ... },   // IDS -> 名称
  infos: { "65759": "直径：12,753 km.<br>...", ... } // IDS -> 信息卡 HTML
}
```
只包含被引用到的 IDS；值已做 HTML 处理（RDL 转 HTML / 纯文本转义）。

### 1.2 `data/universe.js` → `window.UNIVERSE`

| 字段 | 类型 | 说明 |
|---|---|---|
| `sectors` | array | `{id, name, grid, cell:[col,row], origin:[x,y], labels:[{text,x,y}]}`，x/y 为星区局部坐标 |
| `systems` | object | 星系表，键为星系代号，见下表 |
| `links` | array | `{a, b, kind:"gate"\|"hole", via, obj, random:[星系], viaList:[物体]}` |
| `bases` | object | `nick -> {nick, system, name}` |
| `baseFactions` | object | 基地 -> 阵营代号 |
| `baseRooms` | object | 基地 -> 房间名数组（Bar/Trader/…） |
| `baseObjects` | object | 基地 -> `{system, object}`（用于定位） |
| `factions` | object | 阵营代号 -> `{name, short, info}` |
| `cell` | number | 星区单元尺寸（CELL+GAP＝27） |

`systems[nick]` 字段：

| 字段 | 说明 |
|---|---|
| `name` | 显示名（中文，如「纽约」） |
| `file` | 系统文件相对路径 |
| `visit` | 可见标记 |
| `info` | 星系信息卡 HTML |
| `sector` / `sx` / `sy` | 所属星区与星区内坐标 |
| `gx` / `gy` | 大地图全局坐标（屏幕 y 向下） |
| `upos` | `universe.ini` 原始 pos（备用，不用于布局） |
| `objects` | 物体数量 |
| `navmapscale` | 网格缩放 |
| `variantOf` | 非空＝任务变体，值为其正式版星系 |
| `story` | true＝剧情专用星系（CF99） |
| `nonav` | true＝游戏内无导航图 |

### 1.3 `data/systems/<星系>.js` → `window.__SYS["<星系>"]`

```js
window.__SYS["Li01"] = { objects: [...], zones: [...], lanes: [...], navmapscale: 1 }
```

`objects[]` 字段：`nick, type, arch, pos[3], radius, ids, info, archIds, archInfo, base, goto, rep, visit, star, burn[3], atmo, difficulty`
`zones[]` 字段：`nick, pos[3], shape, size[3], rotate[3], flags, ids, info, fog[3], damage, density, kind`
`lanes[]` 字段：`{pts: [[x,z],...], name}`（贸易航线折线，name 为终点站名）
（`type` 取值见术语表；`kind` ∈ nebula/asteroid/ice/debris/mine/lava/gas）

### 1.4 `data/markets.js` → `window.MARKETS`（按需加载）

```js
window.MARKETS = {
  items: {
    "commodity_water": { n: "水", i: "<信息卡 HTML 或 null>", k: "sell" },
    "gf2_package":     { n: "星象跟踪仪", i: "<...>", k: "ships" }, ...
  },
  bases: {
    "li01_01_base": {
      sell:  ["commodity_water", ...],  // 出售的商品（代号）
      buy:   ["commodity_gold", ...],   // 收购的商品
      equip: ["li_gun01_mark01", ...],  // 出售的装备
      ships: ["lf_package", ...]        // 出售的飞船
    }, ...
  }
}
```
键均为**小写代号**；`items[k].k` ∈ sell/buy/equip/ships。
数据来自 `market_commodities/misc/ships.ini`，标志位为 `marketgood` 逗号分隔后的 **index 5**（`0`＝出售、`1`＝收购/非卖）。
点击基地卡片中的商品/装备/飞船标签会打开对应物品卡片（信息卡 + 出售/收购基地列表，可跳转基地）。

## 2. 前端接口（`js/app.js`）

| 接口 | 说明 |
|---|---|
| `window.MAP.state` | 视图状态：`level`（universe/system）、`system`、`systemData`、`selectedSystem`、`selectedObject`、`hover`、`scale`、`ox`、`oy`、`showVariants`、`showLabels`、`filters` |
| `window.MAP.enterSystem(nick)` | 进入星系图（按需加载 `<nick>.js`），返回 Promise |
| `window.MAP.gotoUniverse()` | 返回大地图 |
| `window.MAP.showSystemPanel(nick)` | 右侧显示星系信息 |
| `window.MAP.showObjectPanel(obj)` | 右侧显示物体详情 |
| `window.MAP.gotoBase(baseNick)` | 定位到基地所在物体 |
| `window.MAP.universe` / `.ids` | 原始数据引用（调试用） |
| `window.__SYS` | 已加载星系的缓存 |
| `window.MARKETS` | 已加载的市场数据缓存（基地面板首次打开时按需加载 `data/markets.js`） |
| URL `#<星系代号>` | 深链接，如 `index.html#Li01` |

坐标约定：`w2s(x,y)` 采用 **屏幕 y 向下**；星系图 `y=z`，大地图 `y=gy`。

## 3. 工具脚本

### 3.1 `tools/extract_map.py`（主提取器）

配置常量：

| 常量 | 说明 |
|---|---|
| `MISSION_VARIANTS` | 变体 → 正式版 映射（18 条，含仅存在于 multiuniverse 的 `CF01tns`） |
| `STORY_ONLY` | 剧情专用星系（`CF99`） |
| `DUMMY_SYSTEMS` | 导航图占位（`sector01`–`sector05`） |
| `LABEL_OVERRIDES` | 星区房子标签（1249–1252、1381） |

关键函数：

| 函数 | 说明 |
|---|---|
| `parse_ini(path)` | INI → `[{name, pairs:[(k,v)]}]`（保留重复键） |
| `first(pairs,k)` / `all_values(pairs,k)` | 取值工具 |
| `to_vec(text,n,cast)` / `ids_val(text)` | 数值向量 / IDS 值（0、1 视为无） |
| `IdsResolver.load()` | 按 `freelancer.ini` 建 IDS 表（**index 0 = Resources.dll**） |
| `IdsResolver.name(ids)` / `.info(ids)` | 名称 / 信息卡（RT_HTML → RT_STRING → RDL 识别） |
| `rdl_to_html(rdl)` | RDL XML → HTML（实体先还原再转义） |
| `string_to_html(text)` | 纯文本 → HTML |
| `load_solar_archetypes()` / `load_star_archetypes()` | 原型类型/半径/ids |
| `load_item_names()` / `load_ship_names()` | 装备/商品名称 / 飞船包名（goods→hull→shiparch） |
| `load_markets()` | 三张市场表 → 基地出售/收购清单 |
| `load_universe(resolver)` / `load_sectors()` | 星系表 / 星区表 |
| `parse_system(path, archetypes, stars, sys_nick)` | 解析单星系 → objects/zones/connections |
| `zone_kind(z)` | 区域分类（nebula/asteroid/…） |
| `main()` | 全流程 + 布局 + 写文件 |

### 3.2 辅助脚本（`tools/`）

| 脚本 | 用途 |
|---|---|
| `analyze_variants.py` | 变体家族与连接证据（→ `variants_report.txt`） |
| `analyze_missions.py` | 任务脚本对变体的引用统计（→ `probe/mission_variants.txt`） |
| `system_details.py` | 指定星系的详细对象/基地清单 |
| `dump_strings.py` / `scan_dll_strings.py` | DLL 字符串扫描（找机制线索） |
| `test_ids.py` / `test_resources_dll.py` | IDS 公式与资源 DLL 验证 |
| `li01_grid.py` | 纽约物体 → 游戏网格格位换算（核对方向/网格） |
| `dump_cf59.py` / `check_infos.py` / `check_garbled*.py` | 信息卡与乱码专项核对 |
| `probe_*.py` | 早期探针（资源类型、标签、信息卡样例） |

## 4. 输入数据源（游戏侧）

| 数据 | 文件 |
|---|---|
| 星系清单/坐标/系统信息卡 | `DATA\UNIVERSE\universe.ini` |
| 星区与区内布局 | `DATA\UNIVERSE\multiuniverse.ini` |
| 无导航图名单 | `DATA\UNIVERSE\NoNavMap.ini` |
| 随机跳跃 | `DATA\UNIVERSE\RandomJumps.ini` |
| 星系内容 | `DATA\UNIVERSE\SYSTEMS\<星系>\<星系>.ini` |
| 太阳原型 / 恒星原型 | `DATA\SOLAR\solararch.ini` / `StarArch.ini` |
| 阵营 | `DATA\initialworld.ini [Group]` |
| 基地阵营 / 设施 | `DATA\MISSIONS\mbases.ini` / `...\Bases\*.ini` |
| 基地市场 | `DATA\EQUIPMENT\market_commodities.ini` / `market_misc.ini` / `market_ships.ini` |
| 物品/飞船名称 | `DATA\EQUIPMENT\goods.ini`（shiphull/ship 链）、各 `*_equip.ini`、`DATA\SHIPS\shiparch.ini` |
| 名称与信息卡 | `EXE\*.dll`（`[Resources]` + index 0 `Resources.dll`） |

## 5. 报告与中间产物

| 文件 | 说明 |
|---|---|
| `data/extract_report.txt` | 提取统计（解析失败、悬空连接、区域分类、DLL 列表） |
| `data/variants_report.txt` | 变体判定证据 |
| `data/probe/mission_variants.txt` | 任务引用统计 |
| `data/probe/*` | 核对用截图与文本（`official_galaxy.jpg`、`fandom_li01.jpg` 等） |
