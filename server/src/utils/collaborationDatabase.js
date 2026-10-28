export function assertCollaborationTestDatabase(value) {
    let url;
    try { url = new URL(value); } catch { throw new Error('Disposable collaboration database required'); }
    // pg-connection-string allows ?host= and ?port= to override the authority.
    // This fixed test profile needs no URL options: reject them all rather than
    // validating one destination and letting the driver connect to another.
    if (!['postgres:', 'postgresql:'].includes(url.protocol)
        || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
        || url.pathname !== '/covai_collaboration_test'
        || url.port !== '55432' || url.search || url.hash) {
        throw new Error('Disposable collaboration database required');
    }
    return url;
}
