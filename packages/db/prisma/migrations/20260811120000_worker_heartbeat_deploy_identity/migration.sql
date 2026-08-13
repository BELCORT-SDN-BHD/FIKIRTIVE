-- #797 心跳带上部署身份(工程评估债 #6)。
--
-- 心跳到今天只回答一个问题:worker 还活着吗。它答不了另一个每次部署都会咬人的问题——
-- web 与 worker 是不是同一个部署?两个服务各自构建、各自重启,一次半成功的部署就会留下
-- 「web 是新的、worker 还是旧的」;更隐蔽的是两边代码同版但共享密钥不是同一把
-- (#569 的形状:发布链每次都在解密那一步静默失败,界面上只看到一个说不出原因的
-- NEEDS_ATTENTION)。这两种状态今天在产品里没有任何地方看得见。
--
-- 两列都可空,而且刻意不给默认值:
--   commitSha         平台注入的 git sha。宿主没注入就是 NULL —— 「不知道」必须长得像
--                     不知道,不能被一个假造的值盖过去。
--   configFingerprint web 与 worker 必须同值的那批变量的 8 位摘要。密钥先 HMAC 再进摘要,
--                     所以这一列里永远没有任何可还原的密钥内容。
--
-- 安全性:只加两个可空列,不删数据、不改既有列、不加约束。存量那一行(id='worker')
-- 保持原样,两列为 NULL,直到 worker 下一次心跳把它们写上——最多 60 秒。

ALTER TABLE "WorkerHeartbeat"
  ADD COLUMN "commitSha" TEXT,
  ADD COLUMN "configFingerprint" TEXT;
