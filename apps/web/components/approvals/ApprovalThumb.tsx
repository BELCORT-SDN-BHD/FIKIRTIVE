"use client";

/**
 * ApprovalThumb.tsx —— 审批面里唯一一处画 fixture 缩略图的地方。
 *
 * 卡上的缩略图与 ③ 逐平台预览里的成品图是同一件事,只是尺寸不同(尺寸由 CSS 给,
 * 不由这里判断)。写成两处 `<img>` 就等于同一个决定有两份真相,而且 Next 的
 * `no-img-element` 告警也会跟着翻倍 —— 这一面是 fixture 静态图,不走 `next/image`
 * 的优化管线,所以告警本身留着(它说的是真的),但只留一处。
 */

export function ApprovalThumb({ src, className = "r22-approvals-frame-img" }: { src: string; className?: string }) {
  return <img className={className} src={src} alt="" />;
}

export default ApprovalThumb;
