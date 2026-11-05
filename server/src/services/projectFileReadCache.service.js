const reads = new Map();
const keyFor = ({ projectId, snapshotId, userId, path }) => JSON.stringify([projectId, snapshotId, userId,
    process.platform === 'win32' ? path.replaceAll('\\', '/').toLowerCase() : path]);
export function recentProjectFileRead(scope) {
    const item = reads.get(keyFor(scope));
    return item && Date.now() - item.at < 2000 ? item.file : null;
}
export function rememberProjectFileRead(scope, file) {
    const key = keyFor({ ...scope, snapshotId: file.snapshotId, path: file.path });
    reads.delete(key); reads.set(key, { at: Date.now(), file });
    let size = 0;
    for (const item of reads.values()) size += item.file.size;
    while (reads.size > 64 || size > 8 * 1024 * 1024) {
        const oldest = reads.keys().next().value;
        size -= reads.get(oldest).file.size; reads.delete(oldest);
    }
    return file;
}
