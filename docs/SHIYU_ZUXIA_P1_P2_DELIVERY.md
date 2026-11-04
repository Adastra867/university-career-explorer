# 始于足下 P1 / P2 本地交付记录

日期：2026-10-13（Asia/Shanghai）。本记录接续 `SHIYU_ZUXIA_P0_DELIVERY.md`；P0 文档是上一阶段的历史记录，其中“没有导入”“不自动加载 .env”等描述已由本轮更新。

## 交付结论

P1、P2 的代码和本地交互已实现，继续使用独立入口 <http://127.0.0.1:5000/journey>，原首页不变。沿用用户指定前端设计的深色背景、青绿光点与分栏；不改动设计源目录。

模型服务已按用户选择接入 DeepSeek，根目录 `.env` 已准备但密钥留空。**真实外部模型回答、哲学对话和生成质量尚未验收**；未配置时返回真实 503 并说明原因，没有伪造模型回答。资料查询本身可使用有限官方库，不依赖模型密钥。Coze 联网检索也尚未配置。

## 仓库复核与实施边界

- 原项目为原生 HTML/JavaScript + Express 5，pnpm 管理依赖，没有数据库、登录、服务端用户档案或现成向量索引。继续采用 SVG 画布、本地版本化 JSON 与独立 Journey Router，没有重构旧站或创建虚假的云同步。
- 原有职业测评、规则解析、JD 匹配、综合报告与求职支持保持原流程；旧后端 `/api/search-jobs`、`/api/recommend-jobs`、`/api/fetch-jd` 保留。
- 旧页面不会自动读取新路线的 URL 参数，因此桥接采用“打开原页 + 明示复制关键词”，没有修改旧页假装实现自动预填。
- `careerPredictor`、`careerPredictorHistory`、`careerPredictorPrep` 仅在用户按字段授权后只读。新图仍使用 `shiyu-zuxia.graph.v1` 及其 `.backup`；扩展资料独立使用 `shiyu-zuxia.workspace.v1`。
- 本轮先实施 P1 的证据、档案授权、路线比较和计划，再增加 P2 的生活维度、版本与隐私控制；每部分都有实际运行验证。

## P1 功能

| 要求 | 实现与边界 |
|---|---|
| 读取旧档案 | 按专业、学段、阶段、技能、偏好选择字段，先预览；模型使用另有开关；可撤销且不写回旧数据。刷新/导入后模型授权关闭。 |
| JD / 报告 / 求职桥接 | 节点详情可打开原岗位匹配、求职准备；复制关键词后在原页粘贴。私密节点没有岗位外传入口。 |
| 受控检索 | 800 字片段、100 字重叠的关键词检索；默认有限离线库，可显式允许 Coze 官方域名检索。无任意 URL 抓取、无大规模爬虫。 |
| PDF / 文本资料 | PDF.js 本地解析 PDF，TXT / MD / CSV 直接读取；最多 3 份、单份 5 MB、PDF 60 页、最终检索文本 20,000 字（含页码）。扫描件提示需要 OCR。逐份勾选后才发送。 |
| 引用 | 真实链接、发布者、核验日期、内容哈希、页码/段落、适用地区与复核窗口；模型只能引用本次检索的 sourceId，服务端绑定元数据，未知来源拒绝。 |
| 注释入图 | 保存来源、标注所选连线均需确认。必要性与个人达成默认未知；来源事实不会自动变成职业硬门槛。确认时再检查图版本和授权。 |
| 个人证据差距 | 区分“已有证据支持 / 可能具备但未证明 / 尚未具备 / 未知待核实”。规则评分、关键词相似和官方申请条件都不能证明个人已达标。可人工修正并填写本人证据。 |
| 2–4 路线比较 | 依据连续边链比较条件、证据、已记录时间/成本、跨领域取舍、共同准备和额外准备；未知明确显示，不制造录取概率。 |
| 行动计划 | 从路径生成近期 3 个月、中期 1 年、长期 3–5 年草案，确认后入图；任务可编辑、设期限、改阶段、完成、删除；条件也可单独转为任务。 |
| 可读报告 | 导出 UTF-8 文本摘要，列出路线、条件、个人证据状态、任务与来源。排除私密路线、反思和原档案；不是自动公开发布。 |
| 离线降级 | 网络故障保留人生树、已存路线和上次查询缓存，显示原核验日期与图版本；不将缓存标为实时搜索结果。 |

有限官方库的三个真实来源已按原文核对并保存事实转述，未复制网站全文：

1. [剑桥 MPhil Materials Science and Metallurgy 申请要求](https://www.postgraduate.study.cam.ac.uk/courses/directory/pcmmmpmsm/requirements)。只适用于该项目，不能推广到所有学校或研发岗位。
2. [PMI PMP 申请资格](https://www.pmi.org/certifications/project-management-pmp)。报考资格不等于任意职业必须持证。
3. [ABB Discovery 毕业生项目](https://careers.abb/global/en/abb-discovery)。项目背景介绍不代表当前有开放岗位，具体国家、批次与 JD 另核实。

30 天（ABB 14 天）是本应用设定的重新复核窗口，不是官方公布的失效日期。未知发布时间不补造。未来扩大知识库应按相同元数据与核验流程登记。

## P2 功能

- 同一张图支持价值、热爱、愿望、哲学、生活方式、人生事件、目标。推进/依赖仍禁止循环；支持、冲突、启发、关联允许回环，不把思考关系误判成非法职业路径。
- 职业、价值、完整人生视图只是过滤显示，不复制或删除原图。节点阶段明确区分设想、探索、计划、准备、已实现、放弃、搁置。
- 自愿反思默认私密，可关联节点、编辑和删除；不进入问答、岗位匹配或公开副本。开放问题按钮是明确的本地提示，真实模型对话没有伪装成已可用。
- 哲学/价值对话的服务端提示要求开放提问、尊重用户原话、区分猜测，不做人格优劣评分或心理诊断；实际模型质量仍待配置后验收。
- 命名版本记录当时的图、条件、任务、反思与备注；可查看至少两份版本并恢复。恢复前另存当前状态，后续版本全部保留；修订号单调，恢复可撤销。最多 30 份版本，超限明确拒绝而不静默裁剪。
- 时间轴按节点更新时间展示阶段；旧状态通过命名版本查看，没有宣称这是连续的服务端人生事件审计日志。
- 公开副本默认无授权节点。逐项选择非私密节点，预览节点、关系与条件后下载；排除资料、档案、任务、反思、个人证据备注和任意属性。图名/路径名中可能夹带的私密内容不进入副本，节点/边/条件 ID 及时间重新生成。
- 当前树 JSON、含命名版本与本机资料的完整备份各有明确用途。完整备份二次确认，可能包含私密内容；不包含临时 40 步撤销/重做堆栈。
- 导入先校验、预览、确认，再事务应用；保留当前图为导入前版本和原命名版本。导入来源降为待核实、公开授权关闭、档案/文档需重新授权；重复资料 ID、畸形/超限备份拒绝且不替换当前数据。
- 删除人生树本机数据只删除 Journey 三个键，保留旧测评与旧求职资料。

## 启动、配置与体验

本次运行环境：Node 24.19.0、pnpm 12.4.2。建议使用支持 `process.loadEnvFile` 的现代 Node（例如 22 或 24）。

```powershell
Set-Location D:\APP\Coze\career
pnpm install --frozen-lockfile
pnpm start
```

新页面：<http://127.0.0.1:5000/journey>。原首页：<http://127.0.0.1:5000/>。

`pnpm start` 现在自动读取根目录 `.env`，系统环境变量优先；`JOURNEY_LOAD_ENV=false` 可关闭文件加载。根目录 `.env` 已忽略，不包含已填写的密钥。参考 `journey/.env.example`，只需将服务器密钥填入 `DEEPSEEK_API_KEY`（或 `JOURNEY_AI_API_KEY`）并重启：

```dotenv
JOURNEY_AI_PROVIDER=deepseek
JOURNEY_AI_BASE_URL=https://api.deepseek.com
DEEPSEEK_API_KEY=填写自己的服务器密钥
JOURNEY_AI_MODEL=deepseek-flash
```

默认模型名与 `max_tokens`、JSON 输出、关闭思考的调用参数按 [DeepSeek 模型文档](https://api-docs.deepseek.com/api/list-models/) 和 [Chat Completions 文档](https://api-docs.deepseek.com/api/create-chat-completion/)核对。可通过 `JOURNEY_AI_MODEL` 改成账户实际可用的模型。密钥只在服务端，浏览器不持有。未配置返回 `AI_NOT_CONFIGURED`，不会用固定示例冒充回答。

体验顺序：

1. 进入人生树，在“更多工具”打开“职业资料授权”，预览旧资料；需要模型使用时再开启对应授权。
2. 保存两条完整路线。点击边可添加条件、记录个人证据或转为任务。
3. “路径资料与核验”查询剑桥材料硕士等具体问题，查看真实链接和日期；资料保存/标注需要确认。
4. “路线比较与报告”选两条路线比较、导出摘要，确认准备清单后在“行动计划”编辑。
5. 新建价值、热爱或生活节点，用关系选择器建立支持/冲突连线；切换视图、写私密反思、保存两个命名版本。
6. “导出、分享与导入”查看公开内容预览或完整备份。备份仅供自己保管时选择完整备份。

## 实际测试与证据

浏览器脚本使用独立临时 context 与合成资料，不读取实际 Chrome 个人档案。真实官方资料和真实本机 API 请求单独验证；模型 HTTP 测试使用明确标注的受控提供者，不代表外部模型质量。

```powershell
pnpm check
pnpm test
pnpm test:browser
pnpm test:next
pnpm test:legacy
```

| 检查 | 结果 |
|---|---|
| 11 个应用模块语法 | 通过 |
| 图/存储/检索/档案/规划/隐私/工作区/AI/API/服务器集成 | 135 / 135 通过 |
| P0 浏览器回归 | 22 / 22 通过 |
| P1 / P2 桌面、手机与离线浏览器 | 20 / 20 通过，无浏览器异常；一次主动模拟断网 |
| 原测评、JD、报告、求职浏览器回归 | 16 / 16 通过 |
| 原前端五文件 SHA256 基线 | 全部一致 |
| DeepSeek 外部真实生成与质量 | 未配置密钥，未验收 |
| Coze 外部实时搜索 | 未配置，降级已验证 |

结果文件：`artifacts/journey-next/unit-tests.txt`、`artifacts/journey-next/results.json`、`artifacts/journey/browser-results.json`、`artifacts/journey/legacy-results.json`。合计 193 项通过，零失败/跳过。最终服务已重启加载当前代码，`artifacts/journey-next/final-health.json` 记录原页面、新页面、本地 PDF.js 与 worker 的 HTTP 200、真实官方证据查询和旧源码哈希核对。

截图均由实际页面生成并视觉检查，位于 `artifacts/journey-next/`：

- `profile-desktop.png`：授权预览。
- `source-desktop.png`、`source-offline-cache-desktop.png`：官方出处、核验日期、断网缓存。
- `comparison-desktop.png`、`comparison-route2-desktop.png`、`comparison-mobile.png`：两路线比较。
- `tasks-desktop.png`、`tasks-mobile.png`：行动计划。
- `life-tree-desktop.png`：职业与生活跨维度图。
- `reflections-desktop.png`、`reflections-mobile.png`：私密反思。
- `history-desktop.png`：两个命名版本及恢复。
- `privacy-desktop.png`：公开预览和备份入口。

另有 `path-report.txt`、`public-share.json`、`complete-archive.json`（均为测试合成资料），以及 `document-fixture.pdf` / 预览图，验证 PDF 解析流程。

## 改动文件

本轮修改：

- `server.js`：根 `.env` 读取、独立新静态资源、PDF.js 本地 worker 路由；旧业务路由保留。
- `package.json`、`pnpm-lock.yaml`：增加 PDF.js 运行依赖和新检查/验收命令。
- `journey/index.html`、`workspace.css`、`app.js`：工具/视图入口、授权控件、扩展面板、AI 引用、取消/授权变更隔离、导出预览。
- `journey/graph.js`、`store.js`：兼容 P0 的任务、来源、反思、命名版本、完整备份及事务导入。
- `journey/server.js`、`.env.example`：DeepSeek、授权上下文、受控检索与真实引用校验。
- `tests/journey-graph.test.js`、`journey-store.test.js`、`journey-api.test.js`：扩展数据/接口验收；`journey-browser.mjs` 的导出检查适配新的预览步骤。

新增：

- `journey/extensions.js`、`extensions.css`：P1 / P2 面板与状态。
- `journey/legacy-adapter.js`、`planning.js`：只读旧资料、证据差距、比较、计划和可读报告。
- `journey/research.js`、`knowledge-sources.json`：受控检索及有限官方库。
- `journey/privacy.js`、`documents.js`：授权投影、公开副本、导入校验、PDF / 文本解析。
- `tests/journey-legacy-adapter.test.js`、`journey-planning.test.js`、`journey-research.test.js`、`journey-privacy.test.js`、`journey-workspace.test.js`、`journey-next-browser.mjs`。
- `scripts/check-syntax.mjs`、本文档和 `artifacts/journey-next/` 证据。

用户原有的 `index.html` 修改、`career-prep.html` 和 `scripts/career-prep.js` 没有撤回。本轮不修改原五个前端业务文件，最终结果以哈希比对为准。

## 遗留与回退

- 没有真实模型或搜索密钥：DeepSeek 的协议/错误/草案/引用校验已由受控服务验证，真实供应商生成质量仍需密钥后实际验收。
- 官方库仅三份，不能称为全面职业数据库或实时招聘库；扫描 PDF 暂不内置 OCR。
- 数据只在当前浏览器，无账号、跨端同步或服务器备份。localStorage 版本检查与 storage 事件覆盖常见冲突，但不是数据库原子 CAS。图/版本与扩展资料分别保存在两个键，跨键没有数据库事务，存储失败会提示并可导出。
- 公开投影会去掉明确私密节点以及包含其标题的关联文本，但不能自动识别所有自由文本语义；用户应在预览中确认自己愿意公开的说明和条件。
- 最多 300 节点、600 连线、30 命名版本；长链适应画布优先保持可读性，可继续缩小/拖动；旧 schema 若有未登记 sourceIds，首次启用来源集合需登记或清除该引用，否则事务拒绝且原图保留。
- 未部署公网、未覆盖首页、未变更 Render。旧站公网 CDN 依赖仍保留。

快速回退：启动前设置 `$env:JOURNEY_ENABLED='false'` 并重启，新页面、资源和 API 返回 404，旧站保持可用；删除该环境变量可恢复。无需数据库迁移。完整撤回代码时保留用户既有修改和 Journey 本机数据，不清空整站 localStorage。
