# 云上阅读

一个部署到 Cloudflare 的轻量读书网站原型，目标是做出接近微信读书的沉浸式阅读体验，但首版只保留最核心能力：

- 发现页
- 书籍详情页
- 桌面优先阅读器
- 只保存在本地浏览器的书架与阅读进度
- 运营侧隐藏上传页 `/admin/upload`
- 支持本地即时导入与 Cloudflare 自动发布上传两种模式

## 当前约束

- 不做用户登录鉴权
- 书架与阅读进度等状态都只保存在本地浏览器
- 上传功能仅供运营方手动使用
- 首批内容只支持已排版好的 EPUB
- Cloudflare 免费方案优先
- Cloudflare 线上模式仍然是静态产物发布，不是动态书库读取

## 技术栈

- Astro
- React（用于阅读器与上传表单交互）
- Cloudflare adapter
- Cloudflare Workers / Assets
- Cloudflare D1
- GitHub Releases（保存原始 EPUB）
- GitHub Actions（自动处理与发布）

## 本地运行

本地导入模式：

```bash
npm install
npm run dev:local
```

这个命令会同时启动：

- Astro 开发站点（`PUBLIC_RUNTIME_MODE=local-import`）
- 本地导入服务 `/home/kaixin/work-ai/reader/scripts/local-import-server.mjs`

如果 `127.0.0.1:4327` 上已经有本地导入服务在运行，脚本会直接复用它，不会再重复启动。

打开：

- 首页：[http://127.0.0.1:4321/](http://127.0.0.1:4321/)
- 本地书架：[http://127.0.0.1:4321/shelf](http://127.0.0.1:4321/shelf)
- 上传页：[http://127.0.0.1:4321/admin/upload](http://127.0.0.1:4321/admin/upload)

注意：开发端口如果被占用，Astro 会自动顺延；此时请以终端实际输出端口为准。

## Cloudflare 发布

```bash
npm run deploy:cloudflare
```

这个命令会：

- 以 `PUBLIC_RUNTIME_MODE=pages-static` 构建
- 使用 `/home/kaixin/work-ai/reader/dist/server/wrangler.json` 执行 `wrangler deploy`

因此发布到 Cloudflare 前，不需要再手改 `/home/kaixin/work-ai/reader/src/lib/runtime-mode.ts`。

## Cloudflare 上传处理

线上 `/admin/upload` 在 Pages 模式下会先把 EPUB 上传到 GitHub Releases，并在 D1 中写入待发布任务；上传成功后会自动尝试触发 GitHub Actions 工作流处理并发布。

默认自动处理 workflow 位于：

- `/home/kaixin/work-ai/reader/.github/workflows/process-upload.yml`

它会：

- 从 D1 读取待发布任务
- 从 GitHub Releases 下载原始 EPUB
- 调用 `/home/kaixin/work-ai/reader/scripts/epub-preprocess/import_epub.py` 生成静态产物
- 自动执行 `npm run deploy:cloudflare`

如果自动触发失败，也可以在 GitHub Actions 页面手动执行 `Process uploaded EPUB` workflow 补跑。

## D1 初始化

先创建数据库，并把得到的 `database_id` 写回 `/home/kaixin/work-ai/reader/wrangler.toml`：

```bash
npx wrangler d1 create reader-db
```

然后执行 migration：

```bash
npx wrangler d1 execute reader-db --remote --file /home/kaixin/work-ai/reader/migrations/0001_create_upload_jobs.sql
```

## Cloudflare 与 GitHub 配置

`/home/kaixin/work-ai/reader/wrangler.toml` 里需要配置：

- `GITHUB_REPO_OWNER`
- `GITHUB_REPO_NAME`
- `GITHUB_RELEASE_TAG`
- `GITHUB_RELEASE_NAME`

Cloudflare 侧的 GitHub token 不要写进 `wrangler.toml`，应作为 secret 配置：

```bash
npx wrangler secret put GITHUB_TOKEN --config /home/kaixin/work-ai/reader/dist/server/wrangler.json
```

GitHub Actions 侧需要在仓库 Secrets 中配置：

- `UPLOAD_GITHUB_TOKEN`：用于下载 GitHub Releases 资产
- `CLOUDFLARE_API_TOKEN`：用于 Actions 内执行 wrangler deploy
- `CLOUDFLARE_ACCOUNT_ID`：如你的 wrangler/token 组合需要显式账户 ID，则一并配置

## 上传导入方案

上传 API 位于：

- `/home/kaixin/work-ai/reader/src/pages/api/upload.ts`

它当前会：

- 校验上传文件是否为 `.epub`
- 限制文件大小为 50MB
- 把原始 EPUB 上传到 GitHub Releases
- 在 D1 中写入待发布任务
- 自动触发 GitHub Actions workflow
- 返回“已入队自动处理”的结果，而不是“已发布完成”

注意：

- 当前生产方案不是“上传即上线”，而是“上传入队 → GitHub Actions 处理 → Cloudflare 发布 → 线上可见”
- `/admin/upload` 的职责是“接收上传并进入发布队列”，不是长期后台 CMS
- 如需即时导入并立刻本地可见，请继续使用 `npm run dev:local`

## GitHub Actions 手动补跑

如果某次上传后自动触发失败，可以在仓库里手动运行 workflow，或本地补跑：

```bash
export GITHUB_TOKEN=your_github_token
export CLOUDFLARE_API_TOKEN=your_cloudflare_api_token
npm run process:cloudflare-upload
```

如果本地处理脚本使用的 D1 数据库名不是 `reader-db`，还要额外设置：

```bash
export CLOUDFLARE_D1_DATABASE_NAME=your_database_name
```

## 已完成页面

- `/` 发现页
- `/book/[id]` 书籍详情页
- `/read/[id]` 阅读器
- `/shelf` 本地书架
- `/admin/upload` 运营上传页

## 本地状态

阅读器会把以下信息写入浏览器本地：

- 最近阅读书籍
- 当前章节和进度
- 阅读主题
- 字号
- 行高
- 版心宽度
- 收藏标记（当前在本地书架中维护）

## 目录说明

- `/home/kaixin/work-ai/reader/src/lib/books.ts`：书籍数据入口
- `/home/kaixin/work-ai/reader/src/layouts/BaseLayout.astro`：全局布局
- `/home/kaixin/work-ai/reader/src/components/reader/ReaderClient.tsx`：阅读器交互逻辑
- `/home/kaixin/work-ai/reader/src/components/reader/LocalShelfClient.tsx`：本地书架逻辑
- `/home/kaixin/work-ai/reader/src/components/admin/EpubUploadForm.tsx`：上传表单
- `/home/kaixin/work-ai/reader/src/pages/api/upload.ts`：Cloudflare 上传接口
- `/home/kaixin/work-ai/reader/scripts/process-cloudflare-upload.mjs`：待发布任务处理脚本
- `/home/kaixin/work-ai/reader/scripts/epub-preprocess/import_epub.py`：EPUB 预处理脚本
- `/home/kaixin/work-ai/reader/.github/workflows/process-upload.yml`：GitHub Actions 自动处理工作流
- `/home/kaixin/work-ai/reader/migrations/0001_create_upload_jobs.sql`：D1 初始化表结构

## 后续建议

优先级最高：

1. 在 GitHub 仓库中配置 `GITHUB_TOKEN_UPLOAD`、`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` Secrets
2. 用真实 EPUB 跑通“上传入队 → GitHub Actions 自动处理 → 首页可见”闭环
3. 为 `/admin/upload` 增加真正的后台保护
4. 给 workflow 增加失败通知和重试机制
5. 若后续账号能力允许，再评估是否把原始文件存储迁回 Cloudflare 对象存储
