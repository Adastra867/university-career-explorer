# 临时展示部署（demo-deploy）

本分支包含 DeepSeek 实时搜索、求职冲刺 AI 与前端交互修复，不修改远端 main。

## Render 参数

- GitHub：Adastra867/university-career-explorer
- 分支：demo-deploy；仓库根目录留空
- 类型：Node Web Service；Free；单实例
- Node：24（.node-version 和 NODE_VERSION 均固定）
- 构建：`corepack enable && corepack prepare pnpm@11.25.0 --activate && pnpm install --frozen-lockfile`
- 启动：`pnpm start`
- 健康检查：`/`
- 自动部署：关闭；确认提交 SHA 后手动部署

render.yaml 描述的是展示服务；手动创建时需在控制台填写相同设置，YAML 不会自动同步已有服务。已有服务应先核对所属仓库和负责人，勿误覆盖别的项目。

## 环境变量

| Key | Value |
|---|---|
| NODE_VERSION | 24 |
| NODE_ENV | production |
| JOURNEY_LOAD_ENV | false |
| CAREER_TRUST_PROXY | true |
| JOURNEY_AI_PROVIDER | deepseek |
| JOURNEY_AI_BASE_URL | https://api.deepseek.com |
| JOURNEY_AI_MODEL | deepseek-flash |
| JOURNEY_AI_API_KEY | 由所有者在 Render 安全填写有效密钥 |
| DEEPSEEK_SEARCH_ENABLED | true |

不上传本地 .env，不填 COZE_API_TOKEN，搜索复用有效的 DeepSeek 模型密钥。也可用 DEEPSEEK_SEARCH_API_KEY 单独设置搜索密钥；聊天和搜索均有调用费用。

## 展示范围及数据

本配置提供方向探索、测评/报告、职业规划 AI、职业树、实时岗位搜索与求职冲刺。浏览器保存的资料仍在当前浏览器，localhost 数据不会自动迁移到公网域名。

默认不设置 CAREER_DB_PATH：生产模式暂停学生任务资料库与管理员 API（503 STORAGE_NOT_CONFIGURED），防止将真实资料写入免费实例临时磁盘。这不影响上述核心展示模块。

若明确需要演示学生提交与管理员活动，另行设置 CAREER_DB_PATH=/tmp/career-demo/career.sqlite、CAREER_PUBLIC_URL=实际HTTPS地址，以及独立演示管理员凭据；启动时先执行 pnpm admin:init。每次初始化会撤销该管理员旧会话。免费实例休眠、重启和重新部署可能丢失数据库，必须仅使用虚构数据。不要把临时配置当作正式资料收集方案。

## 发布前后检查

1. `pnpm install --frozen-lockfile`、`pnpm check`、`pnpm test`。
2. 检查提交不含密钥、数据文件或测试产物；检查 Render 分支和提交 SHA。
3. 部署达到 Live 后访问首页、职业树、岗位搜索、职业规划 AI 和求职冲刺。
4. 用虚构材料测试真实 AI 和搜索；确认搜索失败有提示，AI设置可以关闭，简历缺项原地报错。
5. 手机宽度检查布局与按钮；刷新确认本机历史恢复。
6. Free 闲置会休眠，展示前提前访问并走一遍关键流程；先用平台 onrender.com 地址即可。

浏览器回归命令见 README 的“前端交互回归”。自动化测试使用假模型，不等于实际云端连通验收。

## 回滚

展示分支后续修改先检查并测试；Render 手动选择已验证的提交部署。保留 main 和 xzx，不强推。必要时在 Render 回滚上一可用版本，再检查密钥、页面和搜索；回滚不会恢复临时数据库。
