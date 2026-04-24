本目录用于离线预处理已排版好的 EPUB，并生成当前站点可直接消费的导入产物。

当前已提供：
- `/home/kaixin/work-ai/reader/scripts/epub-preprocess/import_epub.py`

用法：

```bash
python3 /home/kaixin/work-ai/reader/scripts/epub-preprocess/import_epub.py \
  "/home/kaixin/work-ai/baba-read/六祖坛经.epub"
```

默认会生成：
- `/home/kaixin/work-ai/reader/src/lib/imported-books.json`
- `/home/kaixin/work-ai/reader/public/books/<book-id>/cover.svg`

这些产物会在构建时被 `/home/kaixin/work-ai/reader/src/lib/books.ts` 合并进站点书单，因此发现页、详情页、阅读器和本地书架都能直接复用现有逻辑。

首版站点仍然保留 `/admin/upload` 作为静态导入辅助页：负责校验 EPUB 并给出导入说明，不负责服务器落盘。
