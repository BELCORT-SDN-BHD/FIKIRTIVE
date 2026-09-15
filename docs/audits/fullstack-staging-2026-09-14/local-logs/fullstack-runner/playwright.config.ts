import { defineConfig } from '@playwright/test';
import base from '../../../../../e2e/playwright.config.js';
import path from 'node:path';
const root=process.cwd();
export default defineConfig({ ...base, testDir:'.', testMatch:'fullstack.spec.ts', timeout:180000,
 globalSetup:path.join(root,'e2e/global-setup.ts'),
 outputDir:path.join(root,'docs/audits/fullstack-staging-2026-09-14/local-logs/fullstack-artifacts'),
 reporter:[['list'],['html',{outputFolder:path.join(root,'docs/audits/fullstack-staging-2026-09-14/local-logs/fullstack-report'),open:'never'}]],
 webServer:{...(base.webServer as object),cwd:root,reuseExistingServer:false},
});
