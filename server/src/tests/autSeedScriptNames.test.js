import { test, expect } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runSeedDataIfPresent } from '../services/autLifecycle.service.js';

test('finds a prisma:seed script in a backend package', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-seed-name-'));
    fs.mkdirSync(path.join(root, 'backend'));
    fs.writeFileSync(path.join(root, 'backend', 'package.json'), JSON.stringify({ scripts: { start: 'node s.js', 'prisma:seed': 'node prisma/seed.js', 'seed:test': 'x' } }));
    // Frontend-only runs report the reserved seed without executing it, which proves the script was found.
    const result = await runSeedDataIfPresent({ snapshotDir: root, isolatedDatabase: false });
    expect(result).not.toEqual({ executed: false });
    fs.rmSync(root, { recursive: true, force: true });
});
