# 职途星轨

大学生职业探索与求职准备应用。原生 JavaScript 前端 + Express 后端 + PostgreSQL，支持账号档案、测评报告、求职练习和多轮对话保存；AI 按 DeepSeek 的 JSON Chat Completions 接口接入。

## 本地启动

需要 Node.js ≥22.14、pnpm、Docker（或已有 PostgreSQL）。

```sh
pnpm install --frozen-lockfile
pnpm build
test -f .env || cp .env.example .env
# 编辑 .env：设置自己的 POSTGRES_PASSWORD，DATABASE_URL 中填写同一个密码。
docker compose up -d --wait
pnpm db:migrate
pnpm start
```

访问 `http://localhost:5000`。变更端口/访问域名时同步修改 `APP_ORIGIN`。已有 PostgreSQL 可直接设置 DATABASE_URL，不必启动 Docker。

首次使用点击左下角“账号与云端”注册。首次登录明确选择“上传本地”或“加载云端”后才开启自动同步；会替换目标资料，请先备份。退出账号会清除本机缓存；服务器端数据保留。删除账号会级联删除云端资料，需要当前密码确认。

## 功能与实现边界

- `/`：画像、问卷、经历、JD 匹配、历史报告与 PDF。
- `/job-search.html`：岗位搜索；登录后使用外部搜索服务。
- `/career-prep.html`：保留已有简历规则诊断、原创笔试与面试练习，并支持云端保存；练习反馈仍明确标记为本地规则模拟。
- 未登录：本地测评、关键词 JD 匹配、已有报告与求职练习可用。
- 登录且主动勾选发送同意：在线 AI 答疑、经历证据提取、手动 JD 逐项分析。
- AI 证据必须逐字出现在经历/JD 中；输出由 schema 校验，无法校验的结果报错，不伪造成功。
- 问卷与能力分值是规则参考，技能覆盖率不代表录用概率。在线 JD 匹配由模型列要求与证据、程序计算等权技能覆盖率；本地模式显示关键词覆盖率，两种方法明确区分。
- 公开知识库目前是三个经整理的指导条目，按关键词召回。没有向量数据库；没有足够资料时应提示范围。用户添加的本地知识笔记可随档案同步，但暂未进入服务端 AI 召回。

## DeepSeek 配置

在 `.env` 填写：

```dotenv
LLM_API_URL=https://api.deepseek.com/chat/completions
LLM_MODEL=deepseek-flash
LLM_API_KEY=你的DeepSeek密钥
```

模型名按当前账号支持情况调整。参考 [DeepSeek 接口文档](https://api-docs.deepseek.com/quick_start/agent_integrations/) 与 [JSON 输出说明](https://api-docs.deepseek.com/guides/json_mode/)。密钥只存服务端环境变量，不提交仓库。接口设30秒超时、输出结构及来源校验；每用户每分钟10次，默认每日50次、全站每日500次，可通过环境变量调整。失败和重试也计入日额度，避免无限消耗；这不是精确费用账单。

岗位搜索与JD正文读取已改用 DeepSeek Search / Fetch，默认复用 `LLM_API_KEY`，不需要 Coze。搜索与正文读取按请求单独计费，见 [DeepSeek Search & Fetch](https://api-docs.deepseek.com/guides/search/)。可设置 `DEEPSEEK_SEARCH_ENABLED=false` 关闭联网检索；可选 `DEEPSEEK_SEARCH_API_KEY` 使用另一枚 DeepSeek 密钥。无可用搜索凭证时明确显示不可用或引导检索，手动 JD 仍可使用。`DEEPSEEK_TOOLS_BASE_URL` 默认为 `https://api.deepseek.com`，只允许管理员在服务端配置，测试可指向本地模拟服务。

搜索服务的query上限128个Unicode字符，适配器保留岗位关键词并在长度范围内附加站点限制。结果是公开网页检索线索，不等于全部岗位或正在招聘的保证；正文读取受招聘网站访问策略影响，失败时请打开原文手动复制JD。

## 数据与架构

见 [架构与接口](docs/architecture.md)。PostgreSQL 保存用户、加盐密码摘要、哈希会话令牌、画像、测评、报告、练习、多轮消息与调用计数。JSONB 保存变化较多的结构化结果；消息按独立行存储、支持游标分页。

只开放 `public/` 目录。个人资料不会自动传给模型；主动提交的经历、JD 或问题会发送到配置的模型服务。会话内容保存在数据库。用户可下载本地/云端备份、删除会话和删除账号。

JSON 导入只恢复档案/报告/练习，不恢复账号凭证或云端会话；完整数据库灾备使用 PostgreSQL 备份。云端同步采用版本检测，冲突会停止自动同步，要求备份后选择资料来源。

## 验证

```sh
pnpm exec playwright install chromium
pnpm audit:prod
pnpm test:coverage
```

完整检查包括语法、ESLint、本地资源构建、单元、真实PostgreSQL集成/并发/迁移、覆盖率门槛与浏览器/PDF测试。单独快速运行 `pnpm test` 不需要数据库。详见 [自动化测试工作流](docs/testing.md)。

数据库相关套件使用独立的 `<原库名>_integration_test` 和 `<原库名>_e2e_test`；不再向开发库写浏览器测试账号。子进程移除真实模型密钥，供应商由本地测试服务替代；浏览器阻止外网，CSS/图表/PDF从本地构建产物读取。没有配置测试数据库会明确失败。

覆盖率统计后端及共享关键词匹配模块，不包括遗留前端主脚本；真实模型语义质量仍需单独评估。仅 `pnpm test:live` 和 `pnpm evaluate:ai` 显式调用真实付费模型。

## 部署与交付状态

[部署、备份与验收](docs/deployment.md)。已有 Render 地址为 `https://university-career-explorer.onrender.com`，本轮代码尚未部署到该地址，不代表线上已具备新功能。

首轮已实现数据库及前后端闭环；真实模型与搜索调用需要有效 DeepSeek 凭证；线上部署、完整模型质量评估、同学试用和答辩录屏尚待验收。当前不支持邮箱验证、找回密码或管理员后台，长期公开运营前需要补齐账号恢复与运维能力。
