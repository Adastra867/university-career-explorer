# 职途星轨

临时展示分支部署请先阅读 [展示部署说明](docs/DEMO_DEPLOYMENT.md)。当前分支的 render.yaml 面向 Free 展示，默认不启用学生资料库。

职途星轨面向大学生，提供职业方向探索、能力画像、岗位匹配和求职练习。职业规划 AI 支持按对话整理信息、比较选择和制定计划。项目使用 Express 和原生 HTML、CSS、JavaScript。

## 页面与功能

| 入口 | 功能 |
| --- | --- |
| `/` | 方向探索、软硬实力分析、岗位推荐、手动 JD 匹配、报告与测评历史。 |
| `/index.html#intelligence` | 职业规划 AI。支持多轮对话、搜索或管理会话、资料导入、个人画像、方向探索、阶段计划、路线比较和成长建议。可将分析保存到“我的规划记录”。 |
| `/job-search.html` | 按关键词搜索岗位，查看岗位详情和匹配依据。实时岗位检索依赖服务端搜索配置。 |
| `/career-prep.html` | 简历诊断、行业和岗位笔试、模拟面试及练习记录下载。练习由浏览器本地规则生成。 |
| `/trees` | 创建和编辑职业树，在画布中组织节点、查看路线和比较选择。 |
| `/start`、`/admin` | 轻量职业建议、统一资料、访客草稿、活动提交与管理。生产环境需要持久存储。 |

## 本地运行

需要 Node.js 24+ 与 pnpm。数据库使用 Node 内置 SQLite，默认保存到 `data/career.sqlite`。服务启动时自动执行 `p0/migrations/` 下的数据库迁移。

```powershell
pnpm install --frozen-lockfile
pnpm start
```

浏览器打开 [本地工作台](http://localhost:5000/)。使用模型或活动管理时，按 `.env.example` 在项目根目录的 `.env` 中填写所需配置。首次创建管理员时，填写管理员用户名、至少 12 位密码和公开地址，再运行 `pnpm admin:init`。初始化后可从 `.env` 移除管理员密码。重复执行初始化会更新该账号密码并撤销旧登录。

- 学生：[http://localhost:5000/start](http://localhost:5000/start)
- 管理员：[http://localhost:5000/admin](http://localhost:5000/admin)

管理员创建活动后复制 `/start?campaign=<slug>` 链接或二维码。学生保存进度只形成个人草稿；经预览、明确提交后，管理员才可查看提交快照。访客靠本浏览器的 HttpOnly Cookie 续用，清除 Cookie 或换设备不保证恢复。

```powershell
pnpm check
pnpm test
pnpm test:p0
pnpm test:p0:browser
node tests/career-chat-browser.mjs
```

轻量建议可通过 `CAREER_AI_*` 配置在线模型，默认复用 `JOURNEY_AI_*` 或 `DEEPSEEK_*`。模型未配置或调用失败时，该入口会显示规则建议。`node scripts/verify-career-ai.mjs` 可验证轻量建议的真实模型调用。

部署、保存期限、权限、已知限制与验收记录见 [P0 交付说明](docs/CAREER_P0_DELIVERY.md)。开发契约见 [P0 handoff](docs/CAREER_P0_HANDOFF.md)。

## 发布与数据

GitHub `main` 提供 Render Web Service 的构建源码。发布前可运行 `node scripts/check-deploy.mjs` 检查工作区和暂存区。源码包含通用功能和合成测试数据。`.env`、本地 SQLite 数据库、资料导出和测试产物留在本地。浏览器内的个人资料、对话、报告、职业树和文件不会随代码发布。配置密钥请使用 Render 的环境变量。发布命令和回滚方法见 [部署说明](docs/DEPLOYMENT.md)。在 `main` 可运行以下命令完成检查、提交和 GitHub 推送。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy.ps1
```

免费 Render 服务的文件系统是临时的。未配置持久存储时，生产环境提供方向探索、匹配、求职练习和职业树等功能，云端问卷收集与统一资料同步会显示服务不可用。 [职途星轨公网入口](https://university-career-explorer.onrender.com)

职业规划 AI 使用服务端 `JOURNEY_AI_*` 配置，支持 `.env` 中的 `JOURNEY_AI_API_KEY` 和 `JOURNEY_AI_MODEL`，DeepSeek 配置示例见 [Journey 环境变量](journey/.env.example)。在问答中保存或补充个人资料后，新对话会复用最新内容，也可在问答设置中关闭。首次使用其他页面的已有资料时，点击“参考已保存的个人资料”即可启用。个人资料保存在当前浏览器，连接统一资料后修改也会保存到服务器。历史记录和文件内容由用户勾选，联网搜索单独使用公开搜索词。

## 开发协作

首页和岗位页加载已编译的 `styles/tailwind.css`。修改 Tailwind 类或主题后，运行 `pnpm build:styles` 并提交生成的 CSS。职业规划对话的浏览器回归测试使用受控模型服务和合成资料。

组员通过分支和 Pull Request 合并代码到 `main`。合并后在 Render 核对对应提交的部署状态，必要时手动部署最新提交。

## 实时招聘与公开资料搜索

岗位搜索、推荐、JD 正文读取和规划资料检索使用 DeepSeek Search / Fetch，已不依赖 Coze 搜索凭据。默认按顺序读取 `DEEPSEEK_SEARCH_API_KEY`、`JOURNEY_AI_API_KEY`、`DEEPSEEK_API_KEY`、兼容旧配置的 `LLM_API_KEY`。非 DeepSeek 模型密钥不能用于该服务，应另设专用搜索密钥。

`DEEPSEEK_SEARCH_ENABLED=false` 可关闭搜索。仅在服务器本地 `.env` 或部署平台配置凭据，修改后重启。聊天模型与搜索分别计费和鉴权；聊天连通不代表搜索一定可用。官方接口为 `/v1/tools/search` 和 `/v1/tools/fetch`。搜索按 128 个 Unicode 字符限制拆分域名组，单次界面操作可能产生多次计费搜索。

现有前端 `/api/search-jobs`、`/api/recommend-jobs`、`/api/fetch-jd` 契约保持不变。搜索返回原始来源与日期（可能未知），JD 使用 Fetch 读取网页正文。无法读取、需要登录或被限制的页面可手动粘贴。检索结果不保证岗位仍在招；无结果或服务失败时保留明确的检索指导/离线降级，不伪造岗位。数据库与原有匹配规则未改变。

## 求职冲刺在线 AI

`/career-prep.html` 默认使用本地规则；勾选在线 AI 告知后，点击诊断简历或提交面试回答才发送当前目标、JD 和对应材料。后端 `/api/journey/career-prep/analyze` 复用 `JOURNEY_AI_*` / `DEEPSEEK_*` 模型配置及共享限流/并发限制。简历输出包括原文引用、问题、建议、改写及待补充事实；引用必须逐字来自脱敏后的本次材料。模型改写仍需用户核实，不会自动替换简历。

面试仍为四轮，每轮最多一次针对性追问。面试请求仅发送当前问题和回答（不自动上传整份简历和其他历史）。常见邮箱、手机号、18位证件号由后端过滤，但不保证覆盖所有个人信息，发送前需自行清理。练习与 AI 诊断记录保存在浏览器；刷新不会自动调用模型，在线授权也不会自动恢复。笔试继续使用现有题库/参考要点。

模型故障、超时、取消时保留输入，明确显示本地规则反馈；等待期间修改材料会取消请求并拒绝应用旧结果。客户端取消请求后，上游可能已处理，不能保证免除本次费用。测试：`node --test tests/career-prep-ai.test.js`；全量：`pnpm check && pnpm test`。

## 前端交互回归

启动本地服务后运行 `node tests/frontend-interactions.mjs`（默认 localhost:5174，可设置 CAREER_TEST_BASE_URL）验证桌面/手机的求职目标校验、原位报错、刷新和返回、AI设置折叠及离开页面后的滚动/焦点恢复。`node tests/career-prep-browser.mjs` 验证简历与面试请求、取消和降级；`node tests/career-chat-browser.mjs` 使用独立本地假模型验证完整职业规划聊天。上述脚本不调用真实收费模型，也不读取已有浏览器资料。
