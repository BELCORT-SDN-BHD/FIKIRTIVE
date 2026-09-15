import {test,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {seedWorkspace,seedThread,seedPlanCard,readAccount} from '../../../../../e2e/support/seed.js';
import {signIn} from '../../../../../e2e/support/auth.js';
import {appEnv} from '../../../../../e2e/support/env.js';
import {prisma} from '../../../../../e2e/support/db.js';
import {buildGenRequestFromCard} from '../../../../../packages/core/dist/gen-from-card.js';
import {genRequest,DEFAULT_IMAGE_MODEL} from '../../../../../packages/core/dist/gen.js';
import {pricedGenCredits,INTERNAL_PER_DISPLAY} from '../../../../../packages/core/dist/spend.js';
import {storageKey} from '../../../../../packages/core/dist/index.js';

test('Local $0: browser confirmation -> queue -> independent mock-provider worker -> file and settlement -> UI',async({page})=>{
 const root=process.cwd();
 const logPath=path.join(root,'docs/audits/fullstack-staging-2026-09-14/local-logs');
 const workerLog=fs.openSync(path.join(logPath,'fullstack-worker.log'),'w');
 const worker=spawn('pnpm',['--filter','@fikirtive/worker','exec','tsx','src/index.ts'],{
  cwd:root,detached:true,stdio:['ignore',workerLog,workerLog],
  env:{PATH:process.env.PATH!,HOME:process.env.HOME!,...appEnv(),NODE_ENV:'test',GENERATION_PROVIDER:'mock',WORKER_ROLE:'all',ASSET_UNDERSTANDING:'off',FIKIRTIVE_DATA_DIR:path.join(root,'.data/storage')},
 });
 try {
  await expect.poll(()=>fs.readFileSync(path.join(logPath,'fullstack-worker.log'),'utf8'),{timeout:60000}).toContain('[worker] started');
  const ws=await seedWorkspace({slug:'round3-fullstack',workspaceName:'Round three local cafe',personName:'Local merchant',openingGrant:100});
  const {threadId}=await seedThread(ws);
  const {cardId}=await seedPlanCard(ws,threadId,{seq:1,credits:1,prompt:'Round three local smoke: a blue cup on a wooden table'});
  const card=await prisma.chatMessage.findFirstOrThrow({where:{id:cardId,ownerId:ws.orgId}});
  const payload={...(card.payload as Record<string,unknown>),model:DEFAULT_IMAGE_MODEL};
  const built=buildGenRequestFromCard({cardPayload:payload,projectId:ws.projectId,threadId,cardId,entityIds:[],variantSel:{}});
  expect(built.ok).toBe(true);if(!built.ok)throw new Error(built.error);
  expect(genRequest.safeParse(built.req).success).toBe(true);
  const quote=pricedGenCredits({kind:'IMAGE',model:DEFAULT_IMAGE_MODEL,count:1,videoOptions:null});
  expect(quote).toBe(INTERNAL_PER_DISPLAY);
  await prisma.chatMessage.update({where:{id:cardId,ownerId:ws.orgId},data:{payload}});
  const before=await readAccount(ws);
  await signIn(page,ws,"/");
  await page.goto(`/create/canvas?project=${ws.projectId}&thread=${threadId}`);
  const confirmation=page.getByLabel('Generation confirmation').first();
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button',{name:/Generate · 1 credit/}).click();
  await expect.poll(async()=>{
   const jobs=await prisma.genJob.findMany({where:{ownerId:ws.orgId,threadId}});
   return jobs.length===1?jobs[0].status:`count:${jobs.length}`;
  },{timeout:90000}).toBe('DONE');
  const jobs=await prisma.genJob.findMany({where:{ownerId:ws.orgId,threadId}});
  expect(jobs).toHaveLength(1);
  const gens=await prisma.generation.findMany({where:{ownerId:ws.orgId,projectId:ws.projectId}});
  expect(gens).toHaveLength(1);
  const asset=await prisma.asset.findFirstOrThrow({where:{id:gens[0].assetId,ownerId:ws.orgId}});
  expect(fs.statSync(path.join(root,'.data/storage',storageKey(ws.orgId,asset.contentHash,asset.ext))).size).toBeGreaterThan(0);
  const ledger=await prisma.creditLedger.findMany({where:{orgId:ws.orgId,refId:jobs[0].id}});
  expect(ledger.filter(x=>x.kind==='RESERVE')).toHaveLength(1);
  expect(ledger.filter(x=>x.kind==='SETTLE')).toHaveLength(1);
  expect(ledger.filter(x=>x.kind==='REFUND')).toHaveLength(0);
  const after=await readAccount(ws);
  expect(after.reserved).toBe(0);
  expect(before.balance-after.balance).toBe(quote);
  expect(ledger.find(x=>x.kind==='RESERVE')?.reservedDelta).toBe(quote);
  expect(ledger.find(x=>x.kind==='RESERVE')?.balanceDelta).toBe(-quote);
  expect(ledger.find(x=>x.kind==='SETTLE')?.balanceDelta).toBe(0);
  expect(ledger.find(x=>x.kind==='SETTLE')?.reservedDelta).toBe(-quote);
  // The page must learn the terminal result without a reload.
  await expect(page.getByLabel('Otto current turn')).not.toContainText('Generating',{timeout:30000});
  await expect(page.locator('img[src*="'+asset.contentHash+'"]')).not.toHaveCount(0,{timeout:30000});
  await page.screenshot({path:path.join(logPath,'fullstack-result.png'),fullPage:true});
  fs.writeFileSync(path.join(logPath,'fullstack-evidence.json'),JSON.stringify({boundary:'Seeded Otto card; mock generation provider; real browser/Web/queue/worker/database/storage',workspace:ws.orgId,threadId,cardId,jobs,generations:gens,asset,ledger,before,after},(_,v)=>typeof v==='bigint'?String(v):v,2));
 } finally {
  if(worker.pid){try{process.kill(-worker.pid,'SIGTERM');}catch{}}
  await prisma.$disconnect();fs.closeSync(workerLog);
 }
});
