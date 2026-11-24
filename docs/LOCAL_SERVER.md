# 本机资料服务器

公网网页继续使用 `https://university-career-explorer.onrender.com`。账号、统一资料、任务草稿和提交记录通过受认证的 HTTPS 隧道保存到这台 Windows 电脑的 `data/career-public.sqlite`。职业树及部分历史记录仍属于浏览器本地存储；此配置不会自动将它们迁入数据库。

本机配置放在 Git 忽略的 `.env.career-data`，保持 `CAREER_DATA_MODE=origin`、`JOURNEY_LOAD_ENV=false`、`NODE_ENV=production`，并设置本机端口、数据库路径、网站地址和网关密钥。不要覆盖已有数据库或把 `.env.career-data` 上传到仓库。配置示例及 Render 连接参数见 [部署说明](DEPLOYMENT.md#将账号资料保存在管理员电脑)。

在项目目录运行以下命令。脚本使用绝对路径启动 Node，服务只监听 `127.0.0.1`，无需打开应用的入站防火墙端口。

```powershell
# 启动；重复运行会检查已有服务，不重复创建进程。
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\career-data.ps1 -Action Start
# 查看进程、本地健康检查、日志目录和登录自启状态。
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\career-data.ps1 -Action Status
# 为当前 Windows 用户安装隐藏的登录自启入口。
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\career-data.ps1 -Action InstallStartup
```

登录自启入口位于当前用户的 Startup 文件夹，名为 `CareerDataServer.vbs`。它在该用户登录 Windows 后启动资料服务，不等同于登录前运行的系统服务，也不会在进程崩溃后自动重启。移动项目目录后，应从旧目录移除入口，再在新目录重新安装。启动日志位于项目 `logs/career-data-*.out.log` 与 `logs/career-data-*.err.log`；日志不会进入 Git。

停止和撤销自启分别执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\career-data.ps1 -Action Stop
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\career-data.ps1 -Action RemoveStartup
```

脚本只管理带有本项目绝对配置路径和入口路径的 Node 进程。若端口被其他进程占用，会报告 PID 并停止操作，不会强行结束其他程序。旧的手动命令使用相对路径启动时，先在原终端结束该服务，再交给脚本启动。

## 公网隧道

本机服务与隧道分别管理。先确认本地 `Status` 的 `Ready=True`，再查看现有隧道，避免改动其他应用正在使用的端口：

```powershell
tailscale funnel status
# 仅当 8443 未用于其他应用时，将这个入口连接到资料服务。
tailscale funnel --bg --https=8443 http://127.0.0.1:5100
tailscale funnel status
```

首次启用可能需要账号持有人完成 Tailscale 给出的授权页面。`--bg` 把隧道设置留给 Tailscale 后台服务；本脚本不会重置或关闭其他隧道。Render 的 `CAREER_DATA_UPSTREAM` 使用命令实际返回的 HTTPS 地址（包含 `:8443`），`CAREER_DATA_GATEWAY_KEY` 与本机配置一致，`CAREER_TRUST_PROXY=true`，且不设置 Render 的 `CAREER_DB_PATH`。修改后需要部署并验证公网注册、登录、保存和换设备恢复。

电脑关闭、休眠或网络中断时，公网网页仍可访问，但需要本机数据库的账号和保存功能暂不可用。保持电脑及 Tailscale 在线；恢复后运行 `Status` 检查，必要时重新 `Start`。备份时先停止资料服务，再复制整个 `data` 目录（包括存在的 SQLite WAL 文件）到受保护的本地备份目录，完成后重新启动。

## 验证公网数据确实落在本机

运行 `node scripts/verify-local-storage.mjs`。脚本读取 `.env.career-data` 中的数据库路径，用两个随机合成账号验证保存、另一会话登录恢复、账号隔离及本机 SQLite 记录，并在结束时删除测试账号。可用 `--origin https://你的隧道地址:8443` 额外检查隧道拒绝未认证资料请求。测试不会调用 AI，也不会输出密码或 Cookie。

使用本机网络代理时，Node 24 可使用 `--use-env-proxy` 并仅在当前终端设置 `HTTPS_PROXY`；不要把代理凭据或网关密钥提交到仓库。网页可访问不代表资料链路成功，应以该验收脚本和实际注册、登录结果为准。
