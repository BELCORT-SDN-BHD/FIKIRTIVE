import {defineConfig} from '@playwright/test';
import base from './playwright.config.js';
export default defineConfig({...base,globalSetup:undefined,testMatch:'readback.spec.ts',outputDir:'../fullstack-readback-artifacts',reporter:[['list']]});
