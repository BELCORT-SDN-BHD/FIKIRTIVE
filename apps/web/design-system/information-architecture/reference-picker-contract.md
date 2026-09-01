# Otto `@` reference picker contract

> **状态：Founder-approved interaction contract。** 本目录整体仍是 Review candidate；本文件在 IA 冻结前先作为
> `@` reference interaction 的唯一设计来源。  
> **批准：** 2026-08-30，Founder 确认采用“裸 `@` 显示 Recent＋分类入口；继续输入后统一搜索全部可引用对象”。

## 1. Intent

让 Founder 在 Otto Chat 中，不离开当前 Canvas 就能准确引用 Product、可复用 Element 或具体媒体，同时保持选择结果可见、可移除、可追溯。

这个组件的产品名称是 **Reference picker**。`@mention` 是用户动作；mention token 是输入框中的视觉结果。它不是一张缩小版 Library。

## 2. Entry and search

### 输入裸 `@`

菜单锚定在输入光标附近，并显示：

1. `Recent`：最多 5 个最近使用的 reference；
2. 分类入口：`Products / Characters / Official avatars / Locations / Clothes / Media`；
3. `Media` 继续覆盖具体的 `Uploads` 与 `Generations`，不创建第三份媒体对象。

### 继续输入，例如 `@ray`

- 在全部可引用对象上即时搜索，不要求 Founder 先猜 category；
- 同一个底层对象即使同时在 Favorites 与多个 Collections 中，也只出现一次；
- 结果按名称匹配、最近使用与当前 Canvas 相关性排序；
- 最多显示约 8 行，之后在菜单内部滚动；
- 支持 `Arrow up / Arrow down / Enter / Escape`，并保留鼠标操作。

## 3. Result row anatomy

每一行只能包含：

- thumbnail 或稳定的 type icon；
- primary name；
- 一行 disambiguation，例如 `Product · Otto IQ`、`Official avatar · Read only`、
  `Generation · Merdeka launch`；
- 右侧 type icon；
- keyboard / pointer selection state。

菜单继承 Fikirtive design-system tokens。保留 Founder reference 中的紧凑列表、明显选中行、thumbnail、name 与 type icon；
不复制其 dark glass styling。

## 4. Mention targets and resolution

| Picker type | Canonical owner | `@` 选择后使用什么 |
|---|---|---|
| Product | Otto IQ Product catalog | 同一个 Product ID 的 facts、constraints、linked Library images 与适用 Brand rules |
| Character | Library Elements | Character ID 与其 approved reference assets |
| Official avatar | Fikirtive official avatar catalog | 稳定、read-only avatar ID 与官方 reference assets |
| Location | Library Elements | Location ID 与 linked reference assets |
| Clothes | Library Elements | Clothes ID 与 linked reference assets |
| Generation | Library Generation history | 准确的 Generation ID 与 immutable provenance |
| Upload | Library Uploads | 准确的 Asset ID |

Picker 只提交 typed ID，不复制 image URL、Product facts 或媒体文件。Server-side resolver 在执行时读取最新且有权限的 canonical object。

## 5. Selection and send flow

```text
Type @
→ Recent + browse types
→ type to search or choose a type
→ select one result
→ insert removable mention token
→ optional: add more references
→ send to Otto
→ message keeps visible references
→ Generation provenance records Context used
```

- 每个 token 显示 thumbnail / type、name 与 remove action；
- Product、Official avatar 与媒体 reference 不因选中而被复制到 Canvas；Canvas 只保存引用关系；
- Otto 可以建议相关 reference，但不能静默附加；Founder 必须在发送或付费 generation 前看见并可移除；
- persistent Brand / Otto IQ rules 默认生效，不要求 Founder 每次 `@Brand`。

## 6. Browse-only containers

`Canvas`、`Chat`、`Favorites` 与 `Collection` 是查找路径或组织关系，不是 v1 mention target：

- `From Canvas`：按 Canvas / Chat history 找具体 Generation；
- `Browse collection`：进入 Collection 后选择其中的具体对象；
- 不允许 `@Collection` 静默注入整组 assets；
- Favorites 与 Collections 不产生搜索 duplicate。

## 7. States

- **No matches：** 显示 `No references found`，保留 `Upload media` 或进入相应 Library section 的明确动作；
- **Unavailable：** 已删除、无权限或 processing 中的对象不可发送，并说明原因；
- **Duplicate name：** 使用 type、Canvas name 或 source disambiguation，不改写 canonical name；
- **Read-only：** Official avatar 可使用、收藏和预览，但不能从 picker 进入 rename / edit identity。

## 8. Checkable acceptance

1. 裸 `@` 不加载无限资产列表，只显示 5 个 Recent 与分类入口。
2. 输入名称可以跨全部批准类型找到对象。
3. 同一对象不会因 Favorites / Collections membership 重复出现。
4. 选中结果以可移除 token 留在 composer；发送后在 message 中仍可识别。
5. Product resolve 到 Otto IQ 的同一个 Product ID，不建立 Library Product 副本。
6. Official avatar 明确为 read-only；其生成成果仍进入 Founder 的 Generation history。
7. Canvas、Chat 与 Collection 只用于 browse，不作为整包 prompt context。
8. Generation detail 可以追溯本次使用的 typed reference IDs。
9. 所有可见状态、spacing、type、focus 与 motion 使用当前 Fikirtive design-system authority。

## 9. Non-goals

- 不在 mention menu 内复制完整 Library filters、asset detail 或 Collection management；
- 不允许整库、整 Canvas 或整 Collection 静默进入模型 context；
- 不在本 contract 定义 backend search index、database schema 或 provider prompt format；
- 不因记录 contract 就提前实现或修改 production UI。
