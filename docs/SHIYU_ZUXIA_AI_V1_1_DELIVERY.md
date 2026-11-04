# 始于足下 v1.1 AI 功能交付记录

日期：2026-10-14，Asia/Shanghai。依据仓库中的两份 v1.1 HANDOFF 实施；这是接续 P0、P1/P2 和并行多树管理工作的当前交付说明，早期交付记录中的样式、存储方式和测试数量属于当时版本。

## 交付范围

已实现四个闭环：服务器 DeepSeek 配置与真实流式协议；每个可展开节点的三个 AI 候选；先保存再发送、锚定节点或路径的问答历史；依据相关历史生成、编辑和确认路线介绍。DIY、边条件、多选、撤销/重做和原职业探索流程继续保留。

**当前服务器未配置真实 DeepSeek 密钥。外部模型连通性、实际生成质量与账户费用尚未验收。** 自动测试使用明确标识的本地 HTTP provider fixture 或浏览器契约应答，不会在未配置时用模板冒充模型回答。

当前本地服务已加载本轮代码：

- 新开幕页：[http://127.0.0.1:5000/journey](http://127.0.0.1:5000/journey)
- 多树大厅：[http://127.0.0.1:5000/trees](http://127.0.0.1:5000/trees)
- 原职业测评首页：[http://127.0.0.1:5000/](http://127.0.0.1:5000/)
- 原岗位匹配、求职准备分别保留 `/job-search.html`、`/career-prep.html`。

新功能继续使用独立路由。原首页没有切换为新开幕页；大厅的返回开幕按钮指向 `/journey`。多树任务新增的浅色紫色界面、树库和各树入口均已兼容。

## 仓库审查与实现选择

| 部分 | 实际情况与本轮处理 |
|---|---|
| 前端 | 原生 HTML/JavaScript、SVG 人生树、原生 dialog；保留现有模块，新增 AI 状态、建议面板、历史抽屉和路线介绍。 |
| 后端 | Express 5、独立 Journey Router；抽出服务器专用 provider 和 v1.1 路由，旧 AI JSON 契约仍可使用。 |
| 数据库与登录 | 仓库没有数据库和账号体系。本轮仍是匿名本机存储，不宣称云同步、跨设备恢复或多用户服务端隔离。 |
| 多树 | 树库索引和每棵树的图/工作区独立存储。AI 记录使用独立版本化 JSON，并严格按 graphId 查询。 |
| 旧业务 | 原职业测评、JD 匹配、报告、求职支持及三个旧业务 API 保留。旧测评和求职存储只在已有授权流程中只读。 |
| AI | 服务器环境变量配置站点共享模型；浏览器仅调用本站接口，没有网页写入 API Key 的接口。 |
| 测试 | 图和存储单元测试、真实本机 HTTP 接口、桌面/手机浏览器及原站回归分别运行。模型 fixture 与真实外部调用明确区分。 |

先实施配置/流式传输，再实施三个候选，随后持久化历史和简介，最后与多树生命周期合并并执行回归。主要风险集中于异步回答归属、跨树数据、授权撤销、迁移副本、删除与简介溯源，已分别设置校验与测试。

## 已实现行为

### P0-AI.1：配置与流式回答

- 模型设置显示供应商、模型和 `unconfigured / configured / connected / error` 状态。普通页面无法读取密钥、写入模型配置或自动触发收费连接测试。
- 管理员连接测试使用独立 `JOURNEY_AI_ADMIN_TOKEN`，只在本次对话框内存使用，关闭后清空；它不是模型密钥。空凭据或错误凭据拒绝调用 provider。
- 测试连接只请求极短回答；成功才标记已连接。401、402、429、服务故障、超时与格式错误映射为可读错误，不回传上游原始错误或凭据。
- DeepSeek Chat Completions SSE 与本站 SSE 各自解析。回答增量显示；取消、断流、超时保留问题及已收到的部分回答，不把 EOF 当成完整成功。
- 429/5xx 有限重试，401/402 不重试；原有请求频率、并发和输出上限继续生效。模型返回 JSON 独立校验，截断、无结束标记、畸形数据明确失败。

### P0-AI.2：每个节点三个建议

- 根节点、中间节点与深层节点都有 AI 建议入口；私密节点禁止外发，DIY 仍可使用。
- 一次成功返回恰好三张卡片，默认零选。显示理由、准备事项和待核实提示；可改标题，选 1–3 项后确认。
- 取消、关闭、错误、焦点切换、树切换和图版本改变都不会把候选写入正式图。
- 确认前复核 graphId、父节点、修订号及签名；所选节点与连线一次事务写入，一次撤销/重做整批操作。幂等请求避免重复添加。
- 重复标题、已存在同名子节点、错误数量、非法 JSON 与截断响应拒绝；失败可以重试或手动添加。

### P0-AI.3：每次问答保存与节点历史

- 每个问题在 fetch 前同步写入本机存储，冻结当时 graphId、根、焦点、完整路径、修订号和请求 ID。存储失败先提示，不发送无法持久化的问题。
- 失败、取消、未配置均留下问题；迟到答案只更新原 turn，切换树不会将旧回答写入新树。
- 底部轻量历史条可展开直接节点、路径、整树和已归档问答，每页 20 条；可展开答案、继续问、重新询问、导出和确认删除。
- 继续问只复用当前图版本和授权范围允许的历史；导入、旧会话及授权改变后的问答不会自动重发。
- 删除节点保留历史并标记归档，避免丢失问题。用户删除问答时同时清除所有以它为输入的派生介绍，其他树保持不变。
- 手机历史抽屉限制高度、内部滚动；展开时将焦点节点移到可见画布，关闭后恢复视口，仍可继续 DIY。

### P0-AI.4：路线介绍草稿

- 从已保存的连续路线进入介绍，默认仅使用当前授权下直接关联的问答；其他公开问答需要逐条勾选。
- 历史授权失效或导入的问答默认不选。用户重新选择时明确确认将重发问答原文；撤销不发送。
- 模型输出包含当前状态、计划方向、考虑原因、准备事项、风险未知与下一步，并保留问答依据 ID。
- 草稿、已确认版和用户编辑版分别存储；确认或编辑介绍不会自动修改节点、条件或任务，不覆盖原有手写路线备注。
- 原路线、相关输入问答或来源更新后显示可能过期；用户版本仍保留。生成期间版本、焦点、授权或输入变化时拒绝旧响应。
- 可点击依据返回历史问答。事实准备事项必须保留来源约束，未知内容不能被包装成已核实的用户经历。

### 多树兼容与旧数据保护

- 切换树分别加载焦点、视口、路线、工作区、问答和简介；离开树取消未完成请求。
- 复制树与导入树将 turn/thread/request/narrative ID 和简介内的所有问答引用一起重映射，原树及其他树原样保留。
- 当前树完整备份包含本树 AI 历史和介绍，明确提示含私密资料。公开副本不附带 AI 历史。
- 导入、恢复和复制的模型发送授权清空；导入简介标为可能过期。导入图及其备份/版本来源降为待核实、公开授权关闭。
- 删除一棵树只清理它的 AI 记录与树数据；删除副本不影响来源树。无效备份先拒绝，不覆盖现有数据。
- 旧 `ui.chat` 完整迁入独立 AIStore 后清理冗余聊天字段，保留图、工作区和旧业务资料；迁移失败保留原文并报错，避免静默截断或删除。

## 配置、启动与回退

```powershell
Set-Location D:\APP\Coze\career
pnpm install --frozen-lockfile
pnpm start
```

服务器自动读取根目录 `.env`，系统环境变量优先。参考 `journey/.env.example` 填写，禁止把真实密钥放到前端或提交仓库：

```dotenv
JOURNEY_AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
JOURNEY_AI_ENABLED=true
JOURNEY_AI_MAX_OUTPUT_TOKENS=1500
JOURNEY_AI_TIMEOUT_MS=45000
JOURNEY_AI_ADMIN_TOKEN=
```

填入真实服务器密钥及独立管理员凭据后重启，再进行模型设置中的实际连接测试、问答、三个建议和简介质量验收。`JOURNEY_AI_*` 兼容配置优先于 `DEEPSEEK_*` 别名。非官方网关必须由部署端设置精确地址白名单；请求参数不能改变 provider 地址。

`JOURNEY_AI_ENABLED=false` 停用模型而保留本机树；`JOURNEY_ENABLED=false` 关闭新路由，原站继续可用。关闭开关不删除本机数据。服务器重启会使旧的未确认签名草案失效，已确认图与问答不受影响。

## API 与数据契约

| 接口 | 用途 |
|---|---|
| `GET /api/journey/ai/config/status` | 无密钥的配置状态；原 `/ai/status` 保持兼容。 |
| `POST /api/journey/ai/config/test` | Bearer 管理员凭据鉴权，低成本真实连接测试。 |
| `POST /api/journey/ai/chat` | `stream:true` 增量 SSE；默认仍支持旧 JSON 响应。 |
| `POST /api/journey/nodes/:id/ai-suggestions` | 绑定父节点/路线/版本生成三个候选及签名。 |
| `POST /api/journey/ai-suggestions/:id/apply` | 校验选项、编辑标题、签名和版本，返回待本机确认应用的原子图操作。 |
| `POST /api/journey/paths/:id/summary/draft` | 校验路线与选中的问答，返回可编辑、有问答溯源的简介草稿。 |

本站 SSE 事件为 `answer_delta`、`answer_completed`、`answer_failed`。provider 的 Chat Completions SSE 使用自身协议和 `[DONE]`，两种协议不混用。

AI 本机键为 `shiyu-zuxia.ai.v1`，一个原子 JSON envelope 按 graphId 分区。问题包含冻结的节点/边/路线 ID、请求 ID、线程 ID、状态、回答、模型、来源及时间；简介包含输入问答 ID、各版本与过期指纹。最多 1000 条问答、30 份简介，超限拒绝并提示导出，不裁剪历史。跨标签页 serial 冲突、配额、损坏数据均拒绝覆盖原串。

服务端只保存短时有界草案/幂等缓存，没有用户问答数据库。多副本部署需要独立评估共享幂等、鉴权、成本管理和持久化。

## 实际测试和证据

所有浏览器测试使用临时 context 与合成数据，不读取个人浏览器档案。运行命令及结果：

| 检查 | 结果 |
|---|---|
| `pnpm check` | 21 个应用模块语法通过。 |
| `pnpm test` | 239/239 通过，见 `artifacts/journey-ai-v11/unit-tests.txt`。 |
| `pnpm test:browser` | P0 浏览器 22/22 通过。 |
| `pnpm test:next` | P1/P2 浏览器 20/20 通过。 |
| `pnpm test:legacy` | 原站浏览器 16/16 通过。 |
| `pnpm test:forest` | 多树浏览器 18/18 通过，包含手机与旧树迁移。 |
| `pnpm test:ai-v11` | v1.1 生产页面与真实本机 HTTP provider fixture 28/28 通过，0 页面异常；48 次受控 provider 请求，含旧授权原文重新确认。 |
| `pnpm test:ai-panels` | 面板浏览器契约 10/10 通过，包含授权撤销、拒绝重发及确认期间输入变化；见 `artifacts/ai-v11-panels/results.json`。 |
| `pnpm test:ai-forest` | 多树 AI 浏览器 8/8 通过；实际复制/导入/导出/删除的问答和简介验收，见 `artifacts/journey-ai-forest/results.json`。 |
| `node scripts/verify-ai-v11-health.mjs` | 20 个路由状态检查、原首页逐字一致、5 个旧源码 SHA256 一致、未鉴权连接测试 403、真实未配置聊天 503。 |
| 外部 DeepSeek / Coze | 无密钥，未验收真实外部生成或搜索。 |

核心结果在 `artifacts/journey-ai-v11/results.json`、`final-health.json`、`unit-tests.txt`；回归日志同目录。原站五文件哈希基线在 `artifacts/journey/legacy-baseline.json`。

合计 239 项单元/接口检查与 122 项浏览器检查通过，共 361 项；未失败或跳过。汇总记录在 `artifacts/journey-ai-v11/validation-summary.json`。

实际页面截图：

- `artifacts/journey-ai-v11/model-settings-fixture.png`：模型状态与管理员连接测试。
- `artifacts/journey-ai-v11/three-options-fixture.png`：三个候选与单多选。
- `artifacts/journey-ai-v11/history-late-answer-fixture.png`、`history-pagination-fixture.png`：冻结归属、历史与分页。
- `artifacts/journey-ai-v11/history-reconsent-fixture.png`：旧授权历史原文重新确认。
- `artifacts/journey-ai-v11/narrative-confirmed-fixture.png`：已确认/编辑简介及历史依据。
- `artifacts/journey-ai-v11/mobile-history-fixture.png`、`mobile-canvas-fixture.png`：390px 手机历史与 DIY。
- `artifacts/ai-v11-panels/production-settings-mobile-light.png`：真实本机服务未配置状态。
- 多树 AI 补测截图在 `artifacts/journey-ai-forest/`。

fixture 截图带有“非真实 DeepSeek”的标识。390×844 验收中历史抽屉高约 270px，上方保留约 256px 画布，当前深层节点完整可见；浅色文字对比度检查通过。

## 改动文件

| 文件 | 作用 |
|---|---|
| `journey/ai-provider.js`、`ai-v11-server.js`、`server.js`、`.env.example` | 服务端 provider、SSE、新 API、配置示例。 |
| `journey/ai-store.js` | 问答/简介存储、迁移、冲突保护、过期检测与删除。 |
| `journey/ai-client.js`、`ai-context.js`、`ai-integration.js` | 流式消费、发送绑定/授权与页面集成。 |
| `journey/ai-panels.js`、`ai-v11.css` | 设置、三个建议、底部历史与可编辑简介。 |
| `journey/ai-legacy-migration.js` | 完整保存旧聊天后清理重复原文字段，保护删除语义。 |
| `journey/app.js`、`index.html`、`extensions.js`、`privacy.js` | 与动态树实例、备份、授权和现有画布集成。 |
| `journey/forest.js`、`forest-ai.js` | 保留并行多树管理，补齐 AI 复制/导入/删除和授权清理。 |
| 根 `server.js`、`package.json` | 独立入口、浏览器资源白名单与测试命令。服务器 AI 实现不通过静态路径暴露。 |
| `tests/journey-ai-*.test.js`、`tests/journey-ai-v11-browser.mjs`、`tests/journey-ai-forest-browser.mjs`、`tests/ai-panels-browser.mjs` | 新功能的存储、接口、异常、隐私与浏览器验收。 |
| `tests/journey-forest-privacy.test.js`、已有回归测试及 `scripts/verify-ai-v11-health.mjs` | 多树导入信任清理、兼容回归与最终健康检查。 |
| `docs/SHIYU_ZUXIA_*v1.1*`、本记录、`artifacts/` | 交接文档副本与测试证据；原交接文件和前端设计源目录没有改写。 |

`index.html`、`job-search.html`、`career-prep.html`、`scripts/career-prep.js`、`styles/main.css` 与本轮之前的五文件基线全部一致。仓库原有未提交内容及并行多树工作保留，没有替用户提交或回退。

## 遗留与实际限制

1. 配置真实 DeepSeek 密钥后，需要实际账户验证模型可用性、流式表现、三个建议与简介质量；当前只完成协议和故障链路验收。
2. 数据存在当前浏览器和端口对应的 origin 内，5000 与 5001 互不共享。备份可迁移；没有服务端账号、数据库或跨设备同步。
3. 有限官方资料库不等于全面职业知识库。外部 Coze 检索仍未配置，事实建议保持来源/待核实边界。
4. 没有自动将已确认简介转换为节点、硬门槛或任务；这些操作仍由用户确认现有流程完成。
5. 进程级幂等与管理员静态凭据适合当前本机部署；公开多用户部署的身份、配额与持久化属于后续工程。
6. 图、工作区和 AI 历史分别持久化，完整备份恢复不是跨键原子事务。二阶段存储失败会明确报告部分结果，图操作可撤销，原 AI 历史保留；多树新建副本导入失败会移除失败副本。
