# 职途星轨 P0 交付与运行

## 范围与结构

沿用 Express 5、静态 HTML/JavaScript 和现有服务端模型传输；没有迁移框架。既有仓库中已有的 Journey 工作区继续保留，本批不扩展职业树、长期计划或投递系统。

| 内容 | 实现 |
|---|---|
| 四任务与学生闭环 | `/start`，`p0/public/start.*` |
| 管理员登录、活动、二维码、记录 | `/admin`，`p0/public/admin.*` |
| 访客、统一画像、草稿、提交、撤回、删除 | `p0/api.js` |
| SQLite 与迁移 | `p0/store.js`、`p0/migrations/001_initial.sql`、`002_turn_snapshot.sql` |
| 保守资料提取、模型输出Schema、规则降级 | `p0/analysis.js` |
| 旧页面统一资料桥接 | `p0/public/profile-adapter.js` |
| 新旧搜索、JD与报告公共评分 | `scripts/job-scoring.js` |
| 管理员初始化 | `pnpm admin:init` |
| 期限清理 | 启动时、运行中每15分钟、`pnpm data:cleanup` |

画像扁平路径包含 education.stage/degree/major/school、experience.text、skills.self_report、preferences.long_term_goal/city，值为自述字符串或 null。来源与确认状态分别保存；经历和技能保留原话，不把弱技能升级或将实验扩写为成果。任务的 JD、比较选项和时间条件独立保存。

追问由服务端维护 question_id、asked_fields、skipped_fields 与最多2次预算。跳过或直接建议结束追问；重试沿用请求标识。输入/相关公共字段实质变化递增 input_revision，只有确认同值不使分析过期，但会使包含旧确认元数据的共享预览失效。

## 本地运行

使用 Node.js 24+。先执行 `pnpm install --frozen-lockfile`。首次可复制 `.env.example` 到 `.env`；已有 `.env` 时手动补充配置，避免覆盖原值。

最小配置：

```dotenv
PORT=5000
CAREER_DB_PATH=./data/career.sqlite
CAREER_PUBLIC_URL=http://localhost:5000
CAREER_RETENTION_DAYS=90
CAREER_ADMIN_USERNAME=<本人设置的管理员账号>
CAREER_ADMIN_PASSWORD=<至少12位的独立密码>
CAREER_ADMIN_DISPLAY_NAME=<提交预览展示的组织者名称>
```

执行 `pnpm admin:init`，然后 `pnpm start`。没有预置账号和通用密码。初始化后可移除环境中的密码；密码以带随机盐的 scrypt 哈希保存。管理员会话与访客会话独立，退出立即失效。账号密码变更可再次执行初始化命令，会撤销此账号的全部旧会话。

管理员创建活动，复制链接或本服务生成的二维码。链接不含学生资料或访问凭证。普通访问不绑定默认活动，仍可生成建议和保存私人草稿。

## 在线 AI 与招聘

可沿用已有 JOURNEY_AI_PROVIDER、JOURNEY_AI_BASE_URL、JOURNEY_AI_API_KEY、JOURNEY_AI_MODEL。也可用非空 CAREER_AI_* 覆盖。DeepSeek 密钥支持 DEEPSEEK_API_KEY。密钥只在服务端读取；发送模型前剔除常见联系方式和证件号。输入、简历、JD中的命令作为资料处理。

`node scripts/verify-career-ai.mjs` 使用虚构示例请求真实配置的模型，在 `artifacts/p0/ai-verification.json` 记录模式、版本、错误类型与字段名；不输出密钥或学生原文。只有 `mode=online_ai` 才算正常模型实测通过。

模型结构或证据无效最多一次修复，共享同一超时预算；失败后保留输入并明确进入规则建议。保存、刷新、查看历史与管理员阅读不会调用模型。

岗位搜索继续使用现有 Coze 搜索配置（COZE_API_TOKEN），未配置或不可用时显示明确的检索方案。检索方案不代表企业在招；真实搜索结果保留来源、原链接和已有日期。评分版本 `career-material-jd-v1` 计算材料与JD文字要求的对应程度，学历门槛独立说明；没有有效证据或分母时为 null / not_evaluated，不代表录用概率。

## 生产部署

本项目现有 `render.yaml` 使用 free 实例且没有持久磁盘，不能直接作为本批云数据的正式存储。生产部署前必须准备持久卷，或另行实现并迁移到持久数据库；不能把默认临时文件系统当作云存储。

生产环境或 Render 未设置 CAREER_DB_PATH 时，原站继续提供页面与既有能力，P0 资料接口返回 `503 STORAGE_NOT_CONFIGURED`；不会创建临时数据库或接受学生记录。

本实现支持单实例 Node.js 24 + SQLite WAL，部署要求：

1. 给服务挂载实际持久磁盘，例如 `/var/data`，并设置 `CAREER_DB_PATH=/var/data/career.sqlite`。
2. 设置 `NODE_ENV=production`、`CAREER_PUBLIC_URL=https://实际域名`；使用受控反向代理时设置 `CAREER_TRUST_PROXY=true`。
3. 配置管理员初始化与模型秘密，运行 `pnpm admin:init`；构建 `pnpm install --frozen-lockfile`，启动 `pnpm start`。
4. 只运行一个应用实例；SQLite 文件不跨多实例共享。升级前停写并用 SQLite 的在线备份工具/卷快照备份，保留迁移版本，不单独拷贝正在写入的主文件。
5. 使用 HTTPS。生产 Cookie 包含 HttpOnly、Secure、SameSite=Lax；写接口检查来源和会话CSRF，登录与模型请求限流。
6. 外部使用两个独立浏览器和一个管理员会话复测完整流程；重启服务确认数据仍在持久卷。

本批没有创建付费云资源、替换线上数据或执行生产发布。配置磁盘可能涉及资源费用，由项目所有者在部署环境中选择。生产管理员密码、数据库文件和模型密钥不能提交仓库。

## 共享、撤回、删除与期限

草稿只有拥有对应访客 Cookie 的本人可读写。管理员业务接口只返回其活动中已提交且仍可见的内容，不读取私人草稿。

共享预览由服务端生成，绑定字段值、来源、确认状态、材料片段、结果、接收活动与共享范围。首次提交核验完整载荷；任何共享元数据变化需要重新预览。提交快照不随个人资料修改而改变。以“所有者+幂等键”唯一约束防重复；成功请求重试先返回原回执，即使活动关闭、预览过期或草稿变化，也不会再次创建提交。

学生主动重新提交会形成关联版本。撤回作用于本次共享链所有历史版本，正文从提交存储中清空，管理员列表不回退旧版，旧详情不再返回正文。撤回后新提交属于新授权，不恢复旧历史。

“删除本人云端资料”清理访客、画像、任务、预览、提交和幂等记录，令会话失效；前端清理可能导致重传的本地缓存。已发送的晚到分析和保存无法重新创建被删除的记录。SQLite 开启 secure_delete 并进行 WAL checkpoint；服务不记录完整学生输入和秘密。

默认保存期限为访客首次创建日起90天，可用 CAREER_RETENTION_DAYS 修改。启动及每15分钟清理一次过期资料，并提供一次性清理命令。会话默认30天过期，过期并不等于数据已删除；清除Cookie后无法自助恢复身份，剩余数据仍按保存期限清理。运维自行配置的卷备份也应落实同一删除与到期策略，不通过备份恢复已撤回正文。

旧资料只扫描 careerPredictor/careerPredictorPrep 白名单字段，在浏览器展示预览，用户主动导入才上传。旧评分、推断、密钥与管理状态不导入；冲突保留云端值并提示，重复导入不会重复追加经历；原本地业务数据保留。

## 验证记录

2026-11-04 本机最终验证：`pnpm check` 通过，`pnpm test` **278 / 278 通过**。包含原有Journey回归、37项P0分析/权限/一致性/评分/实际重启测试，以及2项生产存储缺失保护测试。仓库使用串行测试避免 Windows 上同时启动大量子进程导致启动探测超时；并行运行曾出现一次部署测试启动超时，按实际串行命令复测全部通过。

实际浏览器验证 **33项通过，0 pageerror**：新增P0闭环11项、统一画像与旧页面联动6项、原功能回归16项。覆盖管理员创建活动与本地二维码、访客A提交/B只留草稿、预览范围、快照不变、撤回/删除、TXT来源、网络保存失败恢复、回答响应丢失后刷新并显式重放原请求。390px / 1440px 页面没有主要横向溢出。浏览器用例使用独立测试上下文，不接触用户真实Chrome资料。

结果：`artifacts/p0/automated-tests.log`、`artifacts/p0/browser-1793797266868/results.json`、`artifacts/p0/legacy-profile-browser.json`、`artifacts/journey/legacy-results.json`。P0浏览器结果同目录含三张页面截图。临时数据库、浏览器输出和日志均被Git忽略；可通过仓库测试命令重新生成。

直接API测试使用真实临时SQLite文件和实际HTTP请求，覆盖访客A/B与两个管理员、CSRF/Origin、未提交草稿隔离、完整预览元数据绑定、不可变快照、关闭活动后幂等回执、同键异内容冲突、共享链撤回、删除、异步旧结果与保存期限。实际停止并重新启动服务验证提交快照及会话仍在；12条私有源码/数据库/产物路径均返回404。中断后的回答重试不会重复追加或增加预算，显式清空的字段也不会被旧输入重新提取恢复。

真实模型验证当前未通过：现有 `.env` 有 DeepSeek 地址与模型名，但 JOURNEY_AI_API_KEY / DEEPSEEK_API_KEY 为空。线上正常模型、线上招聘数据源和生产外部访问不能据此声称已验收。受控本地HTTP fixture 的正常模型、限流、超时和无效JSON修复/降级已单独测试。

本次文件导入闭环实测使用TXT；PDF沿用既有本地解析模块，尚未在本批单独用实际PDF复测。手机检查使用浏览器视口，真机系统软键盘尚未单独测试。生产问卷收集需配置真实持久磁盘、管理员凭据与HTTPS地址后再次外部验收。
