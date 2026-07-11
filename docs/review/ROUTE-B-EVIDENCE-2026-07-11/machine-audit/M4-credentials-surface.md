# M4 · 凭据暴露面 — 补缺口报告(2026-07-11)

只读盘点。消费 `docs/ops/CREDENTIAL-INVENTORY-2026-07-11.md`(D5 pre-rotation 主台账,
origin/main 上有,本 worktree 未 checkout 到——已用 `git show origin/main:...` 读取全文)。
本报告**只补该文档"Evidence gaps"节列出的 5 个具体缺口**,不重复其主表。全部动作均只读:
未 rm / kill / rotate / chmod / 修改任何文件(仅写本报告)。

来源文档定位:`git log --all --oneline -- docs/ops/` → commit `5d0b2203`(docs(ops): 状态账
2026-07-11 晚间批次 —— ... 凭据台账)引入,已并入 `main`(经 `52949e6c` 之后的历史)。

---

## 缺口 ① `~/.cloudflare/token` 当前权限与存在性

| 项 | 结果 |
|---|---|
| 存在 | 是,`/Users/winnin/.cloudflare/token`,52 字节,`Jul 10 19:07` 修改 |
| 权限 | `-rw-------@`(0600)—— **符合预期**,非组/其他可读 |
| 风险级 | 【禁删/不动】—— 权限本身健康;风险点是台账已记录的"内容已在 transcript 中暴露",权限本身不是问题 |
| 建议 | 无需改权限。是否轮换该 Global API Key 仍是台账里"待 founder 批"的事项,本报告不重复推进 |

---

## 缺口 ② 全盘散落 `.env*` 文件(排除 node_modules)

命令:`find ~/Desktop/FIKIRTIVE /private/tmp/claude-501 -name ".env*" -not -path "*/node_modules/*"`

**含真实键名的文件(非 `.example`)：**

| 路径 | 权限 | 含键类别(仅名称,未印值) |
|---|---|---|
| `/Users/winnin/Desktop/FIKIRTIVE/.env.local` | `-rw-r--r--@`(644) | ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, DATABASE_URL, GENERATION_PROVIDER, COWORK_PROVIDER, FOUNDER_ADMIN_EMAILS, AUTH_URL, NEXTAUTH_URL |
| `/Users/winnin/Desktop/FIKIRTIVE/apps/web/.env.local` | `-rw-r--r--@`(644) | AUTH_SECRET, AUTH_ALLOWED_EMAILS, DATABASE_URL, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, BETTER_AUTH_SECRET, META_APP_ID/SECRET, TOKEN_ENCRYPTION_KEY, BYTEPLUS_API_KEY, TAVILY_API_KEY, BRAVE_SEARCH_API_KEY, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY |
| `/Users/winnin/Desktop/FIKIRTIVE/packages/db/.env` | `-rw-r--r--@`(644) | DATABASE_URL |

均已被各自 `.gitignore` 覆盖(`.gitignore:9 .env*.local`、`apps/web/.gitignore:34 .env*`、
`packages/db/.gitignore:3 .env`)—— **未 tracked-in-git,确认**。

风险级:【要 founder 批】—— 三个文件都是 644(user-group-other 可读,非 600)。单用户
Mac 上风险有限,但与台账"file-only"结论一致的同时,权限比 `~/.cloudflare/token` 的 600 松。
建议:若 founder 决定收紧,可 `chmod 600` 这三个文件(本报告不代为执行)。

**`.env.example` 模板副本(占多数,无真实密钥,仅占位符名称,正常):**

在以下位置各发现一份 `.env.example`(主仓库 + 多个 worktree + scratchpad 副本,共 13 处),
均为模板文件,不含实值,风险可忽略,不逐一列出路径(可用上面同一条 find 命令复现)。
其中主仓库 `/Users/winnin/Desktop/FIKIRTIVE/.env.example` 是 tracked-in-git 的正常模板。

---

## 缺口 ③ `.data/last-magic-link.txt` 类残留

命令:`find ~/Desktop/FIKIRTIVE /private/tmp/claude-501 -iname "*magic-link*"` → **零命中**,
未发现该类残留文件。

发现两个 `.data/` 目录(均已被 `.gitignore:18 .data/` 覆盖,非 tracked):
- `/Users/winnin/Desktop/FIKIRTIVE/.data/storage/`(空文件夹结构,无文件)
- `/Users/winnin/Desktop/FIKIRTIVE/.claude/worktrees/serene-swartz-e3fc34/.data/`(空)

风险级:【安全删】(若要清)—— 两者都是空目录,无内容可暴露,可放心清理或保留均可。

---

## 缺口 ④ `~/.gbrain/config.json`、`~/.codex`、`~/.claude` 下明文 key 文件

**`~/.gbrain/config.json`**:权限 `-rw-------@`(0600,正常)。字段扫描(仅字段名/类型,
含 key/secret/token/password 字样的字段值本应打码,但扫描结果显示**该文件本身不含任何
key 类字段** —— 只有 `engine`/`database_path`/`embedding_model`(值为 `openai:...` 模型名,
非密钥)/`schema_pack` 等配置项。密钥本身按项目文档存放于 `~/.zshenv`(未在本次范围内展开印值)。
风险级:【禁删】—— 无异常。

**`~/.codex/`**(maxdepth 2,匹配 key/token/secret/auth/*.json):
| 文件 | 权限 | 说明 |
|---|---|---|
| `auth.json` | `-rw-------@`(0600) | 命名暗示含凭据,权限正确收紧 |
| `version.json` / `models_cache.json` / `chrome-native-hosts.json` / `chrome-native-hosts-v2.json` / `.codex-global-state.json` / `vendor_imports/skills-curated-cache.json` / `process_manager/chat_processes.json` / `computer-use/config.json` | `-rw-r--r--@`(644) | 均为非凭据类缓存/配置文件(未打开内容验证,依文件名判断) |

风险级:`auth.json` 【禁删】(权限已是 0600,健康);其余 644 文件均为缓存类,不含 key 字样,
风险可忽略,Unknown 未逐一开箱确认内容。

**`~/.claude/`**(maxdepth 2,匹配 key/token/secret/credential):
| 文件 | 权限 | 说明 |
|---|---|---|
| `mcp-needs-auth-cache.json` | 未单独核实(非本次重点) | 名称暗示 MCP 授权缓存 |
| `settings.json` | 未单独核实 | 含 `env` 块,扫描仅见 `VERCEL_TOKEN`(**仅变量名,值未见于此文件**——与主台账"name only"结论一致) |
| `.mcp.json` | **`-rw-r--r--@`(644)** | **新发现(主台账未覆盖)**:`servers.fal-ai.headers.Authorization` 字段是**字面量**(非 `${ENV_VAR}` 占位符),长度 73 字符,判定为真实的 fal.ai Authorization header 值,**明文落盘且权限 644(任何本机用户可读)** |
| `settings.local.json` | 未单独核实 | 扫描未见 key/secret/token/password/auth 字样字段 |

風險級(`.mcp.json` 的 fal-ai Authorization):**【要 founder 批】—— 视为新的 red flag**,
详见下方 Red Flags。

---

## 缺口 ⑤ shell 历史 token 泄漏迹象(仅计数,未印内容)

| 历史文件 | 权限 | `sk-` | `AKIA` | `sk_live/sk_test/whsec_` | `export *KEY=` | `Authorization:` | `*TOKEN=` |
|---|---|---|---|---|---|---|---|
| `~/.zsh_history`(26KB,Jul 11 更新) | 0600 | 0 | 0 | 0 | 0 | 0 | 0 |
| `~/.bash_history`(7.7KB,2025-01-27,陈旧) | 0600 | 0 | 0 | 0 | 0 | 0 | 0 |

风险级:【禁删】(历史文件本身)—— 未发现明文 token/key 泄漏模式,两个历史文件权限均为 0600。
`.bash_history` 陈旧(2025年,可能不再活跃使用 bash),不构成风险。

---

## Red Flags(新增,主台账未覆盖)

1. **`~/.claude/.mcp.json` 权限 644 且含明文 fal-ai Authorization header 字面量**(长度 73,
   非环境变量占位符)。主台账只记录了"Magic MCP key 活在 claude CLI argv 里"和"FAL_KEY 在
   .env.example 里(file-only)",**没有记录这个独立的、持久落盘、权限过松的 fal-ai key 副本**。
   这是本次盘点发现的、台账缺口之外的新增真实暴露面。
   建议(【要 founder 批】,未执行):a) 确认该 header 是否仍是活跃/有效 key;
   b) 若是,建议改为环境变量引用而非字面量落盘;c) 至少 `chmod 600 ~/.claude/.mcp.json`;
   d) 是否需要跟随 Cloudflare/Magic MCP 一起纳入本轮轮换范围,由 founder 决定。

2. 主仓库根目录 `.env.local`、`apps/web/.env.local`、`packages/db/.env` 均为 644(而非 600)。
   单用户机器风险有限,但与 `~/.cloudflare/token`(600)、`~/.gbrain/config.json`(600)、
   `~/.codex/auth.json`(600)的收紧标准不一致。

---

## Unknowns

- `~/.codex/` 下 644 的各 `*.json`(`models_cache.json` 等)未开箱确认内容是否意外夹带凭据 —— 仅按文件名判断为缓存类。
- `~/.claude/mcp-needs-auth-cache.json`、`settings.local.json`、`.last-update-result.json`、
  `launch.json`、`stats-cache.json` 未逐一开箱扫描字段(时间预算内未展开,按文件名判断低风险)。
- `~/.claude/.mcp.json` 里 fal-ai 那个 73 字符字面量是否为**当前仍生效**的 key,还是历史/已废弃
  值 —— 本次只读盘点无法判断有效性(不做 provider 侧验证)。

---

## 结论摘要

主台账(`docs/ops/CREDENTIAL-INVENTORY-2026-07-11.md`)结构完整,本次 5 个指定缺口均已补齐:
`~/.cloudflare/token` 权限健康(0600);散落 `.env*` 已定位(3 个真实文件均 644、已 gitignore);
无 magic-link 残留;`~/.gbrain`/`~/.codex`/`~/.claude` 明文 key 扫描完成,**发现 1 个主台账未覆盖
的新红旗**(`~/.claude/.mcp.json` 里明文 fal-ai Authorization,644 权限);shell 历史未见泄漏模式。
全部建议维持"【要 founder 批】"级,本 worker 未做任何写入/轮换/删除动作。
