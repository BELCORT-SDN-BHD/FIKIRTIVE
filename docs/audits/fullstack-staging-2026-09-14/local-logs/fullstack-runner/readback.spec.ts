import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {signIn} from '../../../../../e2e/support/auth.js';
import type {Workspace} from '../../../../../e2e/support/seed.js';

test('Read completed fixture after reopening; no worker, no Generate, no automatic-convergence claim',async({page})=>{
 const log=path.join(process.cwd(),'docs/audits/fullstack-staging-2026-09-14/local-logs');
 const evidence=JSON.parse(fs.readFileSync(path.join(log,'fullstack-evidence.json'),'utf8'));
 const job=evidence.jobs[0];const gen=evidence.generations.find((x:any)=>x.projectId===job.projectId);
 const asset=evidence.assets.find((x:any)=>x.id===gen.assetId);
 await signIn(page,{email:'round3-fullstack@e2e.test'} as Workspace,'/');
 await page.goto(`/create/canvas?project=${job.projectId}&thread=${job.threadId}`);
 const img=page.locator(`img[src*="${asset.contentHash}"]`).first();
 await expect(img).toBeVisible({timeout:30000});
 await expect.poll(()=>img.evaluate((el:HTMLImageElement)=>el.complete&&el.naturalWidth>0)).toBe(true);
 await expect(page.getByLabel('Otto current turn')).not.toContainText('Generating');
 await page.screenshot({path:path.join(log,'fullstack-readback.png'),fullPage:true});
 fs.writeFileSync(path.join(log,'fullstack-readback.json'),JSON.stringify({verdict:'completed result visible after reopening; original-page automatic convergence not checked',url:page.url(),assetId:asset.id,contentHash:asset.contentHash,imageSrc:await img.getAttribute('src')},null,2));
});
