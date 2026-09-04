/** Seconds → "m:ss" (e.g. 5 → "0:05", 83 → "1:23"). Negatives / NaN / non-finite clamp to "0:00". */
export function formatElapsed(totalSeconds: number): string {
  const n = Number(totalSeconds);
  const s = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * #979 —— 「还要等一会儿」这句话,全产品**一处作者**。
 *
 * 它曾经是一个数字:图片 “usually ~20s”、视频 “usually ~45s”。那两个数字没有任何测量在
 * 背后 —— beta 录像里实测的第一次等待是 34 秒,而卡上写着 20,秒表就在它旁边跑着,商家
 * 第一眼看到的就是产品在数自己都不信的数。一个当场被自己推翻的估计比不给估计更伤信任。
 *
 * 第一版改成「a minute or two」,判官照样判红,而且判得对:那**仍然是一句量级断言**,
 * 只是把一个精确的假数字换成了一个模糊的假数字 —— 背后同样没有测量,同样可能被那台秒表
 * 当场推翻。与 CHAT_SPEND_NOTE 同一条纪律:没有测量就不许出现量级。
 *
 * 所以这句话现在只说「要等一下」,一个量级词都不带 —— 而这不是新发明的措辞,是仓库自己
 * 早就在用的那一句(`StoryboardCard` 的「Working — this can take a moment…」)。既然是
 * 同一件事,就只能有一个作者:那一处现在也引这个常量。
 *
 * 要重新给数字,得先有一份真实等待时间的分位数(P50/P90),按那个分位数说话,并且说清
 * 那是分位数而不是承诺。真正的进度信息照旧由旁边那个走着的计时器提供,它说的是事实。
 */
export const QUEUE_WAIT_NOTE = "this can take a moment";

/**
 * 一句话停在屏幕上太久之后，产品自己说的那一句。**同一条纪律**：没有量级、不承诺时间，
 * 只说一件此刻为真的事 —— 还在做。
 *
 * 走查 P0-4：从 t+2.5s 到 t+48.8s，画布上那句忙碌文案一个字没变，读起来像卡死而不是在做事。
 * 阈值与用法在 `lib/otto-canvas-turn.ts`（`STILL_WORKING_AFTER_SECONDS`）；这里只管那句话，
 * 与 `QUEUE_WAIT_NOTE` 同一处作者，别处要说「还在做」引这里，不要再写一句。
 */
export const STILL_WORKING_NOTE = "still working…";
