# 致谢与第三方说明 / Credits & Third-Party Notices

## 本项目的代码

- 地图前端（`index.html` / `css/` / `js/`）与提取工具（`tools/`）为原创代码，以 **MIT** 许可发布（见 `LICENSE`）。

## 特别感谢

- **DeepSeek** —— 本项目的地图代码、数据提取管线、文档与发布均由 DeepSeek 模型辅助完成。
- **OpenCode** —— 本项目使用的 AI 编程环境。

## 数据与参考（不属于本项目代码，版权归各自所有者）

- **Freelancer**（自由枪骑兵）© Microsoft / Digital Anvil —— 游戏本体与其数据格式。
- **Crossfire Mod 2.0.1**（SWAT Portal / OP-R8R 及团队）—— `data/` 中的星系、物体、名称与信息卡文本均提取自本机安装的 Crossfire 2.0.1 单机版游戏文件，版权归 MOD 作者所有。
- **Crossfire 中文汉化**（本机游戏所带汉化）—— 中文名称与信息卡文本版权归汉化作者所有。
- **FLCompanion**（Wizou / ItsRaisu 等）—— 开源伴侣工具，本项目的 IDS 资源机制与市场标志位解释参考了其源码，并以其为线索；**网格与方向以游戏内实测为准**（FLCompanion 的 A–I/1–9 网格标注与游戏实际 A–H/1–8 不符）。
- **arbiter.de**（游戏内纽约导航图截图）与 **Freelancer Fandom Wiki**（游戏内宇宙图）—— 用于核对地图方向与网格的参考截图（未随仓库分发）。
- **SWAT Portal** —— 官方 Crossfire 银河图（用于核对星区相对位置，未随仓库分发）。
- **Python / pefile** —— 数据提取工具依赖（`pip install pefile`）。

## 说明

- 本仓库**不包含**任何游戏本体文件、MOD 文件、下载的第三方图片或第三方工具二进制；
  仅包含运行地图所必需的、从本地游戏提取的文本数据（`data/`），以及原创代码与文档。
- 若版权方认为 `data/` 中的提取文本不宜分发，请联系仓库作者删除。
