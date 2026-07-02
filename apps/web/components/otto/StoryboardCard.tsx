"use client";
import React from "react";
import { Film } from "lucide-react";
import { parseStoryboardCardPayload } from "@/lib/storyboard-card";

export interface StoryboardCardProps {
  /** 留给 F3 编辑动作;F2 只读,不消费。 */
  cardId: string;
  payload: unknown;
}

/** Otto 的分镜卡。用于 STORYBOARD_CARD 消息(F2 只读)。
 *  渲染有序镜头 —— 每镜头 = 首帧 prompt + 视频 prompt(文字)。
 *  编辑(F3)、首帧图(F4)之后加;这里纯文字。
 *  样式镜像 OttoActionPlanCard:.gb 外壳 → bg-secondary 卡体 → bg-card 行。 */
export function StoryboardCard({ payload }: StoryboardCardProps) {
  const { storyboardTitle, shots } = parseStoryboardCardPayload(payload);
  return (
    <div className="gb leading-[1.65]" style={{ maxWidth: 480 }}>
      <div className="rounded-[18px] border border-border bg-secondary p-6">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <Film size={20} className="text-foreground" />
          <span className="font-bold text-[1rem] text-foreground">
            {storyboardTitle || "Storyboard"}
          </span>
        </div>

        {/* Shots */}
        {shots.length > 0 && (
          <div className="flex flex-col gap-2">
            {shots.map((shot) => (
              <div
                key={shot.index}
                className="bg-card rounded-[14px] flex flex-col gap-1"
                style={{ padding: "10px 12px" }}
              >
                {/* Shot number + optional title */}
                <div className="flex items-center gap-2">
                  <span className="text-[0.75rem] font-semibold px-[7px] py-[2px] rounded-full bg-secondary text-muted-foreground">
                    Shot {shot.index + 1}
                  </span>
                  {shot.title && (
                    <span className="font-semibold text-[0.875rem] text-foreground">
                      {shot.title}
                    </span>
                  )}
                </div>

                {/* First-frame prompt */}
                <div className="text-[0.75rem] text-muted-foreground">
                  <span className="font-semibold text-foreground">First frame · </span>
                  {shot.firstFramePrompt}
                </div>

                {/* Video prompt */}
                <div className="text-[0.75rem] text-muted-foreground">
                  <span className="font-semibold text-foreground">Video · </span>
                  {shot.videoPrompt}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default StoryboardCard;
