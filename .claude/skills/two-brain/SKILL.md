---
name: two-brain
description: FIKIRTIVE 双脑对谈制 —— 重大决策/设计/完整性问题时,Fable(主脑)× GPT-5.6 Sol@ultra(对抗脑)的标准打法;founder 2026-07-10 定制"合作确定的就做成 skill 处理"
---

# 双脑对谈制(Fable × Sol@ultra)

> 何时开:重大产品/架构/战略决策、设计定稿前、完整性扫描、founder 点名"问问 Sol"。日常工程不开(浪费);小分歧用第四闸对抗审查即可。

## 标准回合结构

1. **Fable 亮论纲**(主脑先押注,给对抗脑一个靶):把自己的完整立场写进 prompt,绝不空手问"你怎么看"。
2. **Sol 四题**(ultra 档,读 repo 只读,唯一写=scratchpad 报告文件):①独立第一性答案(不看论纲先自答)②对抗攻击论纲(禁客气)③unknown unknowns(founder 和 Fable 都漏的)④险牌(每张带成本+止损门槛)。
3. **Fable 逐条裁定**(这是主脑的核心职责,不许外包):采纳/改造采纳/驳回,每条带理由;**它不懂我们的宪法与历史,裁定时补上下文**;它的重大事实主张(竞品动作/条款/数据)必须独立核验至少一条最重的。
4. **归档双件套**:Sol 原稿存 `docs/strategy/SOL-R<n>-*.md`(原文一字不改);裁定写进 `docs/strategy/TWO-BRAIN-MEMO-*.md`(共识/分歧+裁定/险牌+注/给 founder 决策清单)。
5. **founder 拍板**:产出永远是提案;决策清单逐条可单批单毙;触宪法的只标注,修宪案另开 PR founder 亲合。
6. **确定即固化**:凡双脑合作确定下来的方法/规则,当场做成 skill 或写进法(founder 定制);判决进 GRILL-VERDICTS。

## 派单口径

```bash
codex exec --skip-git-repo-check --model gpt-5.6-sol -c model_reasoning_effort=ultra "<论纲+四题+repo 路径+唯一写文件>"
```
- 战略/设计题用 **ultra**;代码审查用 xhigh(见 fleet-orchestration 第四闸)。
- Sol 全程只读(写权限红线,见 fleet-orchestration);后台跑,长思考勿催。
- 大单先跟 founder 打招呼(吃他 ChatGPT plan 限额)。

## 教训(append-only)

1. Sol 的判词犀利但**不知道 founder 的开发方法论**(城=非技术 founder 的决策介质、mock 即 spec)——凡涉"该不该建"的判词先过这层滤镜再采纳。
2. 它引用的官方链接可信度高,但**基准/竞品数字必须抽核**(R1 的 Meta Business Agent 经独立核实为真,才升格为战略输入)。
3. 已确定成果:R1=授权-回执脊柱+竞争格局改判;R2=Otto 存在契约(一个 Otto 多份档案/dock 注意力面/认识论动词/试用班);均已裁定归档。
