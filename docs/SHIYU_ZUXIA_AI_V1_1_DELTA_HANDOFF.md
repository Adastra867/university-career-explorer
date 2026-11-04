# 「始于足下」v1.1 AI 顾问增强 — Codex 增量 HANDOFF

> **更新日期**：2026-10-14  
> **适用版本**：原 `SHIYU_ZUXIA_CODEX_HANDOFF.md` v1.0（完整 822 行）的增量需求。  
> **交付要求**：以下 3 项需求必须在 **P0** 形成可运行闭环，不允许仅制作静态界面或用固定文本假装 AI 输出；原有职业测评、JD 匹配、求职支持和人生树画布保持不变。  
> **前提**：尚未审查真实仓库。所有文件名、组件名、API 路由、数据库表名都是可适配建议，Codex 必须先确认实际技术栈、登录/存储方式及已有 AI provider。

## 0. Codex 立即执行指令

先阅读**上一版完整 HANDOFF**和本增量文件，审查仓库中 `AI 顾问`、`人生树节点`、`图存储`、`侧栏`、`底部工具栏`、`现有 LLM provider` 的实现。列出已实现/尚未实现部分、潜在回归风险和最小修改文件集合，再按 P0-AI.1 → P0-AI.2 → P0-AI.3 → P0-AI.4 顺序实施。不要覆盖旧功能，未获得授权不要修改项目正式首页。没有 DeepSeek key 时仍要完成 UI、数据模型、模拟测试和 DIY 流程，**但要将真实 AI 调用标为待配置/未验证**。

**三项用户需求不可遗漏**：

1. 「陪你探索的 AI 顾问」支持**可配置的 DeepSeek（DS）模型**，用于真实问答和建议。
2. **每一个可继续生长的节点**都有 `AI 建议` 按钮；点击生成**恰好 3 个**下一步候选，用户**单选或多选**并确认后才把节点加入自己的树。
3. **每一个 AI 顾问问题必须保存**，与当时的节点/路径关联。再次点击该节点时，**底部状态栏可展开对应历史问答**。AI 可基于相关历史问答生成**路线详细介绍草稿**，由用户确认/编辑后展示在路线详情中。

---

## 1. P0-AI.1：接入可配置 DeepSeek 模型

### 1.1 用户体验

- 在现有 `陪你探索的 AI 顾问` 标题处增加小型 `模型设置 ⚙` 入口（仅有配置权限的账号可编辑）；普通使用者看到当前模型名、连接状态，不看 API Key。
- 配置项：`AI 供应商（DeepSeek）`、`模型`、`服务地址（只读/官方地址）`、`API Key（写入时仅一次展示，之后掩码）`、`测试连接`、`启用/停用 AI`。
- 单一站点共享 Key：优先采用**部署端密钥管理/环境变量 + 管理员只读状态与模型设置**；若确需网页输入 Key，必须通过**管理员鉴权的服务端接口**写入加密密钥存储，**不可只写 localStorage、前端 `.env`、页面 JS 或数据库明文字段**。
- 普通用户不必自己输入 Key 就能使用站点管理员配置好的模型。未来若增加 BYOK（用户自带 Key）需独立权限/加密与费用方案，不是本轮必做。
- 「测试连接」应由后端使用最低成本的实际 API 请求，回传 `connected / not_configured / unauthorized / insufficient_balance / rate_limited / provider_error` 等状态和可读错误；**绝不返回 Key 或包含 Key 的原始错误对象**。
- 右侧 AI 顾问：回答支持增量流式显示；发送、生成中、成功、失败、取消都要有明确状态。保留「针对当前节点 / 当前路径 / 授权范围内的整棵树」上下文模式。

### 1.2 DeepSeek 官方当前接口信息（2026-10-14 核验）

- OpenAI 兼容 Base URL：`https://api.deepseek.com`。
- Chat Completions：`POST /chat/completions`，通常通过 OpenAI 兼容 SDK 访问。
- 新项目默认模型建议 `deepseek-flash`；若实际账号可用且用户选择，可支持 `deepseek-v4-pro`，但**不要把已停用的旧名 `deepseek-chat` / `deepseek-reasoner` 当成默认值**。2026-04 官方更新说明旧名于 2026-07-24 停用。
- `stream: true` 支持 SSE 增量回答；**Chat Completions SSE** 通常以 `[DONE]` 结束。若项目改用 Responses API，应分别适配其**不同事件协议**，不能混用解析器。
- 结构化生成可用 `response_format: {"type":"json_object"}`；在提示词明确要求 `json` 并给出示例；官方提示仍可能返回空内容或截断，必须对响应进行**独立 schema 校验、超时和错误兜底**。

参考官方来源：
- https://api-docs.deepseek.com/zh-cn/
- https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
- https://api-docs.deepseek.com/zh-cn/updates/
- https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/
- https://api-docs.deepseek.com/zh-cn/guides/json_mode/
- https://api-docs.deepseek.com/zh-cn/quick_start/error_codes/

### 1.3 服务端配置契约

```dotenv
# .env.example — 只允许示例占位符，禁止提交真实密钥
JOURNEY_AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
JOURNEY_AI_ENABLED=true
# 下列保护项为建议默认值，Codex 结合现有项目预算/负载决定最终数值
JOURNEY_AI_MAX_OUTPUT_TOKENS=1500
JOURNEY_AI_TIMEOUT_MS=45000
```

- 读取配置仅限服务端。生产环境使用秘密管理服务或部署环境变量；更新 Key 不应触发向普通用户泄露。
- Base URL 默认限制官方域名；若未来支持第三方兼容供应商，需要管理员白名单、SSRF 防护以及独立的 provider adapter。
- 前后端明确区分 `unconfigured`（未配置）、`configured`（已设置但未验证）、`connected`（已成功测试）、`error`（最近请求失败），避免假成功。
- 客户端只调用自家 `/api/journey/...` 路由，不直接请求 `api.deepseek.com`。
- 复用现有日志/监控机制；可记录消耗 token、失败类别、请求 ID 与模型名，不记录密钥及整段隐私问答。
- 429/5xx 做有限退避；401 和 402 不盲目重试；生成期间加并发限制、取消和费用预算。

### 1.4 Provider 接口示例（类型契约，非现成的仓库实现）

```ts
interface JourneyAIProvider {
  chat(input: { messages: ChatMessage[]; stream: boolean; signal?: AbortSignal }): Promise<ChatResult> | AsyncIterable<ChatDelta>;
  generateNextSteps(input: { context: FocusContext; count: 3 }): Promise<NextStepProposal[]>;
  summarizePath(input: { path: PathSnapshot; messages: HistoricalQA[] }): Promise<PathSummaryDraft>;
  testConnection(): Promise<{ status: 'connected' | 'unauthorized' | 'insufficient_balance' | 'rate_limited' | 'provider_error'; model: string }>;
}
```

如果 TypeScript 类型不适合真实栈，请转换为等价 schema/接口，而不是硬套。

---

## 2. P0-AI.2：每个节点的「AI 建议」按钮 → 恰好 3 个候选

### 2.1 交互流程（必须与 DIY 共存）

```text
点击任意当前可继续展开的节点
   ↓
节点操作区出现 [＋手动添加]  [✦ AI 建议]
   ↓ 点击 AI 建议
AI 结合当前节点、上游路线、已有分支和用户已授权档案，生成 3 个下一步候选
   ↓
面板显示三个候选卡片（默认均未选中；支持勾选 1/2/3 项）
   ↓
每卡显示：节点名称、选择理由、可能前提/需要准备的事、待核实提示
   ↓
[重新生成三个] [取消] [添加已选 1～3 项]
   ↓
用户确认后，**一次图事务**添加所选节点 + 父子连线 + 来源标记
   ↓
画布局部生长，保留视口；支持一次撤销/重做整批新增
```

- `AI 建议` 按钮不能只存在于根节点；第一、第二、第三以及更深层节点都应可触发，职业节点与价值/热爱节点未来也支持。
- 恰好 3 个代表**一次成功的 AI 建议响应显示 3 张候选卡**；不能因为 AI 失败就用假结果充数。失败时显示错误并允许手动新增；如果有预置候选，需要明确标记「系统示例，非 AI 生成」。
- 选项要与父节点关联：`材料科学 → 跨学科 → ①AI+材料 ②技术咨询 ③材料数据分析`。不同父节点不能总给同一套模板；返回时要考虑当前已存在子节点，避免重复。
- 用户可对卡片文字做小幅修改再确认（至少支持标题修改）；可单选、多选（1–3）；默认 0 选防止误写图。
- AI 提议只是**候选（proposal）**，若关闭面板/请求失败/取消，一律不改正式图、不污染已保存路径；只有 `确认添加` 生效。
- 若重复建议已有同名或标准职业节点，优先给出“关联已有节点”或提示去重，不能悄悄生成重复职业实体。节点和边需一起创建、事务提交。
- 用户在等待模型响应时换了焦点节点，旧响应不得插入新节点下面；请求带 `graphId + parentNodeId + graphRevision`，最终确认前再次校验。快速双击按钮与重试必须幂等。

### 2.2 三建议 JSON 契约

```ts
type SuggestionSet = {
  id: string;               // 服务端生成，不信任模型提供的 id
  graphId: string;
  parentNodeId: string;
  graphRevision: number;
  status: 'pending' | 'ready' | 'applied' | 'discarded' | 'failed';
  model: string;
  options: [NextStepProposal, NextStepProposal, NextStepProposal]; // 固定三项
  createdAt: string;
};

type NextStepProposal = {
  optionId: string;         // 服务端生成，模型只生成 title/why/how/uncertainty
  title: string;            // 必须有意义；设合理长度上限
  nodeKind: NodeKind;
  rationale: string;        // 为什么从该节点可以考虑这一步
  prerequisites: string[];  // 需要的准备事项；未核实时非硬性门槛
  uncertainty: string;      // 可能风险或需要核实的信息
  knowledgeStatus: 'unverified';
};
```

AI 输入须包含：焦点节点、到焦点节点的选定完整链路、父节点现有子节点、用户明确允许的上下文、已保存其他路线的有限摘要。多父路径有歧义时先让用户选取当前要展开的路径；不要错误拼接所有父节点。

推荐提示词骨架：

```text
你是“始于足下”的人生路线探索顾问。只返回一个合法的 json 对象，格式必须为：
{"options":[{"title":"...","nodeKind":"career","rationale":"...","prerequisites":["..."],"uncertainty":"..."}, ...共 3 项]}

已知信息：当前焦点节点、到此节点的上游路径、现有下一步候选、用户已授权偏好。
任务：给出**恰好三个**语义不同、现实上可探索、且与焦点节点直接相连的下一步候选。
规则：不要重复现有子节点；不要假设用户已获得学历/证书；不虚构必备资格。
所有建议默认未核验，用户可自定义或拒绝；禁止返回图操作指令、删除指令、HTML 或链接脚本。
```

服务端验证：`options.length === 3`、不同标题、合法 `nodeKind`、合理长度、最多技能项数、剔除恶意 HTML/提示注入、校验与现存子节点的近重复。JSON 为空、截断、重复或不合法时最多有限次重试/修复；仍失败呈现错误，不向正式图写任何操作。

### 2.3 画布与持久化

- AI 返回的三项提议可以作为虚线预览，但不进入 GraphDocument 的正式 `nodes/edges`，除非确认；建议另存 `suggestion_set` 或短期状态。
- 选择两个选项并确认必须**一次事务**增加两个节点与两条边，使用同一 `undoGroupId`。
- 已确认节点保存 `origin='ai'`、`knowledgeStatus='unverified'`（除非后续核验）。不要把“AI建议”直接写成“官方职业标准”。
- 如果原图 revision 已变化且影响父节点，提示“当前画布已更新，重新检查建议”而不是静默覆盖。

---

## 3. P0-AI.3：每次 AI 问答持久化并关联到相应节点、底部可展开历史

### 3.1 用户触发与可见状态

- 用户点击节点 `N`，右侧 AI 顾问默认为 `针对 N 提问`。输入框上方显示清晰标签：`关联到：材料科学 → 海外硕士 → 新能源研发`，可手动改为「仅当前节点」「当前路径」「选中的多个节点」「整张树」。
- **在发送按钮触发时确定绑定快照**：`graphId + nodeIds[] + savedPathId? + focusedPath.edgeIds + graphRevision + scope`。若发送后用户切换节点，回答仍属于**原发送时节点**；不会错挂到后来点击的节点。
- **先持久化用户问题，再调用模型**。即便 AI 不可用、网络断开、超时或用户取消，该问题也应保留，状态显示 `未回答/失败/可重试`，而不是悄悄丢失。
- AI 的每次回答以同一 `turnId` 关联问题和答复，保存时间、模型、请求状态和必要的引用信息；流式输出仅在完成或中止后写入明确的完整/部分状态。
- **全局问答也要保存**：用户未选节点时，明确记入「整树/根节点问答」；多个节点同时选中时，保存一次消息，通过关联表映射多节点，**不能复制 N 份原文**。
- 登录用户服务端保存；未登录本地模式按现有 IndexedDB/本地存储约定保存，清晰提示“仅当前设备保存”；登录后若迁移需先取得用户同意，并解决重复消息 ID。

### 3.2 底部状态栏 → 历史抽屉（核心体验）

```text
┌─────────────── 人生树中央画布 ─────────────────┬── AI 顾问 ──────────┐
│ [新能源材料研发] ← 当前选中的节点             │ 关联：当前节点       │
│                                               │ [输入新问题……]      │
├───────────────────────────────────────────────┴──────────────────────┤
│ ▴ 此节点的历史问答（4）   最近：需要哪些技能？   [展开]                │
├────────────────── 点击后出现的底部抽屉 ─────────────────────────────┤
│ 2026-10-14  Q：我要读研才能进这个方向吗？                          │
│             A：具体取决于 JD...（AI 建议，未核实）   [查看详情]       │
│ 2026-10-14  Q：现在开始应补哪些能力？                              │
│             A：可考虑实验设计、数据分析...          [查看详情]       │
│ [查看更早记录]    [根据这些问答更新该路线介绍]  [收起]              │
└──────────────────────────────────────────────────────────────────────┘
```

- 默认底部只有一条轻量状态栏：`此节点历史问答 X 条 · 最近提问摘要`，不遮挡树；点开后展开**下方抽屉**，时间轴按时间排序，支持分页/加载更多与收起。
- 点击不同节点：下方内容立刻切换为那个节点的相关问答；**没有历史时显示空状态**，不可显示上一个节点的数据。
- 一条问答展示问题、答案预览、生成时间、模型、是否核实、相关路径，提供 `展开答案`、`继续追问`、`重新询问`、`删除记录`（确认）。
- `继续追问` 应保持同一个 `threadId` 并显示要引用哪些之前的消息；`重新询问` 产生新的 `turnId`，不覆盖旧答复。
- 针对**完整路径**的问题可在路径中相关节点被选中时检索，但 UI 区分 `直接关联本节点` 和 `本节点所在路线相关`，防止内容混杂。
- 手机端同样用底部抽屉或独立页面；高度有限、内容内部滚动、可一键关闭，不应把当前画布完全遮住。
- 删除节点时，问答处理要显式约定：默认不静默删用户问答，可存档为 `已归档节点的问答` 并允许用户执行彻底删除；**删除对话**则必须删除对应关联及派生内容或使派生总结失效。

### 3.3 数据模型（扩展原 GraphDocument，但不要把全部聊天塞进去）

```ts
type AiConversationTurn = {
  turnId: string;
  graphId: string;
  ownerId?: string;           // 已登录时由服务端绑定；匿名本地模式可无该字段
  threadId: string;
  clientRequestId: string;    // 幂等键，防止网络重试重复提问
  question: string;
  answer?: string;
  status: 'queued' | 'generating' | 'completed' | 'cancelled' | 'failed' | 'unconfigured';
  model?: string;
  focusNodeIds: string[];     // 发送当下的绑定，不随之后的选中状态变化
  focusedPathEdgeIds?: string[];
  savedPathId?: string;
  scope: 'node' | 'path' | 'multi_node' | 'graph';
  graphRevisionAtAsk: number;
  pathSnapshotLabel?: string; // 历史展示用，不代表当前图状态
  citations?: Array<{ sourceId: string; title: string; url?: string }>;
  createdAt: string;
  completedAt?: string;
};
```

持久化建议（按原栈改名）如下：

| 逻辑表 / 集合 | 关键字段 | 说明 |
|---|---|---|
| `journey_ai_turns` | `turn_id, owner_id, graph_id, thread_id, question, answer, status, model, scope, graph_revision, path_snapshot, created_at` | 每一次问答独立保存，可重试/追问 |
| `journey_ai_turn_links` | `turn_id, node_id?, edge_id?, saved_path_id?, link_kind` | 让一个问答关联多个节点/路线，不重复原文 |
| `journey_ai_suggestion_sets` | `set_id, graph_id, parent_node_id, base_revision, options_json, status` | 固定三个待确认建议，避免重复请求误写图 |
| `journey_path_narratives` | `narrative_id, graph_id, saved_path_id, summary_json, origin_turn_ids, based_on_revision, status, user_edited, updated_at` | 路线介绍的草稿、确认版与溯源 |
| `journey_ai_provider_config`（可选） | `provider, model, secret_ref, enabled, updated_at` | 仅服务端；如果部署用环境变量可不建表 |

> 与原 v1.0 的 `journey_ai_sessions` 并存或迁移兼容。**不要把它误用成仅存最新摘要的单条 session**，本次要求可浏览每条原始历史问答。

数据库索引至少考虑 `(owner_id, graph_id, created_at)`、`(graph_id, node_id)`（关联表）、`(thread_id, created_at)` 与 `client_request_id UNIQUE`（按用户/图作用域）；接口查询时严格核验 graph/turn 归属，禁止跨用户 IDOR。若使用 JSON 文档本地存储，应保持等价索引/筛选逻辑与 schema version。

---

## 4. P0-AI.4：AI 梳理历史问答 → 路线详细介绍

### 4.1 触发方式

- 在已保存路线 `SavedPath` 的详情中增加按钮：`根据历史问答生成/更新路线介绍`。
- 可以从某个节点的历史抽屉点击相同入口；若当前节点可通过多条路径抵达，必须先让用户选择要总结的**具体路径**，不能自行把不同路线的问答拼在一起。
- 只检索与该条路径**直接关联**或用户勾选追加的相关问答；默认不要读其他分支、未授权个人档案或 P2 私密价值反思。
- AI 先生成**可审阅的草稿**，用户可修改、接受或放弃。**不能自动覆盖用户自己写的路线描述**。
- 摘要保存后，点击路线可在右侧「路线详情」看到 `AI 整理的路径介绍` 独立板块，并显示更新时间、引用的历史问答数量、草稿/已确认标志。

### 4.2 路线介绍结构

```ts
type PathSummaryDraft = {
  savedPathId: string;
  title: string;
  currentState: string;         // 用户当前在哪儿，必须基于用户明示的事实
  destination: string;          // 希望走到哪里，是“计划”而非“已实现”
  motivation: string[];         // 历史问答反映出的兴趣/考虑，不构成心理标签
  requiredPreparation: Array<{
    item: string;
    evidenceStatus: 'user_plan' | 'sourced_fact' | 'needs_verification';
    supportingTurnIds: string[];
    sourceIds?: string[];
  }>;
  risksAndUnknowns: string[];
  nextActions: string[];
  sourceTurnIds: string[];      // 显式溯源：每条重要判断能跳回原问答
  graphRevision: number;
  status: 'draft' | 'confirmed' | 'stale';
};
```

**推荐路线详情排版：**

1. 路线标题 + 有向节点链：`材料本科 → 海外硕士 → 新能源材料研发`。
2. `我为什么考虑这条路`：从**用户表达过的**问题和回答归纳，不要把 AI 推测当真实动机。
3. `需要准备什么`：学历、语言、技能、项目、证书与时长；逐条标「已核实 / 用户规划 / 待核实」。
4. `主要风险 / 未确定的问题`：真实不确定性，不用虚假的百分比录取概率。
5. `建议的下一步`：可操作的小步骤，不能未经允许自动生成任务/报名。
6. `历史依据`：可点击 `问答 #Q12、#Q17、#Q25` 回到抽屉对应问题；P1 再链接官方证据来源。

### 4.3 同步、更新与删除

- 生成时记录 `basedOnGraphRevision`、输入问答 `turnIds + updatedAt` 或哈希、生成时间、模型名。路径节点/边变化、相关问答新增/删除、证据更新时，将简介标记为 `可能过期`，展示 `重新梳理` 按钮；**不要在用户未确认时悄悄覆盖**。
- 编辑后的用户版简介与 AI 草稿分开存储；用户内容优先展示，更新 AI 草稿不应清空用户修改。
- 删除历史问答后，应从摘要溯源中移除、标记旧摘要失效，并提示重新生成/删除受影响派生摘要，防止删除的数据仍通过总结曝光。
- 对同一路线并发生成摘要时只接受与最新 `graphRevision` 匹配的草稿；防止旧结果覆盖新版本。
- 不把“用户曾经问过某个问题”直接推断为“用户一定认同答案”或“用户已具备该能力”。对互相矛盾的问答，报告冲突并提示用户确认。

---

## 5. API 契约（示例，最终以仓库既有路由风格为准）

| 接口 | 用途 | 鉴权与关键约束 |
|---|---|---|
| `GET /api/journey/ai/config/status` | 查询模型名/启用/连接状态 | 不返回任何密钥 |
| `PUT /api/journey/ai/config` | 保存模型配置（可选网页配置） | 仅管理员；密钥写入服务端安全存储 |
| `POST /api/journey/ai/config/test` | 服务端向 DS 发起真实最小请求 | 权限检查；有请求成本限制 |
| `POST /api/journey/ai/chat` | 保存提问，结合节点路径发送 DS 并流式回答 | `graphId, focusNodeIds, pathId?, scope, text, clientRequestId`；服务端构造上下文；保存完整问答和状态 |
| `POST /api/journey/nodes/:nodeId/ai-suggestions` | 为指定节点生成三个候选 | 不更改 graph；返回带 `baseRevision` 的 3 项建议 |
| `POST /api/journey/ai-suggestions/:setId/apply` | 用户确认所选 1–3 项 | 校验 `expectedRevision`、候选归属、幂等键；事务写图 |
| `GET /api/journey/nodes/:nodeId/ai-history` | 取该节点的历史问答 | 授权过滤；按时间倒序分页；直接/路径关联分类 |
| `GET /api/journey/ai-history` | 整树问答列表 | 所属用户图级隔离；可按路径过滤 |
| `DELETE /api/journey/ai-history/:turnId` | 用户删除一条记录 | 先确认归属；联动摘要失效、关联清理 |
| `POST /api/journey/paths/:pathId/summary/draft` | 聚合相关历史问答生成摘要草稿 | 只读图和历史；不覆写正式简介 |
| `PUT /api/journey/paths/:pathId/summary/confirm` | 用户确认/编辑 AI 摘要 | 提交版本号；保留原始 DIY 描述 |
| `GET /api/journey/paths/:pathId/summary` | 获取当前已确认版与新草稿状态 | 版本标记 fresh/stale 与问答溯源 |

后端 Chat 流建议向前端发送以下有序事件（若仓库已有流协议则适配之）：

```text
event: question_saved        data: {"turnId":"...","status":"generating"}
event: answer_delta          data: {"turnId":"...","text":"..."}
event: answer_completed      data: {"turnId":"...","status":"completed","model":"deepseek-flash"}
event: answer_failed         data: {"turnId":"...","status":"failed","errorCode":"provider_timeout"}
```

不要把上面的**自家前后端事件名**误当成 DeepSeek 原始 SSE 格式。转发层要解析供应商格式，落库后再转成站内事件。

## 6. 输入输出示例：三建议 → 多选 → 路线介绍

**测试前提（示例数据，不是已核验职业事实）**：

- 用户的当前图：`我 · 此刻 → 材料科学 → 跨学科转型`。
- 点击 `跨学科转型` 的 `✦ AI 建议`。
- DS 返回三个候选：`AI + 材料`、`材料数据分析`、`技术产品管理`，分别有一句理由与准备条件。
- 用户勾选前两项，点击 `添加 2 项`。画布应出现 2 个新节点与 2 条边；第三项未出现。
- 点击 `AI + 材料`，询问 `我需要先学 Python 吗？`。问题立即保存至该节点，并在 AI 回答完成后补上答案。
- 点击其他节点、再点回 `AI + 材料`，底部显示 `历史问答（1）`；展开能看到问题、答案、时间和所属路径。
- 用户将路线 `材料科学 → 跨学科转型 → AI + 材料` 保存，并询问更多问题。
- 在路线详情点击 `根据历史问答生成路线介绍`，AI 从**该路线相关的问答**中生成可编辑介绍草稿；点击确认后展示，但不删除此前用户 DIY 的文字。
- 新增一个问题或修改路径后，旧介绍出现 `可能过期 · 重新整理` 提示。

## 7. 分期范围与开发顺序更新

| 阶段 | 本次必须交付 | 可延后内容 |
|---|---|---|
| **P0（本次开发）** | DeepSeek 服务端接入与配置状态；真实问答；每节点恰好 3 条 AI 建议且可多选确认；所有问题关联节点/路径持久化；节点底部历史抽屉；至少一条路线可从历史问答生成并确认简介；无密钥/异常情况可用 | 海量知识库、实时全网检索、高级语义回忆、多端冲突智能合并 |
| **P1** | 从可信 JD/招生来源补充建议证据；把来源、能力差距、证书硬/软性要求显示到候选与路线简介；可搜索历史、相关性检索、更加精细的自动摘要刷新提示 | 完整人生价值图谱、智能人生叙事 |
| **P2** | 个人价值/热爱/哲学等节点继续复用“3 AI 建议 + 历史绑定”；长期阶段版本与跨树回忆；私密反思授权、导出与删除 | 自动替用户做人生选择、未经同意公开/分享敏感内容（永久禁止） |

### 建议垂直切片

- **P0-AI.1**：配置/测试 DeepSeek + 当前节点真实流式聊天 + 无 Key 降级。
- **P0-AI.2**：任意节点 3 建议 + 单多选 + 事务确认 + 撤销。
- **P0-AI.3**：问题先存库 + 焦点绑定 + 底部历史抽屉 + 删除/分页。
- **P0-AI.4**：从节点选择指定路线 + 多轮问答梳理 + 路线详情草稿/确认/过期标记。
- **P0 回归**：覆盖旧 v1.0 的 T01–T20，另加下文测试；必须用真实浏览器跑一次交互。

## 8. 新增验收测试（最低必须通过）

| 编号 | 场景 | 通过标准 |
|---|---|---|
| P0-AI-T01 | 后台未配置 API Key | 状态显示未配置；手动 DIY、图保存、历史问题记录正常；绝不伪造 AI 输出 |
| P0-AI-T02 | 管理员设置 DeepSeek | 服务端存密钥，客户端看不到；可切换可用模型并显示当前模型名 |
| P0-AI-T03 | 测试连接与真实聊天 | 真实 DS 返回回答（无凭证环境报告未测），回答提及正确聚焦节点/路径 |
| P0-AI-T04 | 任意节点触发 AI 建议 | 根/中间/叶子节点均有入口；成功显示**恰好三项**且内容与该节点相关 |
| P0-AI-T05 | 单选 / 多选建议 | 分别确认 1、2、3 项，实际增加对应数量的节点与边；未选项不入图 |
| P0-AI-T06 | 拒绝建议与重复点击 | 取消图不变；双击不会重复写节点或扣多次调用（尽力幂等） |
| P0-AI-T07 | AI JSON 异常 | 空 content、非法 JSON、只有 2 项、重复建议、`finish_reason=length` 不损坏画布，提示可重试 |
| P0-AI-T08 | 焦点切换竞争 | A 发问后点 B，A 的回答只挂 A；未误写 B；旧建议不能挂错父节点 |
| P0-AI-T09 | 历史问题保存 | 每一次问过的题目在请求前存储；超时/401/402 也显示原题和失败/未回答状态 |
| P0-AI-T10 | 点击节点显示历史 | A 与 B 历史分别正确，底部状态栏数量正确；可打开、分页、收起 |
| P0-AI-T11 | 多节点/整树问答 | 绑定只存一次文本；页面准确标注关联范围，未选择节点不丢历史 |
| P0-AI-T12 | 刷新和用户隔离 | 刷新历史仍在；用户甲不能通过更改 graphId/nodeId/turnId 获取乙的记录 |
| P0-AI-T13 | 从历史生成路线介绍 | 仅总结该路径相关问答，显示出处 Q 编号，草稿可编辑/确认；不覆盖 DIY 描述 |
| P0-AI-T14 | 数据变更引发摘要失效 | 修改节点/新增问答/删除来源时显示过期状态，确认旧摘要不会悄悄覆盖新版 |
| P0-AI-T15 | 隐私与安全 | Key 不出现在 JS bundle、network response、日志；越权配置失败；删除问答同步处理派生摘要 |
| P0-AI-T16 | 移动端与老站回归 | 手机能打开底部记录且不遮死画布；原测评/JD/历史记录与首页路由无回归 |

**测试证据规则**：未配置实际 DS 凭证只能报告 `mock / contract / UI 测试通过`，不能报告 `DeepSeek 已连接成功`；需要在有权限的测试环境中补做真实接口调用。

## 9. Codex 完工汇报格式

```md
## 开发结论（P0-AI v1.1）
- 已实现：配置 / 3 建议 / 问答历史 / 路线简介（分别列测试证据）
- 真实 AI 是否连接：成功 / 未配置 / 请求失败（错误类别）
- 修改文件：路径及变更原因
- 数据库迁移：迁移文件、向后兼容、回滚命令
- 接口：实际方法与路径、鉴权方案
- UI：设置入口、建议弹窗、节点历史底栏、路线简介页面
- 测试：命令、测试样本、通过/失败清单、手机尺寸验证
- 旧业务回归：测评、JD 匹配、综合报告、求职支持
- 遗留问题：按 P0/P1/P2 分类
- 本地运行和部署：真实命令、需要管理员配置的环境变量
```

## 10. 保持不变的产品原则

1. 人生树由用户决定，AI 只能建议，**不能自动代替用户选路**。
2. 聊天内容与路线选择是两种不同事实；**提过的问题并不等于相信答案，规划过的事情并不等于已经实现**。
3. 模型语言生成与证据检索不是一回事：P0 无实时证据时不装作查过招聘信息，P1 再做 RAG/联网核验。
4. 历史问答属于用户数据，应支持查看、导出、删除和授权范围控制，不能默认把私人反思喂给无关功能。
5. 旧「职途星轨」五步测评、岗位匹配、求职支持的页面与数据必须保留，新增功能先在独立入口工作。
