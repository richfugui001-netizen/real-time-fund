# 个人定制版维护说明

这个目录是基于 `hzm0321/real-time-fund` 建立的个人维护分支。

## 分支约定

- `main`：跟随原作者项目。
- `personal`：个人定制功能分支，包含持仓大屏、复盘、AI 分析等功能。
- `upstream`：原作者仓库 `https://github.com/hzm0321/real-time-fund.git`。
- `origin`：预留给你自己的 fork 仓库。

## 首次绑定自己的 GitHub fork

先在 GitHub 上 fork 原项目，然后在本地执行：

```bash
git remote add origin https://github.com/你的用户名/real-time-fund.git
git push -u origin personal
```

如果你也想把 `main` 推到自己的 fork：

```bash
git checkout main
git push -u origin main
git checkout personal
```

## 同步原作者更新

如果访问 GitHub 需要代理，先执行：

```bash
export https_proxy=http://127.0.0.1:7897
export http_proxy=http://127.0.0.1:7897
export all_proxy=socks5://127.0.0.1:7897
```

然后更新原作者代码：

```bash
git fetch upstream
git checkout main
git merge upstream/main
```

把原作者更新合并进个人分支：

```bash
git checkout personal
git merge main
```

如果出现冲突，优先保护个人功能相关文件：

- `app/dashboard/`
- `app/review/`
- `app/lib/portfolioMetrics.js`
- `app/components/UserMenu.jsx`
- `app/hooks/useScanImport.js`
- `app/page.jsx`

冲突处理完成后：

```bash
npm install
npm run build
git add .
git commit
```

## 日常开发

所有个人功能都在 `personal` 分支继续改：

```bash
git checkout personal
npm install
npm run dev
```

改完后提交：

```bash
npm run build
git add .
git commit -m "feat: xxx"
git push
```

## 数据提醒

Git 只管理代码，不管理浏览器里的持仓数据。更新代码前，建议在页面里导出一次配置备份，避免 localStorage 或云端配置误操作导致持仓数据丢失。
