/** Seconds → "m:ss" (e.g. 5 → "0:05", 83 → "1:23"). Negatives / NaN / non-finite clamp to "0:00". */
export function formatElapsed(totalSeconds: number): string {
  const n = Number(totalSeconds);
  const s = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * #971 —— 排队时说的那句等待预期。
 *
 * 它曾经是一个数字:图片 “usually ~20s”、视频 “usually ~45s”。那两个数字没有任何测量在
 * 背后 —— beta 录像里实测的第一次等待是 34 秒,而卡上写着 20,秒表就在它旁边跑着,商家
 * 第一眼看到的就是产品在数自己都不信的数。一个当场被自己推翻的估计比不给估计更伤信任。
 *
 * 所以这里不再给数字。要重新给,得先有一份真实等待时间的分位数(P50/P90),按那个分位数
 * 说话,并且说清那是分位数而不是承诺 —— 与 CHAT_SPEND_NOTE 同一条纪律:没有测量就不许
 * 出现量级断言。真正的进度信息照旧由旁边那个走着的计时器提供,它说的是事实。
 *
 * 这句话对图片和视频是同一句:我们手上没有能把两者分开说的证据,而编两句不同的假话
 * 不比编一句更诚实。
 */
export const QUEUE_WAIT_NOTE = "this can take a minute or two";
