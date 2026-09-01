# Mobbin evidence — Library reusable reference objects

> 研究日期：2026-08-30。  
> 任务：决定 Product、Character、Clothes 与 Location 在 Library 里应是普通 asset filter，还是可复用 object。  
> 方法：使用 Mobbin MCP `search_flows` 检查角色训练、avatar 与 reference-image flows。
> 状态：Evidence + approved direction；Founder 于 2026-08-30 批准四类 References。

## 1. Character / Avatar evidence

- [Runway — Add a character reference](https://mobbin.com/flows/c4c2a62a-4342-4fb4-b154-9ee83060a496)
- [Runway — Create a custom character](https://mobbin.com/flows/619ef90f-67d8-4b2c-9f6e-b7909ef4baa4)
- [Synthesia — Selfie avatar](https://mobbin.com/flows/c4c9f6cc-a0c9-4f08-9ffc-f0d350717cae)
- [VEED — AI avatars](https://mobbin.com/flows/32e74574-8857-42b6-b3a3-3212cad14ed4)
- [Gemini — Uploading an avatar](https://mobbin.com/flows/2230c4bf-1810-43d6-8f72-eea24c0183bb)

Runway 的 custom character 使用 15–30 张照片建立一个之后可重复选择的 character。这证明它是
“一个 object 拥有多个 assets”，不是图片的另一个 type filter。Synthesia 对真人 avatar 增加 consent 验证和失败状态；
这是 Fikirtive 处理 real-person character 时必须保留的边界。

## 2. Reusable reference evidence

- [Leonardo — Adding reference images](https://mobbin.com/flows/be57c5c7-29b7-469b-9812-406b9e2e080f)
- [Magnific — Reference categories](https://mobbin.com/flows/710d7d86-91cd-4e38-a8a2-aba270e95928)
- [Magnific — Image references](https://mobbin.com/flows/d89f920d-56f9-488e-8c9d-201a9974ba74)
- [Visual Electric — References](https://mobbin.com/flows/9cb95ef4-ebca-4258-92ee-5a82dd3171d1)

Mobbin 未返回一个可验证的、专门的“full Product object” flow。最接近的参考系统显示：用户会保存
可重复选择的 reference，每个 reference 可有名称、图片、prompt / constraints 等元数据。因此 Product 对象的业务
facts 是 Founder 的 Fikirtive 产品决定，不宣称是 Mobbin 原样照搬。

## 3. 已批准的 Library model

```text
Library
├─ Assets
│  ├─ Source filter: Generated / Uploaded / Imported
│  └─ Type filter: Image / Video / Audio when supported
└─ References
   ├─ Products
   ├─ Characters
   ├─ Clothes
   └─ Locations
```

### Product

一个 Product 是完整、可复用的 context object：v1 拥有 name、description / positioning、selling points、
required claims / constraints、price context 与多个 Library asset ids。Brand Knowledge base 只链接该 Product，不复制这些 facts。

### Character

一个 Character 拥有 name、subtype（real person / AI avatar / mascot）、hero asset、多角度 reference asset ids 与 usage constraints。
只有 real person 需要 consent status；不把 Avatar 与 Character 拆成两个重复 category。

### Clothes

一个 Clothes reference 保存可复用的服装或整套造型 context，包括名称、对应 Library asset ids，以及会影响生成结果的
styling / usage notes。单张服装图片仍是 Asset；只有需要反复选择并维持一致性的服装或造型才建立 Clothes object。

### Location

一个 Location reference 保存可复用的场景、店铺或拍摄环境 context，包括名称、对应 Library asset ids，以及会影响生成结果的
environment / usage notes。单张场景图片仍是 Asset；只有需要反复选择并维持一致性的地点或环境才建立 Location object。

## 4. SSOT constraints

- 一个 media file 只有一个 Library asset id。
- Product / Character / Clothes / Location 只保存 asset references，不复制文件。
- 同一 Product 的 facts 只在 Product object 编辑；Brand 和 Create 都是 consumer。
- Create / Canvas 可选 Brand context、Product、Character、Clothes、Location 或 raw asset，但不为各入口建立独立副本。
- v1 只冻结 Products、Characters、Clothes 与 Locations；其他 reference categories 未有 Founder use case 前不预造。
