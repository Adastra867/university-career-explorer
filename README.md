# 职途星轨

**大学生职业规划 AI 与求职练习平台**

> 我还没定目标岗位，大学这几年可以先做什么？等我拿到一份招聘简章，又该怎样改简历、讲清自己的项目？

职途星轨把这两个问题放在同一条路线里。大一、大二可以先做一次小体验，再从自己的兴趣和经历出发选方向。进入实习或校招准备时，可以拿具体岗位要求核对经历，再围绕同一个岗位改简历、练笔试和面试。职业规划 AI 贯穿这四步，学生做过新项目或收到新反馈后，可以回来调整计划。

[打开职业规划 AI](https://university-career-explorer.onrender.com/index.html#intelligence) · [进入网站首页](https://university-career-explorer.onrender.com/)

## 从成长路线到面试帮助

### 1. 成长路线｜我还没定方向，这周能先做什么？

打开「制定成长路线」，输入一句「帮我制定未来三年的成长路线」就能开始。职业规划 AI 会结合已知信息和假设给出分阶段建议，并把第一步落到一个能尝试的行动上。例如，挑两个感兴趣的方向，各花半天做一次入门体验。之后可以补充经历、比较路线，或把结果存进「我的规划记录」。 [制定成长路线](https://university-career-explorer.onrender.com/index.html#intelligence)

### 2. 方向｜有几条路都感兴趣，我想先试哪条？

根据学历、专业和就业倾向查看方向卡，从中选 3–5 个备选，把最想验证的放在第一位。软实力测评用 25 项自评和 6 道情境题观察偏好与行动方式，情境题按规则生成能力雷达。硬实力解析从课程、科研、实习或项目原文中识别技能线索，方便学生回到材料核对自己具体做过什么。排序可以在实践后修改。 [方向探索](https://university-career-explorer.onrender.com/index.html#direction) · [能力画像](https://university-career-explorer.onrender.com/index.html#ability)

### 3. 岗位｜我该搜什么？这份招聘要求又能对上几项？

「推荐岗位」根据方向意向和能力线索给出可检索的岗位名称。看到感兴趣的招聘简章后，可以把岗位描述（JD）粘贴到「分析 JD」，逐项查看材料里的证据和缺口。覆盖率表示材料中体现的要求比例。若材料漏写了做过的事，就补上项目证据。需要学习的部分可以放进后续计划。实时岗位检索依赖服务端搜索配置。 [推荐岗位](https://university-career-explorer.onrender.com/index.html#jobs) · [分析 JD](https://university-career-explorer.onrender.com/index.html#jobs/manual)

### 4. 面试帮助｜面试官问「你具体做了什么」，我怎么答？

「求职冲刺」围绕选定的岗位提供简历诊断、三道笔试练习和四轮模拟面试。比如第一次只说「我参与了校园报名数据项目」，系统会追问本人采取了什么行动、最后交付了什么。再次回答时，就能具体说出怎样用 Python 和 SQL 清洗数据、用 Excel 制图，以及怎样交付报告。问题、追问和反馈由浏览器本地规则生成，练习记录可下载。讲不清的地方可以带回职业规划 AI，变成下一次练习目标，例如「下周怎样练习用一分钟解释这张图？」 [求职冲刺](https://university-career-explorer.onrender.com/career-prep.html)

## 其他入口

- [职业树](https://university-career-explorer.onrender.com/trees)支持在画布上整理职业节点、比较路线和继续探索。
- [岗位搜索](https://university-career-explorer.onrender.com/job-search.html)支持按关键词查找岗位及查看匹配依据。
- [统一资料](https://university-career-explorer.onrender.com/start)支持学生注册、登录、保存任务草稿和恢复账号资料，可按需授权职业规划 AI 参考个人资料。活动组织者通过 `/admin` 管理活动和学生主动提交的资料。

## 本地运行

项目使用 Express 和原生 HTML、CSS、JavaScript。运行需要 Node.js 24+ 与 pnpm。数据库使用 Node 内置 SQLite，默认保存到 `data/career.sqlite`。服务启动时自动执行 `p0/migrations/` 下的数据库迁移。

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

Windows 资料服务器的启动、状态检查及登录自启命令见 [本机服务器说明](docs/LOCAL_SERVER.md)。部署后运行 `node scripts/verify-local-storage.mjs`，用合成账号核验公网保存、跨会话恢复和本机 SQLite 落盘；验收结束会删除测试账号。

职业规划 AI 使用服务端 `JOURNEY_AI_*` 配置，支持 `.env` 中的 `JOURNEY_AI_API_KEY` 和 `JOURNEY_AI_MODEL`，DeepSeek 配置示例见 [Journey 环境变量](journey/.env.example)。在问答中保存或补充个人资料后，新对话会复用最新内容，也可在问答设置中关闭。首次使用其他页面的已有资料时，点击“参考已保存的个人资料”即可启用。个人资料保存在当前浏览器，连接统一资料后修改也会保存到服务器。历史记录和文件内容由用户勾选，联网搜索单独使用公开搜索词。

## 开发协作

首页和岗位页加载已编译的 `styles/tailwind.css`。修改 Tailwind 类或主题后，运行 `pnpm build:styles` 并提交生成的 CSS。职业规划对话的浏览器回归测试使用受控模型服务和合成资料。

组员通过分支和 Pull Request 合并代码到 `main`。合并后在 Render 核对对应提交的部署状态，必要时手动部署最新提交。
