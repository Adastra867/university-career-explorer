# 职途星轨

面向大学生的职业发展规划与求职练习网站。

## 页面入口

- `/`：职业方向探索、能力测评、JD 匹配与综合报告。
- `/job-search.html`：岗位搜索与匹配。
- `/career-prep.html`：求职冲刺，包含简历诊断、行业岗位笔试和模拟面试。

## 本地运行

安装 Node.js 和 pnpm 后，在项目根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm start
```

打开 `http://127.0.0.1:5000/career-prep.html`。可通过环境变量 `PORT` 修改端口。

求职冲刺无需 API 密钥。简历诊断、题目和面试反馈使用本地规则；当前未连接在线大模型。输入内容保存在当前浏览器，各人的练习记录互相独立。

## 协作修改

- 页面结构与样式：`career-prep.html`。
- 简历规则、笔试题库、面试问题和反馈：`scripts/career-prep.js`。
- 首页入口和测评资料衔接：`index.html`。

组员获得仓库协作权限后，可创建分支并通过 Pull Request 提交修改。修改后先在本地检查简历诊断、笔试、面试及刷新保存，再合并到 `main`。

## 部署

`render.yaml` 使用 `pnpm install --frozen-lockfile` 安装依赖，并以 `pnpm start` 启动服务。已有服务：`https://university-career-explorer.onrender.com`。

在 Render 确认服务连接本仓库的 `main` 分支，并将 Auto-Deploy 设为 On Commit。合并后检查部署状态；如未自动更新，执行 Manual Deploy → Deploy latest commit。

发布完成后，求职冲刺入口为 `https://university-career-explorer.onrender.com/career-prep.html`。
