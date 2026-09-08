# 有边界的自动检查记录

日期：2026-09-08。目标版本：`0e1f2ab3f1b05fba6112ee9544d6de5930648f83`。

**结果：本 worker 未运行测试。只完成配置、候选测试和已有依赖的只读预检。没有通过数量、没有测试失败数量；不得将此记录计作自动验收通过。** 本记录不代替主报告的浏览器结果。

## 读取范围与判断

- 已读取目标 commit 的 `apps/web/vitest.config.ts`。默认 include 涵盖全部 web tests，包含真实数据库集成测试；setup 顺序为 `setup-node-runtime.ts`、`setup-db-guard.ts`，单线程，默认 node environment。
- 已完整读取上述两个 setup 文件。前者设置 AsyncLocalStorage；后者仅拒绝非 `_test` DATABASE_URL，允许缺失 URL。这个 guard 不等于禁止所有数据库访问。
- `apps/web/lib/__tests__/reference-picker-unified.test.tsx` 是 jsdom DOM 行为测试，mock `reference-search-actions`；候选纯前端测试。
- `apps/web/lib/__tests__/official-avatar-readonly-ui.test.ts` 是 jsdom UI 测试，mock refgen actions／balance refresh；候选纯前端测试。它验证旧 ElementVariantsDialog 的只读行为，不能据通过推导新 Library 已有 Use in Canvas。
- **排除** `apps/web/lib/__tests__/message-reference-refs.test.ts`：文件开头明确“真 Postgres、真 Prisma、两个真 org”，直接 import `@fikirtive/db`，beforeAll 调用 organization.create／project.create／entity.create 等。这不是本次允许的 pure test；未执行。

## 未执行原因

现有依赖可解析，读取版本为 Vitest 3.2.6、React 19.2.4、React DOM 19.2.4、jsdom 30.0.0、Base UI 1.7.0。但是 `apps/web/node_modules/@fikirtive/core` 是指向当前较旧工作树 `packages/core` 的 symlink；包 export 使用 `dist/*.js`。候选测试及其组件确实 import `@fikirtive/core/reference-ref`／`entity-policy`。直接把这套 node_modules 链接到部署源码快照，会混入另一个 checkout 的构建产物，无法作为目标 commit 的干净测试证明。

同时 `git diff 0e1f2ab3 HEAD -- pnpm-lock.yaml apps/web/package.json` 显示 lockfile 有差异，包含 workspace importer 的 Vitest 条目与 eslint resolver peer snapshots。虽然部分已读取第三方包版本一致，**未建立整套依赖及 workspace dist 与目标版本一致的证明**。

任务仅授权干净复用既有依赖、不安装依赖；因此在预检阶段停止，没有建立并运行混合版本快照，也没有为追求数字重新构建／修改产品树。这是部署版本验证环境缺口，不是测试失败或产品缺陷。

## 实际执行的只读命令

```sh
git rev-parse 0e1f2ab3
git show 0e1f2ab3:apps/web/vitest.config.ts
git show 0e1f2ab3:apps/web/lib/__tests__/setup-node-runtime.ts
git show 0e1f2ab3:apps/web/lib/__tests__/setup-db-guard.ts
git show 0e1f2ab3:apps/web/lib/__tests__/reference-picker-unified.test.tsx
git show 0e1f2ab3:apps/web/lib/__tests__/official-avatar-readonly-ui.test.ts
git show 0e1f2ab3:apps/web/lib/__tests__/message-reference-refs.test.ts
git diff 0e1f2ab3 HEAD -- pnpm-lock.yaml apps/web/package.json
ls -l apps/web/node_modules/@base-ui/react apps/web/node_modules/vitest apps/web/node_modules/@fikirtive/core node_modules/.pnpm/lock.yaml
```

测试文件读取主要为开头的 imports／mock／beforeAll 区段；不宣称完整测试体都已审查。另外用 Node `require.resolve` 读取上述五个第三方 package.json 的 version，未加载应用或服务端模块。

## 后续可执行的限定检查（本次未执行）

取得目标 commit 对应、已验证的依赖／workspace build 后，在独立源码快照 `apps/web` 目录，仅选择以下两个文件：

```sh
env -i PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:/bin NODE_ENV=test \
  /opt/homebrew/opt/node@22/bin/node ./node_modules/vitest/vitest.mjs run \
  lib/__tests__/reference-picker-unified.test.tsx \
  lib/__tests__/official-avatar-readonly-ui.test.ts
```

`env -i` 用允许列表启动，确保 DB／provider／storage／支付凭据不继承；快照不可包含 env 文件。执行前仍须核对纯模块依赖及导入副作用，避免把此示例自动扩为全 suite。本次没有启动测试子进程，因此也没有把任何 DB／provider 凭据传给测试；未读取或输出凭据。

未执行 integration、migration、seed、live DB、provider generation、依赖安装、production build 或 full suite。
