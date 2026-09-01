# 人工钱事台账(append-only)

> 用途:`docs/specs/money-engine.md` A13「平台损失在人工台账有落点」的那个落点。三类事件必须登记:**拒付**、**吸收引擎成本**(REDELIVERY_DISCARD 等平台自付)、**人工退款**。
> 纪律:只追加不改历史行;改口=新行冲销并引用旧行;每行必须带 Stripe/job 单号可反查。金额三口径:credits(显示)/RM/USD(按当时 `FX_PIN`)。

| 日期 | org | 事件 | 金额(cr/RM/USD) | 单号(pi/re/dispute/jobId) | 处置 | 状态 | 经手人 |
|---|---|---|---|---|---|---|---|

(空表=开账;首行由第一起真实事件写入)
