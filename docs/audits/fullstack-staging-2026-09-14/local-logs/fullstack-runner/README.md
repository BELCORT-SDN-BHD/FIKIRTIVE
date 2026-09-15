# 本轮临时runner

此目录不是常驻测试，不修改产品或公共harness。代码基准14bcd038；Node22.22.2、pnpm10、已有packages与Web production build。

未来复跑先新建随机、从未存在的127.0.0.1专属 `_test` 数据库，仅对该库设置UTC；把名字写入上级 `fullstack-db-name.txt`。已清理的旧数据库不能当作仍可用。检查 `../safe-run.py` 的绝对root为当前独立worktree，且没有真实.env。然后从repo根执行：

```sh
python3 docs/audits/fullstack-staging-2026-09-14/local-logs/safe-run.py fullstack-migrate pnpm --filter @fikirtive/db exec prisma migrate deploy
python3 docs/audits/fullstack-staging-2026-09-14/local-logs/safe-run.py fullstack-browser pnpm exec playwright test -c docs/audits/fullstack-staging-2026-09-14/local-logs/fullstack-runner/playwright.config.ts
```

此命令会清空该独占库public夹具，然后正常登录、点击预制卡、启动现成mock worker。不得指向其他数据库，不得继承真实密钥。素材理解关闭；不调用真实Otto模型。运行后核自建进程停止、存证、只删除自己本轮新建的库。

注意：当前fullstack.spec.ts的金额分摊断言已修正为真实RESERVE/SETTLE语义，但修正后**未重新执行**。本轮第三次的原始exit1不可被当前源码替代；当时完整源码在失败trace/error-context中。

readback.config.ts只用于读取尚未清理的同一完成fixture，绝不建新任务。它需要上级fullstack-evidence.json和同一库；已清库后不能直接运行。它不证明原页自动收敛。
