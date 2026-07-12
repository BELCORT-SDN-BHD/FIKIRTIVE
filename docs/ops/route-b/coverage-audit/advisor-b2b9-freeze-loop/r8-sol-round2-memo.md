# R8 再判核验备忘录

## 总裁定

v1.1 **不可原样送 R9**，但不存在必须立即放弃技术收敛的证据：

- ③方向正确，补齐同时间戳与重试语义后可采纳。
- ④可行，但 `MAX+1` 的安全性依赖锁、隔离级别、不可删除约束和唯一键，列所有权也需再精确。
- ⑤只修复了原始 subscriber 反例；新增的“物理复制/PITR 只会前跳”仍不成立。
- ②可作为契约 3 的保义勘误，但 `+1 microsecond` 未必是数据库可表示步长，且必须正式重开、重验、重闭契约 3。
- “横向预闭”暂不成立，尤其 `60s age` 还需证明只是活性门槛而非安全依据。

程序上选择 **(c) 有界继续**，不是开放式 (a)：修正后只运行一次 R9；有效新 BLOCK 自动升报 founder。若无法证明⑤只是记录既有单主拓扑，而实际是在裁掉既有 failover 承诺，则不等 R9，立即走 (b)。

## 四项处方

### ③ 删除同态 no-op：修正后采纳

删除该谓词确实同时杀死 R8 的两个反例：

- `P(h1,t7)` 会留下 durable 水位，`A(t4)` 被拦截。
- `removed → P(same hash)` 不再被误吞，可正常复活。

冻结前还必须补三件事：

1. 明定陈旧门的完整比较键及相等规则。仅写“时间戳不旧”不够；相同平台时间戳下的冲突状态仍可能按到达顺序错误覆盖。应使用平台 revision/event id 组成全序；若平台没有该能力，必须明确 equal-time policy 并加入反例测试。
2. `arrivalSeq` 唯一只代表“不碰撞”，不代表“重试幂等”。必须二选一：
   - transport retry 由稳定 crawl/observation key 去重；或
   - 明定重试也形成新观察，但 fold/outbox 只在派生状态真正变化时产生状态副作用。
3. quarantine 期间陈旧门必须从 observation 流自身读取 durable watermark，不能暗中依赖被冻结的投影列。

“24h 可忽略”只能作为容量结论，需用 review 数量、保留期和单行尺寸证明，不能写成契约事实。

### ④ 删除 `lastArrivalSeq`：修正后采纳

锁内 `MAX(arrivalSeq)+1` 可以成立，但契约必须同时冻结：

- 所有 observation 写入路径先取得同一个 per-review 锁；
- 首条 observation 时也存在明确的锁载体，例如先建立 stub row 再 `FOR UPDATE`；
- `MAX` 在取得锁之后执行；
- 使用 PostgreSQL `READ COMMITTED`，或在更强隔离级别下规定 serialization/unique-conflict 重试；
- observation 流不可删除或重编号；若允许归档，必须保留 sequence floor；
- 存在唯一约束  
  `(ownerId, platform, externalReviewId, arrivalSeq)`；
- 所有查询继续携带 `ownerId`。

否则，锁等待事务在旧 snapshot 下仍可能看不到前一事务的新行。若这些条件无法冻结，应改用独立 sequencing row，而不是把计数器放回投影列。

`integrityStatus` 分族方向正确，但“唯二写者”仍不精确。应列成：

- 初始化器：创建时写 `ok`；
- I-R1：`ok → quarantined`，重复隔离幂等；
- rebuild：仅在成功重放至锁内捕获的 backlog 尾端后，原子执行 `quarantined → ok`。

I-R1、fold、rebuild 必须共用同一把 per-review 锁；失败的 rebuild 必须保持 quarantined。fold 可以读取该列，但不得写它。

### ⑤ origin-primary 限定：部分采纳，关键句驳回

“判废与投递只在 origin primary 求值”能修复逻辑 subscriber 的原始反例，但必须有 fail-closed 的机械识别方式；仅靠 `pg_is_in_recovery()` 不够，因为逻辑 subscriber 自身也可能是其集群 primary。

以下断言应删除：

> 物理复制/PITR 下序列前跳只形成永久空洞。

PITR 会创建旧时间点的新 timeline；异步物理 promotion 也可能丢失已对外产生效果的提交。不能统一推导为“只前跳”。

建议冻结为：

- B9 安全域仅覆盖 origin primary 的正常运行、崩溃恢复，以及明确保证无 acknowledged-commit loss 的物理 promotion。
- logical promotion、PITR、丢 WAL 的 promotion 在 dispatcher 重新启用前必须停写、停投递、完成追平/对账、处理 open/prepared transaction，并把 sequence 提升到所有 durable outbox、cursor/tombstone 与已确认外部投递水位之上。
- 该恢复门槛必须留在 B9 的规范性承诺中；B13 runbook 只能实现它，不能替 B9 承担正确性。
- 若目前不支持这些恢复形态，应明确写“unsupported and dispatcher remains fenced”，不要写成已有 resync 保证。

如果“只支持单主”不是当前已批准架构，而是本轮新做的能力收缩，这是 founder 决策，应立即升报。

### ② 单调钳位：修正后采纳；契约 3 必须重开

这是保留 `(receivedAt,id)` 重放契约的最小修复，方向优于本轮改用新 `arrivalSeq`。但 `+1 microsecond` 不能直接冻结：若实际列为 `timestamp(3)`，写入后只有毫秒精度，两个值仍可能相等，随后 `id` 又会重新决定错误顺序。

正确协议应是：

1. 取得与重放 partition 完全相同范围的锁；
2. 读取已持久化的最大 `receivedAt`；
3. 先把 `clock_timestamp()` 转成该列的实际存储精度；
4. 取  
   `max(精度化后的当前时间, previous + one representable tick)`；
5. 验证写入后的值严格大于 previous；
6. insert 与在线 fold 在同一事务内完成。

若列为毫秒精度，tick 至少应为 1ms。所有写入、导入、回填路径都必须走该协议；已有数据也需证明不存在历史逆序，否则新规则只能保护未来数据。

同时应把台账改为：`receivedAt` 是服务端分配的每 partition 逻辑接收时间和规范性重放序，而不是“仅供展示”。如 UI 需要真实墙钟时间，应另存非排序字段。

契约 3 的 CLOSED 已被有效反例推翻，实际上已经失去闭合资格。合法流程是：

- 显式标记 reopened by R8 counterexample；
- 应用上述保义勘误；
- 重跑在线顺序与离线重放等价测试；
- 在同一 head 上重新走四权闭环。

不得静默修改后继续保留旧 CLOSED 标记。只有切换到新的 `arrivalSeq` 排序语义才属于更大的契约改写。

## 横向预闭

目前应判为：**驳回“已预闭”，采纳一次限定审计。**

“锁内读前态”只是必要条件，不足以自动证明正确：

- review freshness 依赖外部来源顺序；
- consent 顺序依赖内部生成的严格单调键；
- quarantine rebuild 还依赖在线 fold 与 replay 消费完全相同的 durable 行和排序；
- outbox 依赖 origin、transaction visibility、timeline 与恢复 fencing。

`LiveEventOutbox` 的 60 秒判断只有在它纯粹用于减少轮询/延迟判定、且 XID/同快照协议独立完成全部安全证明时，时钟回拨或前跳才只影响活性。若 age 参与“可永久判废”的安全推理，则：

- 回拨会延迟；
- 前跳会提前；
- 长事务的 transaction-start timestamp 也可能让行在提交时已经“超过 60 秒”。

这种情况下不能预闭，必须移除 age 的安全职责。R9 至少加入前跳、回拨和长事务三组测试。

## 程序裁定

### 1. 继续还是升报

选择 **(c)：继续一次，但立即在只读增量报告中披露 Q6 已触发**。

理由是：当前仍有一组不改变既定产品语义的确定性机械修复；founder 已明确要求死磕，#254 又授权中途零审批。Q7 的含义应落实为“不得把共享契约转成 RISKS-PENDING”，因此本项保持 active，而不是挂起攒批。

但⑤若涉及新拓扑取舍，或上述缺失证据无法证明现有拓扑，则已不是机械修复，应立刻转 (b)。

### 2. R9 终止条件

应预冻结：

- R9 只接受修正后的四点、其直接交叉引用，以及一次全篇回归；禁止顺手重写其他段落。
- 评审钉定同一 commit hash。
- 有效、可复现的新安全反例导致 BLOCK：自动停止循环并升报 founder，不再自行开 v1.2。
- 重复旧问题、纯措辞偏好或错误反例在 R9 内澄清，不另算新轮次。
- PASS 只表示可进入同一 head 的四权闭环；四权全部通过后才冻结。任何后续文本修改都使 PASS 失效。

因此不是“R9 无条件 PASS 即单方冻结”。

### 3. 工件形态

应采用“语义契约＋最小机械协议＋冻结测试义务”三层结构。只留下语义散文、把并发细节全部移到测试清单，会构成放水，因为测试案例不能自动覆盖未表达的调度。

本轮不要再做整篇工件重构。只增补一个短的并发义务表，每条包含：

- invariant；
- partition/lock 与 linearization point；
- isolation 与 writer set；
- durable order key；
- 初态、交错步骤、预期终态；
- online fold 与 replay 的等价断言；
- failover/recovery scope。

R9 最小场景应覆盖：同 hash 推进水位、removed 后同 hash 复活、equal timestamp、transport retry、quarantine 并发入流与 rebuild、并发 `MAX+1`、NTP 前后跳下 grant/revoke、存储精度碰撞、subscriber 禁止投递、promotion fencing、outbox 长事务与时钟跳变。

## 当前缺失证据

- `receivedAt` 的真实数据库类型与精度，以及历史数据是否已有逆序。
- 实际 isolation level、唯一键、索引、observation 删除/归档政策。
- 首条 review 的锁载体，以及所有 observation/integrity 写者清单。
- 平台时间戳的相等语义、revision/event id 能力和 transport retry 身份键。
- rebuild 捕获 backlog 尾端、失败回滚和复位 `ok` 的原子协议。
- origin-primary 的机械识别、当前 replica/failover/PITR 拓扑与 acknowledged-commit durability。
- 60 秒 age 在 B9 证明中究竟是活性条件还是安全条件。
- 修正后钉定 head 的全文 diff、契约测试结果及四权闭环记录。

总体置信度：**0.87**。其中对③修复方向与②必须重开契约的判断约 0.92；对⑤恢复边界约 0.90；因未见实际 schema、完整 v1.1 文本和部署拓扑，对“修正后可一次 R9 清零”的置信度约 0.78。