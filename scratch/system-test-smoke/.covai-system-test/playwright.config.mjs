import config from "file:///D:/HuuThuan%20-%20Project/NCKH/CovAI/scratch/system-test-smoke/playwright.config.mjs";
import path from 'node:path';
const root = "D:\\HuuThuan - Project\\NCKH\\CovAI\\scratch\\system-test-smoke";
const use = {...config.use, baseURL: "http://localhost:4177"};
export default {...config, testDir: path.resolve(root, config.testDir || '.'), webServer: undefined, use,
  projects: config.projects?.map(project => ({...project, testDir: path.resolve(root, project.testDir || config.testDir || '.'), use: {...use, ...project.use, baseURL: "http://localhost:4177"}}))};