process.env.OPENAI_AGENTS_DISABLE_TRACING = "1";
import { it, expect, vi } from "vitest";
vi.mock("@fikirtive/db", () => ({ prisma: { chatMessage: { findFirst: vi.fn(async()=>null) } } }));
import { prisma } from "@fikirtive/db";
import { tryRestoreRunStateWithContext } from "../../../packages/otto/src/run-input";
import { Usage } from "@openai/agents";
import { createOttoRuntime, runOttoTurn, finalizeOttoTurn } from "../../../packages/otto/src/runtime";
import { generateSkill, executeGenerate } from "../../../packages/otto/src/skills/generate";
import { llmPricesFor } from "@fikirtive/core";
import { mapOttoUsage } from "../../../packages/otto/src/meter";
import { canvasTurnStatus } from "../../../apps/web/lib/otto-canvas-turn";
const promiseText = "Sorry! Let me call up the generate cards for both shots now.";
const cardId = "fixture-storyboard-card";
async function park() {
 const message = {type:"message", role:"assistant", status:"completed", content:[{type:"output_text",text:promiseText}]};
 const call = {type:"function_call",callId:"fixture-call",name:"generate",arguments:JSON.stringify({cardId}),status:"completed"};
 const model = {async getResponse(){return {usage:new Usage({inputTokens:3,outputTokens:2,totalTokens:5}),output:[message,call]}},async *getStreamedResponse(){yield {type:"response_done",response:{id:"fixture",usage:{inputTokens:3,outputTokens:2,totalTokens:5},output:[message,call]}}}};
 const runtime = createOttoRuntime({modelRuntime:{binding:model as any,billableModelId:"fixture-no-charge",resolvedModelPolicy:{primaryModelId:"fixture",fallbackModelId:null,failover:"none"},mapUsage:mapOttoUsage,cacheCapabilities:{promptCache:false},pricing:()=>llmPricesFor("claude-sonnet-4-6")},skills:[generateSkill]},"interactive");
 const startGen=vi.fn();
 const context={orgId:"fixture-org",userId:"fixture-user",projectId:"fixture-project",threadId:"fixture-thread",disabledModels:[],sourceGenerationId:null,startGen};
 const result=await runOttoTurn({orgId:context.orgId,refId:"fixture-run",input:"where is the card?",stream:true,onStream:async r=>{for await(const event of r){}}},context,runtime);
 return {fin:finalizeOttoTurn(result,runtime),startGen,context,runtime};
}
it("actual SDK generate interruption must not finish as Ready plus a promise when no GEN_CARD exists",async()=>{
 const {fin,startGen}=await park();
 expect(fin.interrupted).toBe(true);
 expect(fin.approvals).toEqual([{toolName:"generate",ref:cardId,args:{cardId}}]);
 expect(startGen).not.toHaveBeenCalled();
 expect(fin.text).toBe(promiseText);
 // No GEN_CARD exists in the observed turn. Actual component counts only current-turn GEN_CARDs.
 const status=canvasTurnStatus({isBusy:false,hasAssistantText:true,liveStatus:{kind:"needs_approval",pendingCardIds:fin.approvals.map(a=>a.ref)},steps:[],workingCardCount:0,pendingConfirmCount:0});
 console.log(JSON.stringify({interrupted:fin.interrupted,approvals:fin.approvals.length,executed:startGen.mock.calls.length,status:status.label,text:fin.text}));
 expect(status.label,"approval interruption is invisible behind Ready").not.toBe("Ready");
});
it("wrong storyboard reference is rejected only when execute is reached",async()=>{
 const {context,startGen}=await park();
 expect(await executeGenerate({cardId},{context} as any)).toEqual({error:"Card not found."});
 expect(startGen).not.toHaveBeenCalled();
});

it("H1: only a visible confirmation card changes Ready; live pending IDs alone do not",()=>{
 const base={isBusy:false,hasAssistantText:true,liveStatus:{kind:"needs_approval" as const,pendingCardIds:[cardId]},steps:[],workingCardCount:0,pendingConfirmCount:0};
 expect(canvasTurnStatus(base).label).toBe("Ready");
 expect(canvasTurnStatus({...base,pendingConfirmCount:1}).label).toBe("Needs confirmation");
 expect(canvasTurnStatus({...base,liveStatus:null}).label).toBe("Ready");
});
it("H2/H3: park never validates card; serialized SDK interruption survives restoration",async()=>{
 vi.mocked(prisma.chatMessage.findFirst).mockClear();
 const {fin,context,runtime}=await park();
 expect(prisma.chatMessage.findFirst).not.toHaveBeenCalled();
 const restored=await tryRestoreRunStateWithContext(runtime.agent,fin.newOttoState,context);
 expect(restored!.getInterruptions()).toHaveLength(1);
 expect(restored!.getInterruptions()[0].rawItem.name).toBe("generate");
 expect(prisma.chatMessage.findFirst).not.toHaveBeenCalled();
 await executeGenerate({cardId},{context} as any);
 expect(prisma.chatMessage.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({id:cardId,kind:"GEN_CARD"})}));
});
