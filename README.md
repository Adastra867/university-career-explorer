# 职途星轨

Express + 原生 HTML/JavaScript 的大学生职业探索工具。P0 新增统一资料、四任务入口、访客个人草稿、活动提交和管理员记录；现有方向探索、岗位搜索、JD 分析、求职冲刺与 Journey 保留。

需要 Node.js 24+ 与 pnpm。数据库使用 Node 内置 SQLite，默认持久保存到 `data/career.sqlite`；启动时自动执行可追踪迁移 `p0/migrations/001_initial.sql`。

```powershell
pnpm install --frozen-lockfile
# 首次配置：保留已有 .env，不要覆盖真实配置。
if (!(Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
# 编辑 .env，填写管理员用户名、至少12位密码和公开地址。
pnpm admin:init
pnpm start
```

如果已有 `.env`，只添加 `.env.example` 中需要的配置。管理员密码初始化后可从 `.env` 移除；初始化命令重复执行会更新该账号密码并撤销旧登录。

- 学生：[http://localhost:5000/start](http://localhost:5000/start)
- 管理员：[http://localhost:5000/admin](http://localhost:5000/admin)
- 原有功能：[http://localhost:5000/](http://localhost:5000/)

管理员创建活动后复制 `/start?campaign=<slug>` 链接或二维码。学生保存进度只形成个人草稿；经预览、明确提交后，管理员才可查看提交快照。访客靠本浏览器的 HttpOnly Cookie 续用，清除 Cookie 或换设备不保证恢复。

```powershell
pnpm check
pnpm test
pnpm test:p0
pnpm test:p0:browser
node scripts/verify-career-ai.mjs
pnpm data:cleanup
```

在线 AI 可通过 `CAREER_AI_*` 配置；未填写时复用现有 `JOURNEY_AI_*` / `DEEPSEEK_*`。无密钥、超时、限流和无效输出会明确显示规则建议。AI 正常调用验证脚本只有收到合法在线结果才通过；受控 HTTP fixture 测试不等于真实模型验收。

部署、保存期限、权限、已知限制与验收记录见 [P0 交付说明](docs/CAREER_P0_DELIVERY.md)。开发契约见 [P0 handoff](docs/CAREER_P0_HANDOFF.md)。

原 GitHub → Render 服务的部署参数、存储限制、回滚及后续一键更新见 [部署说明](docs/DEPLOYMENT.md)。修改完成后在 `main` 运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy.ps1
```

原公网地址为 https://university-career-explorer.onrender.com 。原免费服务没有持久磁盘，因此生产问卷收集在配置真实持久存储前暂停；原探索、匹配、求职练习和职业树继续可用。

## 页面与协作

- `/`：方向探索、能力画像、JD 匹配与报告。
- `/index.html#intelligence`：职业规划 AI，支持个人画像、方向探索、阶段计划、路线比较和成长建议。路线可审阅后写入 `/trees`，职业树中也可选节点继续探索或比较。
- `/job-search.html`：岗位搜索与匹配。
- `/career-prep.html`：简历诊断、岗位笔试与模拟面试；使用本地规则与本浏览器保存，无需模型密钥。
- `/trees`：职业树画布。

首页和岗位页从本站加载已编译的 `styles/tailwind.css`。修改 Tailwind 类或主题后，运行 `pnpm build:styles` 并提交生成的 CSS。

职业规划 AI 使用职业树的服务端 `JOURNEY_AI_*` 配置，支持 `.env` 中的 `JOURNEY_AI_API_KEY` 和 `JOURNEY_AI_MODEL`，DeepSeek 配置示例见 [Journey 环境变量](journey/.env.example)。使用个人资料、历史和文件内容由用户勾选，联网搜索单独使用公开搜索词。确认保存的规划记录和职业树保存在当前浏览器。

求职练习的页面与样式在 `career-prep.html`，规则和题库在 `scripts/career-prep.js`，首页衔接在 `index.html`。组员获得仓库协作权限后，创建分支并通过 Pull Request 提交；在本地验证简历诊断、笔试、面试与刷新保存后合并到 `main`，由原 Render 服务自动发布。
