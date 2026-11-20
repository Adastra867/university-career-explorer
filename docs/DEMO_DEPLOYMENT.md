# 临时展示部署（demo-deploy）

本分支包含 DeepSeek 实时搜索、求职冲刺 AI 与前端交互修复，不修改远端 main。

## Render 参数

- GitHub：Adastra867/university-career-explorer
- 分支：demo-deploy；仓库根目录留空
- 类型：Node Web Service；Free；单实例
- Node：24（.node-version 和 NODE_VERSION 均固定）
- 构建：`corepack enable && corepack prepare pnpm@11.25.0 --activate && pnpm install --frozen-lockfile`
- 启动：`pnpm admin:init && pnpm start`（演示管理员凭据必须先配置）
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
| CAREER_DEMO_MODE | true |
| CAREER_DB_PATH | /tmp/career-demo/career.sqlite |
| CAREER_PUBLIC_URL | https://university-career-explorer-demo.onrender.com |
| CAREER_ADMIN_USERNAME | 所有者自行设置的管理员用户名 |
| CAREER_ADMIN_PASSWORD | 所有者在 Render 安全填写，至少12位 |
| CAREER_ADMIN_DISPLAY_NAME | 小组展示管理员 |

不上传本地 .env，不填 COZE_API_TOKEN，搜索复用有效的 DeepSeek 模型密钥。也可用 DEEPSEEK_SEARCH_API_KEY 单独设置搜索密钥；聊天和搜索均有调用费用。

## 展示范围及数据

本配置提供方向探索、测评/报告、职业规划 AI、职业树、实时岗位搜索与求职冲刺。浏览器保存的资料仍在当前浏览器，localhost 数据不会自动迁移到公网域名。

当前展示配置启用临时 SQLite，包含统一资料、四任务、管理员活动和学生提交。数据库位于 /tmp/career-demo/career.sqlite，免费服务休眠、重启、重新部署后可能丢失。只使用虚构演示材料；页面会明确显示临时存储提示。资料界面中的默认90天是应用清理上限，不是免费环境的保存保证。

管理员用户名及独立密码由所有者在 Render 填写，不提供公共默认账号。启动阶段先运行 pnpm admin:init，再运行网站；数据库丢失后会自动重建结构和该管理员。每次初始化会更新该管理员密码并撤销旧管理员会话，但不会主动删除活动/学生数据。不要在构建阶段初始化数据库。

若只想展示不涉及资料库的页面，可以恢复启动命令 pnpm start 并移除 CAREER_DB_PATH，此时保留原生产存储保护。正式使用需持久磁盘或迁移托管数据库，不应使用本临时配置。

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
