# 职途星轨：GitHub → Render 更新部署

## 固定部署链路

| 项目 | 配置 |
| --- | --- |
| GitHub | https://github.com/Adastra867/university-career-explorer |
| Remote | `origin` = `https://github.com/Adastra867/university-career-explorer.git` |
| 部署分支 | `main` |
| Render 工作区 | My Workspace (`tea-daoemq8ae00c73c7n0ng`) |
| 原服务 | university-career-explorer (`srv-daoenmjtqb8s73f1tctg`) |
| 控制台 | https://dashboard.render.com/web/srv-daoenmjtqb8s73f1tctg |
| 原公网地址 | https://university-career-explorer.onrender.com |
| 类型 / 地区 | Node Web Service / Oregon，现有 free 实例 |
| Root Directory | 留空，使用仓库根目录 |
| Build / Start | `pnpm install --frozen-lockfile` / `pnpm start` |
| 健康检查 | `/` |
| 自动部署 | On Commit，监听 `main`；2026-11-04 已通过 Render API 核实启用 |

保留这个服务和公网地址。日常更新不用重新创建仓库、Blueprint、服务或数据库。`render.yaml` 已记录构建、启动和自动部署设置；线上配置仍须以原服务控制台为准，提交 YAML 不代表现有服务一定自动同步配置。

## 本地开发

需要 Node.js 24 或更新的兼容版本（P0 使用 `node:sqlite`）、pnpm、Git 和 PowerShell。首次运行：

```powershell
pnpm install --frozen-lockfile
# 仅首次且没有 .env 时复制；已有配置不要覆盖。
if (!(Test-Path .env)) { Copy-Item .env.example .env }
pnpm start
```

打开 `http://localhost:5000/`；岗位 `/job-search.html`，求职练习 `/career-prep.html`，职业树 `/trees`，问卷 `/start`，后台 `/admin`。本地默认数据库为 `data/career.sqlite`。`.env`、数据库、导出、日志和 `artifacts/` 都不进入 Git。

本地问卷管理员由本人配置独立账号、至少 12 位密码，再执行 `pnpm admin:init` 初始化；初始化后移除环境中的密码。不要在仓库里放默认账号或实际学生记录。

## 后续一条命令更新

在项目根目录、`main` 分支修改并保存代码后运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy.ps1
```

可指定提交说明：

```powershell
.\scripts\deploy.ps1 -Message "feat: improve career exploration"
# 只检查，不提交、不推送：
.\scripts\deploy.ps1 -CheckOnly
```

脚本检查仓库、分支、冲突、敏感文件和远程更新，安装锁定依赖，运行语法和现有单元/API测试，然后提交修改并正常 Push；没有修改不会创建空提交。已有未推送提交也会同步。Push 后由 Render 自动构建，不要同时重复点 Manual Deploy。脚本成功仅代表 GitHub 已同步；还需在控制台确认最新 SHA 为 `live`，并验证公网。

脚本拒绝落后或分叉的分支，也不会自动覆盖远程更新。此时先保存本地工作，用 `git fetch origin` 查看 `git log --oneline --left-right HEAD...origin/main`，无本地改动时可 `git merge --ff-only origin/main`；有改动时先审查并提交，在合并远程后解决冲突、重跑检查。不得使用 `git push --force`。

敏感扫描是发布前辅助检查，不能代替人工审查。GitHub 登录由 Git Credential Manager 提供；不要把 Token 写进 Remote、脚本或命令输出。

## 发布后验证

1. `git rev-parse HEAD` 与 `git ls-remote origin refs/heads/main` 应一致。
2. 原 Render 服务的最新部署应为相同 SHA，状态必须是 `live`；读取对应构建与运行日志。
3. 打开原公网首页、岗位页、求职练习和职业树，检查资源/控制台错误；在手机尺寸下操作。
4. 复测方向选择、能力画像、JD 匹配、结果保存及刷新恢复。在线 AI 和岗位检索必须有真实服务端凭据才可验收在线结果；规则降级或检索方案不代表在线服务通过。
5. 问卷仅在持久存储已经配置时验收多人填写、访客隔离、提交快照、管理员权限、撤回和删除，并在服务重启后确认记录还在。

可重复使用的现有检查：`pnpm check`、`pnpm test`、`pnpm test:p0:browser`。浏览器脚本需要 Playwright 与 Chromium；`tests/browser-runtime.mjs` 支持 `PLAYWRIGHT_MODULE_PATH` / `BROWSER_EXECUTABLE_PATH`。测试产物留在已忽略的 `artifacts/`，不提交。部分旧脚本依赖本地历史基准文件，不能把缺少基准误报为功能故障。

## 当前存储限制与环境变量

该项目已经是 Express + HTML/JavaScript 的统一 Web Service，具备问卷 API、SQLite、访客会话、管理员活动权限和数据清理；不是纯静态网站。职业树与部分旧测评资料保存在浏览器本地，换设备不会自动同步。

**原免费服务没有持久磁盘。Render 的默认文件系统在重新部署时不保留数据，不能用作正式问卷记录库。** 本次不创建数据库、磁盘或付费实例。生产环境缺少 `CAREER_DB_PATH` 时，站点继续启动，但问卷 API 返回明确的 503 `STORAGE_NOT_CONFIGURED`，暂停云端资料收集。`/start` 与 `/admin` 保留页面并显示错误；旧页面的本地功能继续可用。不要设置临时目录来绕过这个保护。

| 环境变量 | 用途与配置 |
| --- | --- |
| `NODE_ENV` | Render Node 环境使用 `production` |
| `PORT` | 使用 Render 自动注入的端口，不硬编码公网端口 |
| `CAREER_DB_PATH` | 仅在真正持久存储准备好后设置，如挂盘后的 `/var/data/career.sqlite` |
| `CAREER_PUBLIC_URL` | 开启问卷时设置为 `https://university-career-explorer.onrender.com`，用于来源校验与活动链接 |
| `CAREER_TRUST_PROXY` | Render 受控反向代理后设为 `true`，用于正确获取协议/IP |
| `CAREER_RETENTION_DAYS` / `CAREER_SESSION_DAYS` | 可选；默认资料 90 天、会话 30 天；备份需另行落实期限 |
| `CAREER_ADMIN_USERNAME` / `CAREER_ADMIN_PASSWORD` / `CAREER_ADMIN_DISPLAY_NAME` | 只用于在实际运行数据库上执行 `pnpm admin:init`；账号和密码仅通过服务端安全环境配置，初始化后移除密码 |
| `CAREER_AI_*` | 可选问卷模型配置；复用 `JOURNEY_AI_*` / `DEEPSEEK_*` 作为后备 |
| `JOURNEY_AI_PROVIDER` / `JOURNEY_AI_BASE_URL` / `JOURNEY_AI_API_KEY` / `JOURNEY_AI_MODEL` | 职业树在线 AI；也支持 `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` |
| `JOURNEY_AI_ADMIN_TOKEN` | 可选模型配置自检授权，空值默认拒绝管理接口 |
| `JOURNEY_AI_PROPOSAL_SECRET` | 可选，跨重启保留建议签名能力；无需用于本地树保存 |
| `COZE_WORKLOAD_IDENTITY_API_KEY` | 可选，现有 Coze 招聘搜索 SDK 服务端凭据；不可放进浏览器 |

空白示例见根 `.env.example` 和 `journey/.env.example`。本地 `.env` 不上传；生产秘密在原 Render 服务的 Environment 中管理。启动日志、截图和文档不得包含秘密值或学生原文。

## 多人问卷的最小升级

现有 API 已有同意告知、访客 A/B 隔离、管理员密码 scrypt 哈希、HttpOnly/Secure/SameSite Cookie、CSRF/Origin、活动权限、不可变提交、撤回/删除和到期清理。公开收集前仍需完成真实持久存储、管理员初始化、备份期限与外部验收。

- 改动最小的路线：另行授权后，给**原服务**挂持久磁盘并设置 `CAREER_DB_PATH`，保留单实例 SQLite；不在构建阶段初始化磁盘数据。磁盘和所需计算方案可能收费，本次未启用。
- Render PostgreSQL / Supabase 路线：保留前端和 `/api` 契约，替换 `p0/store.js` 的 SQLite 存储为异步 PostgreSQL 适配，迁移表、唯一约束和事务，再用 `DATABASE_URL` 连接。当前代码尚未实现此适配，仅设置连接串不会生效。服务角色凭据只放后端；如另行采用浏览器直连，必须补齐 RLS 与身份规则。

## 失败排查与回滚

- Git Push 失败：检查 GitHub 登录及仓库写权限；如果远程领先，先合并处理，禁止强推。
- Push 后没有自动部署：确认原服务仍连接本仓库 `main`、Auto-Deploy 为 On Commit，检查 GitHub 与 Render 的连接授权和 Build Filters。先看部署历史，避免重复触发；确定没有自动部署时再 Manual Deploy → Deploy latest commit。
- Build 失败：读取最早失败处；确认 Node 24+、`pnpm install --frozen-lockfile` 和锁文件一致。不要未经检查更新依赖来掩盖构建错误。
- 启动失败：读取 runtime 日志，检查 Node 的 `node:sqlite`、环境变量、`pnpm start` 以及监听 `0.0.0.0:$PORT`。原健康检查 `/` 应返回 200。
- 问卷 503：说明持久存储尚未启用，按上节准备存储，不应改用 `/tmp`。管理员未初始化时登录不可用。
- AI / 招聘降级：检查服务端密钥、模型名、额度、超时和上游状态；不要输出真实密钥。可用现有验证脚本进行虚构数据实测。

应用回滚优先在干净 `main` 上用 `git revert <问题提交>`（若为合并提交，确认主线后使用 `git revert -m 1 <SHA>`），再运行部署脚本。这样保留审计历史并继续自动发布。也可在原 Render Deploys 页面选择上一可用部署执行 Rollback；操作后重新核实自动部署设置与公网功能。Render 回滚不恢复数据库、卷或用户数据，数据库迁移须单独核对兼容性，切勿删除库或覆盖学生记录。

Render 当前规则参考：[自动部署与临时文件系统](https://render.com/docs/deploys)、[健康检查](https://render.com/docs/health-checks)、[回滚](https://render.com/docs/rollbacks)。
