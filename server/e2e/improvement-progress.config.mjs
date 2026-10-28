import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'.',testMatch:'improvement-progress.spec.mjs',workers:1,timeout:30000,outputDir:'../../tmp/improvement-progress-e2e',reporter:'list',use:{headless:true,viewport:{width:1440,height:850},trace:'retain-on-failure'}});
