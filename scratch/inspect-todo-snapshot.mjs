import prisma from '../server/src/config/prisma.js';
import fs from 'node:fs';
import path from 'node:path';
const snapshot = await prisma.projectSnapshot.findUnique({where: {id:'cmutfh1uo0001co7k8lgrfm6y'}, select:{rootDir:true}});
if (snapshot?.rootDir) {
  console.log('Snapshot directory:', snapshot.rootDir);
  console.log('Root files:', fs.readdirSync(snapshot.rootDir));
  const pkg = path.join(snapshot.rootDir, 'package.json');
  if (fs.existsSync(pkg)) console.log(fs.readFileSync(pkg,'utf8'));
}
const output = await prisma.jobOutput.findUnique({where:{jobId:'cmutfluso000lco7kifhdvpte'},select:{stdout:true,stderr:true}});
if (output) {
  console.log('stderr:', output.stderr);
  try {
    const report = JSON.parse(output.stdout);
    console.log('runner errors:', report.errors);
    const walk = (suite) => {
      for (const spec of suite.specs || []) for (const test of spec.tests || []) {
        console.log('test:', spec.title, test.status, (test.results || []).map(result => result.error?.message));
      }
      for (const child of suite.suites || []) walk(child);
    };
    for (const suite of report.suites || []) walk(suite);
  } catch { console.log('output tail:', output.stdout?.slice(-1800)); }
}
await prisma.$disconnect();
