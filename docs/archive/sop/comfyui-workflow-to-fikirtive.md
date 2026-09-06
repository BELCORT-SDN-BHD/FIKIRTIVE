# SOP v1.1：ComfyUI 工作流 → Fikirtive 模板 / Modal 端点

> **读者：AI agent（Codex / Claude Code 等）。** 创始人只负责设计工作流；本 SOP 之后的一切由 agent 执行。每步有验证条件——任何一步验证失败，停下报告，不许静默继续、不许瞎猜。
>
> v1.1（2026-06-10 /plan-devex-review 冷读审计后重写，修复 17 项）：新增环境前置块、分阶段标注、文件版注册表；agent-TTHW 目标 ≤30 分钟。
> 依据：设计文档 `~/.gstack/projects/fikirtive/winnin-master-design-20260610-024210.md`（"技术栈定案"表第 7/9/10 行）。

## 阶段适用性（先看这个）

| 部分 | 何时可执行 | 说明 |
|------|-----------|------|
| Part A（组包 + 注册） | **今天即可** | Fikirtive 应用未上线前，注册 = 写入文件版注册表（见 A3.5） |
| Part B（Modal 部署） | **阶段二解锁** | 解锁条件：环境前置块全部就绪 + Fikirtive 回调端点（或 mock 收口）可用 |

## 环境前置（一次性 setup 仪式——首次执行 Part B 前做一次，之后永不再问创始人）

Agent 首次执行 Part B 时，引导创始人完成以下一次性配置，写入对应 secret 后**逐项验证**；之后所有会话直接使用，缺失才重新询问：

| 项 | 存放处 | 验证方式 |
|----|--------|---------|
| Modal token + workspace 名 | `modal token set`（本机）/ CI secret | `modal app list` 成功 |
| R2 凭证（account_id/bucket/key） | Modal Secret `fikirtive-r2` | boto3 `head_bucket` 成功 |
| HMAC 回调密钥 | Modal Secret `fikirtive-hmac` + Fikirtive 侧 env `MODAL_CALLBACK_SECRET` | 双侧一致性自检 |
| Fikirtive 回调地址 | env `FIKIRTIVE_CALLBACK_BASE`（Fikirtive 未上线时填 mock 收口 URL，如 webhook.site，冒烟仅验证投递） | POST 测试包 200 |
| GPU 默认表 | 本文件下表 | — |
| 单次冒烟花费上限 | **默认 $2/次**，超出预估必须先报创始人批准 | 派发前估算 |

**GPU 默认表**（创始人未指定时按此选择，实测后回填）：

| 模板类型 | 默认 GPU | 预估冒烟成本 |
|---------|---------|------------|
| t2i / I2I | A10G | <$0.2 |
| I2V / V2V（≤10s, 720p） | A100-40G | $0.5-2 |
| 更高规格 | 先报创始人 | — |

## 输入（缺一不可，缺了就向创始人要——一次问齐，不挤牙膏）

1. **API 格式** `workflow_api.json`（菜单 Save (API Format)）。只给了 UI 格式 → 指导补导。若 JSON 中无任何 `_meta.title` 字段（旧版 ComfyUI/导出设置问题）→ **停止**，指导创始人升级 ComfyUI 或开启标题导出后重导，不要试图改名循环。
2. UI 格式 `workflow.json`（如有，收入捆包供将来改图）。
3. 用途一句话 + **槽位精确声明**：创始人必须给出精确标题字符串（如 `槽位：FIKIRTIVE:prompt, FIKIRTIVE:ref_character`）。中文意译（"角色参考图"）不是声明——agent 此时回示精确字符串清单请创始人确认，**不许模糊匹配**。
4. **每个 ref 槽一张默认参考图文件**（组包与冒烟测试必需；纯 t2i 无 ref 槽则免）。

## Part A：制成 Fikirtive 模板（今天即可执行）

### A1. 槽位标题检查

解析 `workflow_api.json`（顶层为 `节点ID → {class_type, inputs, _meta.title}` 扁平 map）：

1. **扫描全部节点的 `_meta.title`，匹配 `FIKIRTIVE:` 前缀**——不按 class_type 筛（自定义编码器/加载器如 WanVideoTextEncode、LoadImageFromUrl 同样合法）。class_type 仅记录入 manifest 作诊断信息。
2. 标题匹配规则：**精确字符串匹配**（区分大小写，无空白容差）。`fikirtive: prompt` ≠ `FIKIRTIVE:prompt` → 报告为未匹配。
3. 验证：声明的每个槽位**有且只有一个**精确匹配节点。
   - 缺标题 → 列出候选节点（class_type + 现标题）让创始人在 ComfyUI 改名后重导。**不许替创始人猜。**
   - 重复标题 → 响亮报错列冲突节点。静默选一个 = 本 SOP 最严重违规。
4. **多余的 `FIKIRTIVE:` 节点**（有标题但未声明）：照常收入 manifest 的 slots，并在报告中标注"未声明槽位，已收录"——声明清单是必须存在校验，不是排他白名单。

### A2. 生成 manifest.json

```json
{
  "bundle_schema": 1,
  "template_name": "<slug，见 A3 命名规则>",
  "display_name": "<创始人原话用途>",
  "template_version_hash": "<workflow_api.json 原始字节的 SHA-256（不做 JSON 规范化——重导出即新版本是特性不是缺陷）>",
  "exported_at": "<ISO 时间戳>",
  "slots": [
    { "title": "FIKIRTIVE:prompt", "declared": true, "node_id": "6", "class_type": "CLIPTextEncode", "field": "inputs.text" },
    { "title": "FIKIRTIVE:ref_character", "declared": true, "node_id": "12", "class_type": "LoadImage", "field": "inputs.image" }
  ],
  "class_types_used": ["<去重全列表——跨机缺自定义节点时的诊断依据>"]
}
```

`node_id` 仅为缓存（改图会洗牌）；定位**永远以 title 为准**；ID 失配但 title 匹配 → 更新缓存继续；title 找不到 → 报错停止。

### A3. 组包与命名

**命名规则：** agent 从用途生成 ASCII kebab-case slug（如 `i2v-character-walk`），**回示创始人确认一次**后即为该模板永久名。版本号 N = 注册表中该 slug 现存最大 N + 1（首版 = 1）。

```
i2v-character-walk-v1.zip        ← 写到 <repo>/templates/
├── manifest.json
├── workflow_api.json             ← 原样（模板态）
├── workflow_ui.json              ← 输入的 workflow.json 原样改名收入（如有）
└── inputs/                       ← 默认参考图（文件名与 JSON 内引用值一致）
```

### A3.5 注册（Fikirtive 应用上线前的文件版注册表）

注册 = 追加一行到 `<repo>/templates/registry.json`（不存在则创建 `[]`）：

```json
{ "slug": "i2v-character-walk", "version": 1, "hash": "<template_version_hash>",
  "zip": "templates/i2v-character-walk-v1.zip", "display_name": "...",
  "slots": ["FIKIRTIVE:prompt", "FIKIRTIVE:ref_character"], "registered_at": "<ISO>",
  "modal_endpoint": null, "gpu": null, "cost_usd_per_run": null }
```

判重：`hash` 已存在 → 同版本跳过并报告；新 hash → 新版本，旧行保留（不可变历史）。**M0 上线后**：Fikirtive 启动时导入该 registry.json，此文件继续作为真相源直到阶段二站内注册表替代它（届时 agent 改写本节）。

### A4. 填槽（Fikirtive 运行时行为，实现参照）

纯 JSON 替换：`slots[].field` 写入对应值；ref 图放 `inputs/`，文件名与写入值一致。**禁止** `{{placeholder}}` 模板语法（破坏 JSON，重导出即毁）。

### Part A 完成报告（发给创始人）

`✅ <slug>-v<N> 已注册 | 槽位 N 个（声明 M + 额外 K）| hash 前 8 位 | zip 路径`，加任何警告（未声明槽位、ID 洗牌已更新缓存等）。

## Part B：部署为 Modal 端点（阶段二解锁）

**解锁前置：环境前置块全部验证通过。任何一项缺失 → 停止，引导创始人完成一次性 setup，不要带病执行。**

### B0. 权重灌装（每个新模板类型一次）

1. 向创始人要权重清单：模型名 + 来源（HuggingFace repo id / 本机路径）。
2. 创建/复用 Modal Volume `fikirtive-weights`；agent 写并运行一次性下载 job 灌装；`modal volume ls` 验证文件与大小。
3. 记录 volume 内路径到模板注册表行。

### B1. Modal app 结构

1. `@app.function`：`gpu=<GPU 默认表>`、`timeout=3600`（默认 300s 会杀长渲染）、`retries=1`、`enable_memory_snapshot=True`；权重从 Volume 惰性加载（snapshot 不覆盖 GPU 导入期初始化）；镜像内安装 `class_types_used` 对应的自定义节点——缺装清单先报创始人确认（这是创始人 4 职责外唯一例外，因为节点选择属于工作流设计的延伸）。
2. `POST /dispatch`：收 `{generation_id, filled_workflow_api_json}` → `.spawn()` 渲染函数 → **立即返回 `function_call_id`**。
3. 渲染函数尾部（三保险之二、三）：产物写本地盘 → SHA-256 → **boto3 multipart 直传 R2**（key = `u/<owner_id>/<hash>`，凭证自 Secret `fikirtive-r2`）。**禁止** CloudBucketMount 直写（不支持 ffmpeg muxing 随机写）；**禁止**函数返回值传视频（~100MB gRPC 上限）→ 只回 `{generation_id, content_hash, size, mime, duration_s, attempt}`。
4. 完成回调：HMAC（Secret `fikirtive-hmac`）签名 POST 到 `$FIKIRTIVE_CALLBACK_BASE/api/modal/callback`。
5. `GET /status/{call_id}`：`FunctionCall.from_id(call_id).get(timeout=0)` 供对账轮询（结果保留 7 天）。

### B2. 部署与冒烟

1. `modal deploy`；记录端点 URL。
2. **花费预估**：按 GPU 表估算；超 $2 上限 → 先报创始人批准再跑。
3. 冒烟：模板默认输入真跑一次 → 验证 ①R2 出现哈希命名对象（用 r2 凭证 head_object）②回调投递到 `$FIKIRTIVE_CALLBACK_BASE`（mock 收口时验证收到即可）③status 可查。
4. 回填注册表行：`modal_endpoint/gpu/cost_usd_per_run`（实测秒数 × Modal 价目）。
5. 报告创始人：端点 URL、冒烟产物、实测耗时与成本。

### B3. 失败处理（不许静默）

| 情况 | 动作 |
|------|------|
| 缺自定义节点（class_types_used 比对失败） | 报缺装清单，请创始人确认镜像装什么 |
| 容器构建失败 | 贴构建日志关键行 + 猜测原因，报创始人 |
| CUDA OOM | 报告并建议：降分辨率冒烟 / 升 GPU 档（升档需批准） |
| 权重文件缺失（ComfyUI 报 model not found） | 对照 B0 清单报缺哪个，回到 B0 补灌 |
| 冒烟超时 | 报实测耗时建议调 timeout；**不许自行反复重试烧钱** |
| 回调未到但 status 完成 | 检查 HMAC/URL 配置，报告 |
| 同 generation_id 双回调 | 正常（幂等），哈希去重，无需报告 |

## 创始人的全部职责（不变的承诺）

1. 在 ComfyUI 设计工作流；2. 给填槽节点起 `FIKIRTIVE:` 标题；3. Save (API Format) 导出，连同用途一句话 + **精确槽位字符串** + 每 ref 槽一张默认图丢给 agent；4. 收报告点头或改图。
（外加两个低频例外：首次 Part B 前的一次性 setup 仪式；自定义节点装机清单确认。）
