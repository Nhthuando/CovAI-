import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

const BATCH_SIZE = 500;

// Keep row IDs and unrelated files intact while avoiding one remote round trip
// per file inside the publication transaction. All values remain parameters.
export async function upsertCoverageFileRows(tx, rows) {
    const unique = new Map(rows.map(row => [JSON.stringify([row.snapshotId, row.filePath]), row]));
    const data = [...unique.values()];
    if (typeof tx.$executeRaw !== 'function') {
        // Compatibility with lightweight clients/test doubles without raw SQL.
        for (const row of data) {
            const { snapshotId, filePath, ...metrics } = row;
            await tx.coverageFile.upsert({ where: { snapshotId_filePath: { snapshotId, filePath } }, create: row, update: metrics });
        }
        return;
    }
    for (let offset = 0; offset < data.length; offset += BATCH_SIZE) {
        const values = data.slice(offset, offset + BATCH_SIZE).map(row => Prisma.sql`(${randomUUID()}, ${row.snapshotId}, ${row.filePath}, ${row.linesPct}, ${row.branchesPct}, ${row.funcsPct}, ${row.stmtsPct})`);
        await tx.$executeRaw(Prisma.sql`
            INSERT INTO "CoverageFile" ("id", "snapshotId", "filePath", "linesPct", "branchesPct", "funcsPct", "stmtsPct")
            VALUES ${Prisma.join(values)}
            ON CONFLICT ("snapshotId", "filePath") DO UPDATE SET
                "linesPct" = EXCLUDED."linesPct", "branchesPct" = EXCLUDED."branchesPct",
                "funcsPct" = EXCLUDED."funcsPct", "stmtsPct" = EXCLUDED."stmtsPct"
        `);
    }
}
