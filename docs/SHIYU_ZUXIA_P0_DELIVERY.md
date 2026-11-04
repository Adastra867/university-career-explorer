# 始于足下 P0 本地交付记录

## 2026-10-14 三层前端修订（当前实现）

本次依据 `D:/APP/Coze/career_tree/shiyuzuxia_three_layer_frontend (1)/始于足下_三层前端结构_HANDOFF.md`、配套 HTML 及 7 张设计截图实施。以下本节描述当前实现；后面的 2026-10-13 记录保留为历史，其单树入口、深色视觉和聊天仅存内存等描述已经被本节替代。

### 页面与功能

- `/`：暖白背景、「始于足下」和呼吸紫光点。点击、Enter/Space 激活后，光点向左移动，只打开树大厅；减少动态效果时跳过动画。
- `/trees`：四类新树卡片、收藏空态与已保存列表。输入名称和备注后创建独立单根树；支持同类型同名多树、继续探索、重命名、复制、完整 JSON 导出/导入和确认删除。
- `/trees/:treeId`：仅加载指定树。保存节点、边条件、路径选择、焦点、视口、本树聊天，以及该树独立的资料授权和工作区。返回大厅、重开、刷新和浏览器前进/后退均按树 ID 恢复；不存在的 ID 提供返回大厅入口。
- 原 `/journey` 兼容进入开幕；原职业测评保留在 `/index.html`，岗位搜索 `/job-search.html` 与求职准备 `/career-prep.html` 保持原有功能和数据。
- 复用已有节点/边编辑、多选候选、DIY、拖动、折叠、条件注释、连续路径、撤销/重做、资料核验、行动计划与版本工具。新增清空当前画布与整条分支删除，均需确认并可撤销；共享节点仍由其他分支引用时保留。
- 桌面保持画布与右侧 AI/节点详情；手机保留画布、AI/详情、路径比较三个入口，树库和创建弹窗适配窄屏。
- 保留已有真实 AI 后端能力与明确的未配置提示。切树、返回大厅或改变授权时取消旧请求和草案，迟到回复不能写入另一棵树。

### 数据与兼容

树库索引为 `shiyu-zuxia.forest.v1`；每棵树使用 `shiyu-zuxia.tree.<id>.graph.v1`、对应 `.backup` 与 `.workspace.v1`。原职业测评键不变。

首次加载会非破坏迁移旧 `shiyu-zuxia.graph.v1` 单树及其资料、参考原型 `shiyuzuxia_forest_demo_v3` 多树、旧 `shiyuzuxia_life_tree_demo_v2` 单树。源键保留，迁移标记避免重复导入。坏数据保留并提示，不静默过滤或截断；不再有参考原型的 150 棵/250 节点恢复截断。现有图模型的 300 节点/600 边上限在修改及导入时一致校验。

新备份格式为 `treeArchiveVersion: 1`，包含树类型、备注、完整图、UI 焦点/比较选择、撤销记录、命名版本和本树工作区。与同时进行的 AI 升级衔接：新的问答存于 `shiyu-zuxia.ai.v1`，按 graphId 隔离，并作为备份的 `ai` 字段仅导出本树记录；旧 UI 聊天仍兼容。复制和独立导入时重映射问答、线程、请求、派生路线介绍及引用的身份，避免与源树冲突；删除整树同时清理本树的 AI 记录。导入始终创建新树，不覆盖同名树；旧原型及旧图/归档格式仍可读取。复制和导入后，资料及档案需重新授权 AI 使用。

没有存储权限、配额不足或索引损坏时，保留本次页面内存供编辑和导出，明确提示刷新可能丢失，不显示已持久保存。恢复、版本快照和导入的内存事务与重新打开/导出内容保持一致。同树多页沿用修订冲突保护；不同树编辑相互独立。localStorage 不提供数据库级原子事务或云同步。

### 本地验证

```powershell
Set-Location D:\APP\Coze\career
npm start
```

默认打开 `http://127.0.0.1:5000/`。修改端口可设置 `PORT`。设置 `JOURNEY_ENABLED=false` 并重启后，根路径恢复原站，树相关入口及 API 关闭。测试服务器设置 `JOURNEY_LOAD_ENV=false`，不借用本机 `.env` 中的真实服务凭据。

```powershell
npm run check
npm test
npm run test:forest
npm run test:browser
npm run test:next
npm run test:legacy
```

浏览器脚本需要先启动服务器，可用 `BASE_URL` 指定测试端口。当前三层验收与截图在 `artifacts/forest/results.json` 和同目录 PNG；既有画布、P1/P2 工具、旧业务回归结果分别在 `artifacts/journey/`、`artifacts/journey-next/`。受控 AI 响应验证上下文隔离与交互，不代表真实模型质量验收。

本轮实测：语法检查通过；全量自动化 226/226；三层浏览器 18/18（已在合并新版 AI 后重新验证）；既有画布浏览器 22/22；扩展工具浏览器 20/20；原业务浏览器 16/16。自动化记录保存于 `artifacts/forest/unit-tests.txt`，各浏览器结果包含独立测试模式与来源说明。

### 本次改动与后续

前端：`journey/index.html`、`app.js`、新增 `forest.css`；数据：新增 `forest.js`、增强 `store.js`，新增 `forest-ai.js` 衔接并行的 AI 升级；扩展：`extensions.js` 的销毁/取消保护和移动路径比较；入口：根 `server.js`。测试新增森林单测、AI 复制/导入身份重映射单测及浏览器验收，并适配既有画布、扩展和路由测试；`package.json` 增加 `test:forest`。不改原业务 HTML/脚本、不改设计源文件、不发布或部署。

后续仍需账号与数据库、跨设备同步、服务端所有权与事务、树搜索/归档，以及按新 HANDOFF 的跨树授权关联、协作与分享链接。现有局部版本/资料/计划工具继续保留；不宣称这些等同于全部 P1/P2 完成。

---

## 2026-10-13 历史交付记录

日期：2026-10-13（Asia/Shanghai）。本轮只实现 P0，没有进入 P1/P2。

## 审查结论与范围

原项目是原生 HTML/JavaScript + Express 5，包管理器为 pnpm，部署配置为 Render。没有数据库、账号认证或服务端图数据。原站的测评、解析、答疑和手动 JD 匹配主要运行在浏览器；真实后端接口为 `/api/search-jobs`、`/api/recommend-jobs`、`/api/fetch-jd`，通过 Coze SDK 做检索。原来的 `/api/chat`、`/api/rag` 只是注释。

开发开始时已有 `index.html` 的 10 行修改，以及未跟踪的 `career-prep.html` 和 `scripts/career-prep.js`。这些修改和文件全部保留。旧前端源码与开发前 SHA256 基线一致，证据见 `artifacts/journey/legacy-baseline.json` 与 `legacy-results.json`。

交接源文件实际位于 `D:/APP/Coze/career_tree/SHIYU_ZUXIA_CODEX_HANDOFF.md`，现按原文复制到本目录。前端依据用户随后指定的 `D:/APP/Coze/career_tree/SHIYU_ZUXIA_frontend_source`，保留其深色背景、青绿色光点、分栏结构与节点视觉；没有修改该设计源目录。

## 启动与入口

```powershell
Set-Location D:\APP\Coze\career
pnpm install --frozen-lockfile
pnpm start
```

- 新页面：<http://127.0.0.1:5000/journey>
- 原首页：<http://127.0.0.1:5000/>
- 原岗位搜索：<http://127.0.0.1:5000/job-search.html>
- 原求职冲刺：<http://127.0.0.1:5000/career-prep.html>

`PORT` 或 `DEPLOY_RUN_PORT` 可修改端口。新增 `JOURNEY_ENABLED` 默认开启独立入口；它不控制原首页，也不会将新页面设为首页。

关闭新功能时，在启动服务器前设置 `$env:JOURNEY_ENABLED='false'`，重启。新页面、资源和 API 返回 404，旧页面与旧接口保留。重新开启可移除该环境变量或设为 `true`。验证包括编码斜杠、反斜杠、大小写及 Windows 备用数据流路径。

## P0 已实现

1. 开场仅名称与可聚焦的呼吸光点。点击、Enter/Space 激活后，同一个光点元素移动并成为根节点；支持减少动态效果，回访直接恢复。
2. 单一 `GraphDocument` 数据源，版本化节点、边、条件、已保存路径与视口。动态逐层扩展；多选候选整次添加；示例明确未核实。
3. 手动新增、编辑类型/说明/状态、复制、确认删除、拖动、折叠、搜索与定位；跨分支汇合；缩放、平移、双指手势、适应画布和回到起点。
4. 条件分类覆盖学历、技能、证书、经历、时间、金钱、地区、资源、个人条件及其他。每项有短标签、解释、必要性与知识状态；画布最多显示三项，多余收为 `+N`。
5. 桌面 Ctrl/Shift/⌘ 多选与触屏可见多选模式；展示完整路径和已有条件；保存连续的边链，查看已保存路线。深度比较报告留到 P1。
6. 最近 40 步撤销/重做，操作失败不部分写入。删除父节点只删除自身与关联边，保留其他节点，清理受影响的已保存路径。
7. 450ms 防抖本地保存、上一次有效备份、刷新恢复、明确存储失败与多页冲突提示、重命名、版本化 JSON 导出、二次确认删除人生树本机数据。没有云端同步。
8. 真实服务端 OpenAI 兼容接口适配。按用户选择发送当前节点、完整路径、多选路线或整图摘要；浏览器发送前和服务端都排除私密节点，不读取原站档案。相同图修订、范围与选择的追问延续有限聊天历史，切换授权范围不携带旧历史。
9. AI 变更先结构化校验并展示草案，新节点以虚线预览；拒绝不改图。确认前校验签名与版本，成功后一次事务应用，可整体撤销。确认中的取消不会迟到写入。
10. 请求体、图规模、输出、上下文、历史、并发、频率、超时与取消均有限制。禁止 AI 删除、访问未授权节点、伪造已核验证据或引文。源码仅通过必要资源白名单提供。

## 数据与边界

原站键 `careerPredictor`、`careerPredictorHistory`、`careerPredictorPrep` 和 sessionStorage 的 `careerPredictorStartStep` 不变。

新图使用 `shiyu-zuxia.graph.v1` 与 `shiyu-zuxia.graph.v1.backup`。图规模上限 300 个节点、600 条边，推进关系禁止有向环，关联关系可回环。AI 单次最多提议 12 个新节点与 36 个操作；最多选择 12 个节点发起一次 AI 请求。

浏览器草稿没有服务端用户归属：本轮不虚构账号隔离，也不迁移旧数据。localStorage 修订标记与 `storage` 事件阻止常见多页覆盖；它不提供数据库级跨页原子 CAS，极窄的真正同时写入仍是本地存储限制。需要多端一致性时由后续账号与事务存储解决。

聊天只在当前页面内存保留，刷新不恢复聊天。JSON 导出是本地备份，包含用户自愿记录的私密节点，需要用户自行保管。当前没有 JSON 导入 UI。

## 真实模型配置

参考 `journey/.env.example`。服务器读取：

- `JOURNEY_AI_BASE_URL`：兼容服务的 API 根路径，默认 `https://api.openai.com/v1`。
- `JOURNEY_AI_API_KEY`：服务器密钥。
- `JOURNEY_AI_MODEL`：提供者真实支持的模型名称。
- `JOURNEY_AI_PROPOSAL_SECRET`：可选，多实例共用的草案签名密钥。

可通过部署环境或 PowerShell 环境变量配置。也可复制示例到根目录 `.env`，填写后使用 `node --env-file=.env server.js`。`pnpm start` 本身不自动加载 `.env`。`.env` 已加入忽略规则，密钥不写进浏览器代码。

适配器调用 `/chat/completions`，要求提供者支持 `response_format: json_object` 与 `max_completion_tokens`；返回内容还会独立验证。兼容接口的具体供应商能力需要实际配置后核对。

草案签名默认 15 分钟有效；单进程默认随机签名密钥，服务重启后旧草案需重新生成。模型请求默认 25 秒超时，每 IP 间隔 1.5 秒，最多 2 个并发请求。P0 没有实时检索，模型建议始终标明尚未核实；不返回伪造来源。

## 实际验证与截图

```powershell
pnpm check
pnpm test
pnpm test:browser
pnpm test:legacy
```

浏览器脚本需要先启动本地服务器，默认访问端口 5000，可设置 `BASE_URL`。测试使用全新浏览器 context，不读取真实浏览器用户资料。优先项目 Playwright，或通过 `PLAYWRIGHT_MODULE_PATH` 指定；本次复用了 Codex 附带 Playwright 与已有 Chrome，没有新增应用依赖。

详细结果位于 `artifacts/journey/`：

| 检查 | 实际结果 |
|---|---|
| 语法检查 `pnpm check` | 通过 |
| 图、存储、AI HTTP、根服务器集成 `pnpm test` | 72/72 通过 |
| 新页面桌面/手机浏览器 `pnpm test:browser` | 22/22 通过 |
| 旧模块浏览器回归 `pnpm test:legacy` | 16/16 通过 |
| 旧前端 5 文件 SHA256 基线比对 | 全部一致 |
| 外部真实模型问答与建议质量 | 待配置后验收，未声称通过 |

- `unit-tests.txt`：图、存储、AI HTTP 接口和真实服务器入口测试。
- `browser-results.json`：新增页面真实浏览器验证，包含 250 节点本地测量。
- `legacy-results.json`：旧模块 16 项浏览器回归、源文件 SHA256 比对、真实接口降级记录。
- `opening-desktop.png`、`workspace-desktop.png`、`workspace-mobile.png`、`ai-mobile.png`：新增页面截图。
- `ai-unconfigured.png`：真实未配置模型的提示。
- `proposal-preview-fixture.png`：受控 HTTP 测试提供者的待确认草案，非真实模型建议。
- `legacy-report.png`、`legacy-prep.png`：原综合报告与求职冲刺截图。

受控 HTTP 提供者测试真实通过生产 Router、模型适配器、结构化校验、草案签名、浏览器确认和本地持久化；它只验证协议与交互，不代表真实外部模型质量验收。旧岗位列表另有明确标记的受控数据测试，真实搜索降级单独记录。

本轮的 250 节点/249 条边测试记录的是实际本地加载与滚轮操作耗时；没有声称达到 60fps 或生产 SLA。

## 改动文件与回退

原业务文件只改 `server.js`（新增隔离路由、开关与必要静态边界），`package.json`（新增检查和测试命令），另新增 `.gitignore`。原首页仍是 `/`。

新增应用：`journey/index.html`、`style.css`（设计源原样保留）、`workspace.css`、`app.js`、`graph.js`、`store.js`、`server.js`、`.env.example`。

新增验证：`tests/browser-runtime.mjs`、`journey-graph.test.js`、`journey-store.test.js`、`journey-api.test.js`、`journey-integration.test.js`、`journey-browser.mjs`、`legacy-browser.mjs`。

新增文档与证据：本文件、原文交接文件副本、`artifacts/journey/`。

无需数据库迁移。快速回退使用 `JOURNEY_ENABLED=false`。完全移除代码时只撤回本轮新增路由、检查命令和新增文件，不要还原用户原有的首页/求职修改。图数据可保留，也可在页面“我的路径”中单独删除；不能清空整个 localStorage。

## 遗留事项

- 尚无真实模型密钥与模型名称，真实外部模型问答/草案质量验收待配置；未配置、异常与受控协议测试已经实施。
- 旧招聘搜索也未配置 Coze token：推荐返回 `200 guided`，独立搜索返回 `503 SEARCH_NOT_CONFIGURED`，界面正确降级。
- 原站依赖公网 Tailwind、Chart.js 与 PDF 库，本次加载成功，原站离线 CDN 能力没有在本轮重写。
- 未部署公网，没有变更 Render 环境、原首页或发布配置；P1/P2 均未开始。
