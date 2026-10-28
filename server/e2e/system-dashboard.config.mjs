import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: '.', testMatch:'system-dashboard.spec.mjs',
    workers:1, fullyParallel:false, timeout:120000,
    expect:{timeout:30000},
    outputDir:'../../tmp/dashboard-e2e-results',
    reporter:[['list']],
    use:{headless:true,actionTimeout:15000,navigationTimeout:20000,viewport:{width:1440,height:1000},trace:'retain-on-failure',screenshot:'only-on-failure'},
});
