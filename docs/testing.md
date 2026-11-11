# 自动化测试与工程门禁

## 一次执行完整检查

```sh
pnpm install --frozen-lockfile
# 首次运行：配置 .env 中的本地 DATABASE_URL / POSTGRES_PASSWORD
# 已有独立 PostgreSQL 则无需 Docker
open -a Docker                  # macOS，等待 Docker 启动；Linux 直接启动 daemon
docker compose up -d --wait
pnpm exec playwright install chromium
pnpm verify
pnpm audit:prod
# 带覆盖率门槛的完整检查：
pnpm test:coverage
```

CI使用同一 `pnpm test:coverage` 命令。首次安装浏览器需要下载，随后测试不依赖外部CDN、真实模型或互联网搜索。Linux可能需要 `pnpm exec playwright install --with-deps chromium` 安装系统依赖。

完整步骤：语法检查 → ESLint → 本地静态资源构建 → 单元测试 → PostgreSQL集成/约束/并发/迁移测试 → 覆盖率门槛（仅coverage命令）→ Playwright浏览器与PDF测试。任何阶段失败返回非零退出码，后续阶段不冒充已执行成功。

## 单独运行

| 命令 | 用途 |
|---|---|
| pnpm audit:prod | 查询漏洞库，生产依赖出现高危/严重漏洞时失败（需要网络） |
| pnpm check | JS和HTML内联脚本语法检查，包含遗留前端 |
| pnpm lint | 后端、测试与工具脚本的ESLint规则；遗留前端全局脚本尚未纳入ESLint |
| pnpm build | 将锁文件中的图表/PDF库复制到public/assets，编译Tailwind CSS |
| pnpm test | 隔离进程中的单元、搜索适配、测试安全与资源依赖检查，无数据库要求 |
| pnpm test:integration | 真PostgreSQL中的事务、鉴权、越权、并发、约束、迁移与故障测试 |
| pnpm test:e2e | 独立测试库、实际Express API、测试模型服务和浏览器 |
| pnpm test:coverage | 完整门禁与覆盖率报告 |
| pnpm test:live | 显式人工触发的真实模型小规模冒烟，可能计费 |
| pnpm evaluate:ai | 30个合成样例的真实模型评估，可能计费；语义正确性需人工复核 |

单独运行浏览器测试前需先 `pnpm build`。已安装Chrome的本地用户可设置 `PLAYWRIGHT_CHANNEL=chrome`；CI使用Playwright Chromium。

## 数据库与密钥隔离

默认从.env的DATABASE_URL取得连接设置，仅用于在同一PostgreSQL实例创建/连接独立测试数据库：
- `<原库名>_integration_test`
- `<原库名>_e2e_test`

不会将浏览器测试指向开发库。也可提供预先创建的TEST_DATABASE_URL，其名称必须以_test结尾，且不能与应用数据库同名（即使主机名使用localhost/127.0.0.1别名）。测试库不存在且账号无建库权限时明确失败；数据库依赖测试不再通过“跳过”伪装成功。

测试子进程仅继承运行所需的少量系统变量，移除真实模型密钥、搜索密钥和应用连接URL。测试服务从代码启动本地模拟供应商并注入虚拟密钥，接入实际后端、实际数据库。浏览器阻止访问外网；图表、PDF与CSS从本地构建产物加载。失败时也清理本次生成的账号，测试库保留以便复查，不自动删除用户数据库或Docker数据卷。

命名检查是防误操作措施，不是数据库权限沙箱；正式环境应为测试提供独立实例/账号，运行账号不应具备生产库权限。

## 覆盖内容

- 密码摘要、会话令牌、Cookie解析、同源拒绝、过期会话、用户资源隔离。
- 同版本并发写只接受一个；冲突不覆盖，数据库失败回滚版本和多表写入。
- JSONB对象约束、负版本、孤儿外键、邮箱唯一、报告ID与快照一致性、级联删除。
- 迁移幂等、已应用SQL文件摘要检查、新迁移失败时整体回滚。
- 对话重复请求幂等、分页、引用/证据校验失败回滚。
- 无效JSON、超大请求、无效AI请求不占用每日额度。
- 搜索站点过滤与Unicode长度、返回字段映射、正文读取、余额/认证/限流/超时。
- 页面加载、账号注册、显式同步、备份下载、云端恢复、AI经历/JD/问答真实前后端链路、移动端及PDF下载。

部分浏览器用例仍通过页面函数直接准备复杂测评状态；它们不能替代用户逐项点击完成问卷、长报告排版和可访问性人工验收。

## 覆盖率范围与门槛

c8合并单元与后端子进程的实际执行数据。范围为 `src/**/*.js`、`server.js` 和共享关键词匹配模块。行/语句≥85%，函数≥90%，分支≥65%。未把2550行遗留前端主脚本计入这一统计，也不把“模型输出结构合法”当作模型语义正确。

`coverage/lcov.info`、`coverage/coverage-summary.json`记录覆盖率；`artifacts/verification.json`记录各阶段状态与耗时。浏览器另输出JUnit、HTML报告、失败截图、trace与视频（本地指定Chrome通道时不录视频）。运行失败时报告保留真实失败，不会写为通过。

## GitHub工作流

- `.github/workflows/ci.yml`：push、pull_request或手动触发；Node22/PostgreSQL17完整门禁，Node24做静态/构建/单元兼容检查；只读仓库权限、取消同分支过时运行、超时、生产依赖高危审计、上传测试证据。
- `.github/workflows/ai-smoke.yml`：仅允许手动触发且明确勾选费用确认。使用仓库Secret `DEEPSEEK_API_KEY`，不进入普通PR工作流；不上传本地.env。

将GitHub分支保护配置为要求上述检查通过并经复核，才能形成远端合并门禁。当前仅写入工作流文件与本地验证，未擅自推送或修改GitHub仓库规则，不能声称GitHub Actions已经执行成功。
