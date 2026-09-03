/**
 * video-first-frame —— 让一条刚做好的片子在板上**显示它的第一帧**,而不是一块黑砖。
 *
 * 走查 P1-7(2026-09-04):动画任务在 +82 秒完成,画布上那张卡变成一块纯黑 —— 没有首帧、
 * 没有播放键、没有时长。当场查过:文件是**完全加载好**的(`readyState 4`、`duration 5.088`、
 * 960×960),只是 `poster` 是 `null`,所以在按下播放之前浏览器画的是黑。刷新一次,同一张卡
 * 就有首帧和播放三角了。
 *
 * 我们没有 poster 图可给(供应商只交一条 mp4,再去截一张图要么跑一次服务端转码,要么把
 * 视频整条下载到浏览器里画 canvas —— 为了一张缩略图,两条都太贵)。
 *
 * 媒体片段(Media Fragments URI, W3C)正是为这件事存在的:`#t=0.001` 告诉浏览器
 * 「从第 0.001 秒开始」,于是它在**元数据阶段就把那一帧解出来画上**,不需要播放、不需要
 * 额外请求、不需要 JS。片段(`#` 之后那一段)**从不发给服务器**,所以对签名 URL 与任何
 * query 参数都是无副作用的。
 *
 * 已经带片段的地址原样返回 —— 那是别人已经说过的话,不覆盖。
 */
export function videoFirstFrameSrc(url: string): string;
export function videoFirstFrameSrc(url: string | undefined): string | undefined;
export function videoFirstFrameSrc(url: string | undefined): string | undefined {
  if (!url) return url;
  if (url.includes("#")) return url;
  return `${url}#t=0.001`;
}
