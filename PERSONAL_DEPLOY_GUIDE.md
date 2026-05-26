# 个人版同步与部署手册

这份文档用于记录当前个人版项目如何同步原项目更新，以及如何重新部署到 Cloudflare Pages。

当前项目是基于原仓库 `hzm0321/real-time-fund` 做的个人增强版。建议长期保留自己的功能在 `personal` 分支，不要直接在 `main` 上改，这样后续同步原项目更新会更清晰。

## 当前项目状态

- 本地目录：`/Users/zhoufugui/项目/real-time-fund-personal`
- 当前个人分支：`personal`
- 自己的 GitHub 仓库：`https://github.com/richfugui001-netizen/real-time-fund.git`
- 原项目仓库：`https://github.com/hzm0321/real-time-fund.git`
- Cloudflare Pages 项目名：`real-time-fund`
- 线上地址：`https://real-time-fund-3d2.pages.dev`
- Supabase 项目：`real-time-fund`
- Supabase Site URL：`https://real-time-fund-3d2.pages.dev`

远程仓库关系：

```bash
origin    https://github.com/richfugui001-netizen/real-time-fund.git
upstream  https://github.com/hzm0321/real-time-fund.git
```

含义：

- `origin` 是你自己的仓库，用来保存个人修改。
- `upstream` 是原作者仓库，用来拉取原项目更新。

## 日常更新线上项目

如果只是你自己改了代码，想把最新版本发布到线上，按这个流程：

```bash
cd /Users/zhoufugui/项目/real-time-fund-personal

npm run build
npx wrangler pages deploy out --project-name real-time-fund --branch personal --commit-dirty=true
```

部署成功后，Cloudflare 会输出一个本次部署地址，例如：

```text
https://xxxx.real-time-fund-3d2.pages.dev
```

生产地址保持不变：

```text
https://real-time-fund-3d2.pages.dev
```

通常你直接访问生产地址即可。

## 保存自己的代码到 GitHub

改完代码后，建议先确认有哪些文件变更：

```bash
git status
```

查看具体差异：

```bash
git diff
```

确认没问题后提交：

```bash
git add .
git commit -m "更新个人版功能"
git push origin personal
```

如果有不想提交的本地配置文件，例如 `.env.local`，不要加入 Git。它应该保留在本地。

## 同步原项目更新

同步原项目之前，先确保自己的工作区是干净的：

```bash
git status
```

如果看到 `nothing to commit, working tree clean`，说明可以继续。

如果有未提交修改，先提交自己的修改：

```bash
git add .
git commit -m "保存个人版修改"
```

然后拉取原项目最新代码：

```bash
git fetch upstream
```

确认自己在 `personal` 分支：

```bash
git checkout personal
```

把原项目更新合并进来：

```bash
git merge upstream/main
```

如果原项目默认分支不是 `main`，可以先查看：

```bash
git branch -r
```

然后按实际分支合并，例如：

```bash
git merge upstream/master
```

## 处理合并冲突

如果合并时出现冲突，Git 会提示哪些文件冲突。

查看冲突文件：

```bash
git status
```

冲突文件里通常会出现这种标记：

```text
<<<<<<< HEAD
你的个人版代码
=======
原项目更新代码
>>>>>>> upstream/main
```

处理原则：

- 个人新增的大屏、复盘、AI、Supabase 登录等功能，通常要保留。
- 原项目修复 bug、更新依赖、优化接口的内容，尽量合并进来。
- 不确定时不要盲目删代码，先对比上下文。

解决完冲突后：

```bash
git add .
git commit
```

如果合并自动生成了提交信息，直接保存即可。

## 同步后验证

合并原项目更新后，先本地构建：

```bash
npm run build
```

如果构建失败，先不要部署。需要先根据错误修复代码。

构建成功后，可以本地启动看看：

```bash
npm run dev -- --hostname 127.0.0.1 --port 3001
```

浏览器访问：

```text
http://127.0.0.1:3001
```

重点检查：

- 首页能否正常打开
- 登录弹窗能否正常显示
- 自选和分组是否正常
- 持仓金额、持有收益、今日预估收益是否正常
- 大屏页面是否正常
- 复盘/持仓体检是否正常
- AI 分析是否正常

检查没问题后再部署线上：

```bash
npx wrangler pages deploy out --project-name real-time-fund --branch personal --commit-dirty=true
```

最后推送到自己的 GitHub：

```bash
git push origin personal
```

## 推荐完整流程

这是比较稳的完整流程：

```bash
cd /Users/zhoufugui/项目/real-time-fund-personal

git status
git fetch upstream
git checkout personal
git merge upstream/main

npm run build
npx wrangler pages deploy out --project-name real-time-fund --branch personal --commit-dirty=true

git push origin personal
```

如果中途出现冲突或构建失败，先停下来处理，不要继续部署。

## Cloudflare Pages 说明

当前项目是 Next.js 静态导出模式。

关键配置：

- 构建命令：`npm run build`
- 输出目录：`out`
- Pages 项目名：`real-time-fund`
- 生产分支：`personal`

项目的 `next.config.js` 中启用了：

```js
output: 'export'
```

所以 `npm run build` 后会生成 `out` 目录。Cloudflare Pages 部署的就是这个目录。

## Supabase 说明

线上登录依赖 Supabase。

当前 Supabase 的 Site URL 已配置为：

```text
https://real-time-fund-3d2.pages.dev
```

Redirect URLs 也需要包含：

```text
https://real-time-fund-3d2.pages.dev
```

如果以后换了自定义域名，例如：

```text
https://fund.example.com
```

需要同步修改 Supabase：

- Authentication -> URL Configuration -> Site URL
- Authentication -> URL Configuration -> Redirect URLs

否则邮件登录链接可能跳转不正确。

## 环境变量

本地开发使用 `.env.local`。

当前需要的关键环境变量：

```bash
NEXT_PUBLIC_SUPABASE_URL=你的 Supabase URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=你的 Supabase anon key
NEXT_PUBLIC_IS_GITHUB_LOGIN=false
```

注意：

- `.env.local` 不要提交到 GitHub。
- 如果以后改为 Cloudflare GitHub 自动构建，需要在 Cloudflare Pages 项目设置里配置这些环境变量。
- 当前是本地构建后用 Wrangler 上传 `out`，所以本地 `.env.local` 会在构建时生效。

## Wrangler 登录

如果部署时提示未登录：

```bash
npx wrangler login
```

它会打开浏览器，让你授权 Cloudflare。

授权成功后再部署：

```bash
npx wrangler pages deploy out --project-name real-time-fund --branch personal --commit-dirty=true
```

## 常见问题

### 1. 部署后线上还是旧页面

先确认本地重新构建过：

```bash
npm run build
```

再重新部署：

```bash
npx wrangler pages deploy out --project-name real-time-fund --branch personal --commit-dirty=true
```

然后强制刷新浏览器页面。

### 2. 登录邮件链接跳转不对

检查 Supabase 的 URL Configuration：

- Site URL 是否是线上地址
- Redirect URLs 是否包含线上地址

当前应为：

```text
https://real-time-fund-3d2.pages.dev
```

### 3. 同步原项目后页面异常

优先检查这些位置：

- `app/page.jsx`
- `app/dashboard`
- `app/review`
- `app/components`
- `app/lib`
- Supabase 相关逻辑

个人版新增功能比较多，同步原项目时最容易在首页状态管理、基金数据结构、持仓计算逻辑附近冲突。

### 4. 构建失败

先看终端最后的错误位置。常见原因：

- 依赖版本变化
- 原项目改了数据结构
- 合并冲突没处理干净
- 环境变量缺失
- Sentry 或 Next 配置变化

修复后重新执行：

```bash
npm run build
```

## 建议

每次同步原项目前，先提交自己的当前修改。这样即使合并出问题，也比较容易回退和排查。

如果原项目更新很多，不建议直接一口气合并并部署。更稳的方式是先看更新内容：

```bash
git fetch upstream
git log --oneline personal..upstream/main
git diff personal..upstream/main --stat
```

确认大概改了哪些文件后，再决定是否合并。

