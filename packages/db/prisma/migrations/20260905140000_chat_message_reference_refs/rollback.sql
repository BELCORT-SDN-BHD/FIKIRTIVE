-- 回滚 20260905140000_chat_message_reference_refs。
--
-- 丢掉的只有这一列本身(每条消息各自提到过哪些对象)。消息正文、payload、钱账、租户边界
-- 都不经过它,所以回滚不需要备份;代价是回滚之后已经存下的引用再也回不来 —— 那是一次
-- 真的丢数据。执行前请确认没有还需要它的读路径(全仓 `referenceRefs` 的引用点)。

BEGIN;

ALTER TABLE "ChatMessage" DROP COLUMN IF EXISTS "referenceRefs";

COMMIT;
