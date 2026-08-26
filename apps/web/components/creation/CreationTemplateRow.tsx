"use client";

/**
 * CreationTemplateRow.tsx —— 起手模板那一排,画布空态与 Library 快产车间是**同一个**组件。
 *
 * 形状照 Grok 的 featured templates 与 ChatGPT 的 preset 行:输入框上方横着一排小卡,
 * 一张缩略图加一个短名,一眼扫完。它不是一个「模板库」——四张,一行,不换页。
 *
 * 两条行为写在这里,不在两个宿主里各写一遍:
 *   ① **点一下只把句子填进输入框**(`onPick` 拿到的是成句 prompt)。发送仍然是商家自己
 *      按的那一下 —— 这一排一分钱都不动。
 *   ② **锁的时候是 disabled,不是消失**。问题卡在的那一段,参数与报价一起冻住
 *      (`LibraryQuickCreate` 那条「所见即所付」),模板同理:能按就等于能改这一次请求,
 *      而冻住的就该是整个请求。让它消失反而更糟 —— 商家会以为自己按坏了什么。
 */

import { Button } from "@/components/ui/button";

import { CREATION_TEMPLATES, type CreationTemplate } from "./creation-templates";
import "./r22-creation.css";

export function CreationTemplateRow({
  locked = false,
  onPick,
}: {
  /** 问题卡在的时候为真:整排按不动,报价与参数也正锁着。 */
  locked?: boolean;
  onPick: (template: CreationTemplate) => void;
}) {
  return (
    <div className="r22-template-row" data-r22-template-row role="group" aria-label="Start from a template">
      {CREATION_TEMPLATES.map((template) => (
        <Button
          unstyled
          type="button"
          key={template.id}
          className="r22-template"
          data-r22-template={template.id}
          disabled={locked}
          aria-label={`Start from ${template.name}`}
          onClick={() => onPick(template)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- 32px 的模板缩略图,与卡上其它样张同一批本地文件,不值得再走一轮远端优化。 */}
          <img src={template.thumb} alt="" />
          <span>{template.name}</span>
        </Button>
      ))}
    </div>
  );
}

export default CreationTemplateRow;
