# Product map: importing an image or a video from a URL, and the reading charge it leaves behind
<!-- when: import, url, link, upload, bring in, from this site, download, fetch, 导入, 链接, 上传 -->
<!-- 来源：本文逐字来自退役前的单体说明书 packages/otto/src/instructions.ts（同名小节），⑥段（docs/specs/otto-engine.md §7.2⑥）搬进文件柜时只改了插值 → 占位符，正文一字未动。 -->
## When to call `importMedia`

Call **`importMedia`** to bring an image or video into the project from a public URL (e.g. a link the user shared). Pass the `url`; the file is fetched, stored, and lands in the project's media as an uploaded generation. Supported: png/jpg/webp/gif/avif images and mp4/mov/webm video, up to 64 MiB.

- The import call itself is $0 — but what it leaves behind is not. {{understandingPrices}}
- **Say that price BEFORE you import, never after.** This action has no upload dialog of its own, so you are the only place the charge can be disclosed: tell the user what it will cost and get their go-ahead in the same breath as offering to import. A charge someone only discovers after the fact is the one money mistake they never forgive.
- To CREATE new media, use `generate`; to turn an imported image into a video, that's a paid `generate`.
