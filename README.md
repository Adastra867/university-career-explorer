# 职途星轨

职途星轨面向大学生，提供职业方向探索、能力画像、岗位匹配和求职练习。职业规划 AI 支持按对话整理信息、比较选择和制定计划。项目使用 Express 和原生 HTML、CSS、JavaScript。

## 页面与功能

| 入口 | 功能 |
| --- | --- |
| `/` | 方向探索、软硬实力分析、岗位推荐、手动 JD 匹配、报告与测评历史。 |
| `/index.html#intelligence` | 职业规划 AI。支持多轮对话、搜索或管理会话、资料导入、个人画像、方向探索、阶段计划、路线比较和成长建议。可将分析保存到“我的规划记录”。 |
| `/job-search.html` | 按关键词搜索岗位，查看岗位详情和匹配依据。实时岗位检索依赖服务端搜索配置。 |
| `/career-prep.html` | 简历诊断、行业和岗位笔试、模拟面试及练习记录下载。练习由浏览器本地规则生成。 |
| `/trees` | 创建和编辑职业树，在画布中组织节点、查看路线和比较选择。 |
| `/start`、`/admin` | 学生注册与登录、按账号恢复统一资料、轻量职业建议、任务草稿、活动提交与管理。公网账号可将资料保存到管理员电脑。 |

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

免费 Render 服务的文件系统是临时的。启用公网账号及统一资料同步时，可把 SQLite 数据库留在管理员电脑，由 Render 经认证的 HTTPS 隧道访问。未连接资料服务时，方向探索、匹配、求职练习和职业树等功能仍可使用。 [部署说明](docs/DEPLOYMENT.md)

职业规划 AI 使用服务端 `JOURNEY_AI_*` 配置，支持 `.env` 中的 `JOURNEY_AI_API_KEY` 和 `JOURNEY_AI_MODEL`，DeepSeek 配置示例见 [Journey 环境变量](journey/.env.example)。在问答中保存或补充个人资料后，新对话会复用最新内容，也可在问答设置中关闭。首次使用其他页面的已有资料时，点击“参考已保存的个人资料”即可启用。个人资料保存在当前浏览器，连接统一资料后修改也会保存到服务器。历史记录和文件内容由用户勾选，联网搜索单独使用公开搜索词。

## 开发协作

首页和岗位页加载已编译的 `styles/tailwind.css`。修改 Tailwind 类或主题后，运行 `pnpm build:styles` 并提交生成的 CSS。职业规划对话的浏览器回归测试使用受控模型服务和合成资料。

组员通过分支和 Pull Request 合并代码到 `main`。合并后在 Render 核对对应提交的部署状态，必要时手动部署最新提交。
