import fs from 'node:fs/promises';
import path from 'node:path';
import { createLocalProjectBucket } from '../config/localProjectStorage.js';

test('local storage roundtrips and scopes listing/deletion without public file URLs', async () => {
    const root = await fs.mkdtemp(path.resolve('../tmp/local-storage-test-'));
    try {
        const bucket = createLocalProjectBucket(root);
        await bucket.file('projects/one/a.txt').save('first');
        await bucket.file('projects/two/b.txt').save('second');
        expect((await bucket.file('projects/one/a.txt').download())[0].toString()).toBe('first');
        expect((await bucket.getFiles({ prefix: 'projects/one/' }))[0].map(file => file.name)).toEqual(['projects/one/a.txt']);
        expect(() => bucket.file('../escape')).toThrow('Invalid storage path');
        await bucket.file('projects/one/a.txt').delete();
        expect(await bucket.file('projects/one/a.txt').exists()).toEqual([false]);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});
