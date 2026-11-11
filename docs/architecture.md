# 架构与接口

## 数据流

浏览器页面 → 同源 Express API → PostgreSQL；AI 服务调用 DeepSeek 兼容端点；岗位搜索与JD正文读取分别调用DeepSeek Search与Fetch。前端未开启同步前的数据留在浏览器；开启同步后存入账号。AI 只处理用户主动提交的内容，最多选取最近12条、总计12000字符的会话上下文，不会把全部历史无限发送。

- public/index.html、app.css、js/main.js：原有方向探索流程，已提取大段样式和主脚本，保持页面原有行为。
- public/js/account.js：账号、同步、备份、会话管理与 AI 交互。
- public/js/matching.js：共享确定性关键词覆盖率。
- server.js：启动、端口与优雅退出；src/app.js：Express装配、静态目录和统一错误处理，导入应用不再自动监听端口。
- src/api.js：账号/对话/AI路由与中间件；src/routes/jobs.js：招聘检索路由（该领域仍有待继续抽取业务服务）。
- src/services/workspace.js → src/repositories/workspace.js：档案业务事务与用户作用域SQL访问分离。
- src/db.js、migrations/：连接池与带事务、迁移记录及锁的数据库迁移。
- src/search.js：DeepSeek搜索/正文读取适配，站点限制、查询长度与上游错误处理。
- src/ai.js、schemas.js：知识召回、模型适配、结构化输出和原文证据校验。
- knowledge/career.json：有来源的公开职业指导条目。来源入口与整理要点不等于实时招聘信息。

## 表结构

| 表 | 关系与内容 |
|---|---|
| users | UUID、唯一邮箱、scrypt 加盐密码摘要 |
| sessions | 哈希令牌、用户外键、7天有效期 |
| user_state | 每个用户的版本号、求职练习 JSONB、更新时间 |
| profiles | 每个用户的画像 JSONB |
| assessments | 每个用户的当前测评/经历/分析 JSONB，不含会话历史 |
| reports | 用户ID + 报告ID 复合主键，JSONB 历史报告 |
| conversations | 用户ID、标题、时间 |
| messages | 会话ID、角色、正文、JSONB 模型/引用元数据、请求ID和时间；全局自增ID确定顺序 |
| ai_daily_usage | 用户ID + 日期，AI请求额度统计 |
| ai_service_usage | 不随账号删除而重置的全站每日调用总额 |
| schema_migrations | 已应用的迁移文件名、执行时间与SHA256摘要 |

JSONB对象类型、报告ID与快照结构、非负版本、消息/标题长度有数据库CHECK约束；会话过期列有清理索引。约束迁移遇到无效历史数据会失败，不自动改写或删除。所有业务表的用户数据级联删除。消息级联随会话删除。所有读取与修改都在服务器按当前登录用户限定；数据库使用参数化查询。会话和消息ID来自客户端时也校验格式与所有权。

## API

错误结构统一为 `{code,error}`。JSON请求上限1MB；邮箱密码、AI文本和导入档案分别校验。401未登录；403来源不符；404资源不存在；409版本或登录账号冲突；429额度/限流；502模型输出无效；503数据库/模型/检索未配置或不可用。

| 方法与路径 | 输入/结果 |
|---|---|
| GET /api/health | 数据库连接状态、AI/检索是否配置（不暴露密钥） |
| POST /api/auth/register | email、password；创建用户并设置会话cookie |
| POST /api/auth/login | email、password；设置会话cookie |
| GET /api/auth/me | 当前用户ID和邮箱 |
| POST /api/auth/logout | 撤销当前会话 |
| DELETE /api/auth/account | password；删除账号及其云端资料 |
| GET /api/workspace | version、appData、history、prep |
| PUT /api/workspace | 同上；版本不一致返回409；画像、测评、报告、练习在同一事务写入 |
| GET /api/export | 当前账号资料与全部对话，JSON备份 |
| GET/POST /api/conversations | 列出最多100个近期会话 / 用title创建会话 |
| GET /api/conversations/:id/messages | before可选；每页最多50条，返回nextBefore |
| POST /api/conversations/:id/messages | content、requestId(UUID)、consent:true；返回用户/助手消息对 |
| DELETE /api/conversations/:id | 删除自己会话及消息 |
| POST /api/extract | text、consent:true；技能与原文、STAR、待补充问题 |
| POST /api/match | jd、text、consent:true；逐项原文证据与程序计算覆盖率 |
| GET /api/knowledge | 公开知识条目 |
| POST /api/search-jobs | query、location、count；DeepSeek网页搜索，需登录 |
| POST /api/recommend-jobs | directions、location、count；DeepSeek个性化方向检索，需登录 |
| POST /api/fetch-jd | url；通过DeepSeek Fetch尝试读取实际正文，需登录 |

## 一致性与安全

会话Cookie采用HttpOnly、SameSite=Strict，生产环境Secure。修改请求校验Origin；反向代理需正确设置APP_ORIGIN与TRUST_PROXY。密码不返回客户端，会话令牌在数据库只存哈希。前端同时提交当前用户ID，跨标签页切换账号时拒绝把旧档案保存到新账号。

对话调用锁定所属会话行，在事务中读取最近上下文、调用模型并插入消息对；失败整体回滚。相同requestId重复调用不会插入重复消息，但仍计入请求额度。同一会话并发发送顺序被串行化；目前单体服务适合小组演示和小规模试用，大规模时需改为队列与独立生成状态。

AI经历/JD证据检查只能保证引文存在，不能证明模型的语义判断正确；引用ID检查也不等于回答被来源充分支持，需要真实质量评估。缺乏信息显示不足，不以关键词覆盖率作为心理测量或录用预测。

云端导出在同一REPEATABLE READ只读事务中批量读取档案、会话与消息，避免不同时间点拼接及N+1查询；正式灾备仍需数据库备份。档案同步按版本原子提交，历史报告只更新变化行，不再全量删除再插入。公开知识规模有限，自定义知识尚未参与AI检索。首轮未引入NoSQL或向量库。


迁移使用事务、互斥锁和摘要校验。旧迁移历史没有摘要的记录只建立一次当前基线，不能据此证明过去从未被改动；后续改动已应用文件会被拒绝，必须新增迁移。测试与当前业务日志均不记录密钥。

当前仍属于模块化不足的单体：前端有全局状态及运行时函数覆盖，后端部分路由仍直接访问SQL；长模型调用仍在数据库事务内。它们是下一轮需要处理的工程债务，不能因已有目录层级就视为完整分层。
