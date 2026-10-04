import prisma from "../src/config/prisma.js";

async function main() {
  for (const snapId of ['cmusc1jkj00th2ho24qw20rqa', 'cmus89czq00012ho2hsprbnha']) {
    const summary = await prisma.coverageSummary.findMany({
      where: { snapshotId: snapId },
      orderBy: { createdAt: 'desc' },
      take: 2
    });
    console.log(`=== Snapshot ${snapId} Summary ===`);
    console.log(JSON.stringify(summary, null, 2));

    const files = await prisma.coverageFile.findMany({
      where: { snapshotId: snapId },
      select: {
        filePath: true,
        stmtsPct: true,
        branchesPct: true,
        funcsPct: true,
        linesPct: true
      }
    });
    console.log(`File count: ${files.length}`);
    console.log('Files with < 98% statements coverage:');
    const lowFiles = files.filter(f => f.stmtsPct !== null && f.stmtsPct < 98);
    for (const f of lowFiles) {
      console.log(`- ${f.filePath}: stmts=${f.stmtsPct}%, branches=${f.branchesPct}%, funcs=${f.funcsPct}%, lines=${f.linesPct}%`);
    }
    console.log(`Total <98% files: ${lowFiles.length} / ${files.length}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
