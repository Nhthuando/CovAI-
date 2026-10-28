import { assertCollaborationTestDatabase } from './helpers/collaborationDb.js';

test.each([
    'postgresql://u:p@db.example.com/main',
    'postgresql://u:p@localhost:5432/covai_collaboration_test',
    'postgresql://u:p@127.0.0.1:55432/main',
    'not-a-url',
    'postgresql://u:p@127.0.0.1:55432/covai_collaboration_test?host=example.invalid&port=5432',
    'postgresql://u:p@127.0.0.1:55432/covai_collaboration_test?hostaddr=192.0.2.1',
    'postgresql://u:p@127.0.0.1:55432/covai_collaboration_test?dbname=developer',
    'postgresql://u:p@127.0.0.1:55432/covai_collaboration_test#override',
])('rejects non-disposable database %s', value => {
    expect(() => assertCollaborationTestDatabase(value)).toThrow('Disposable collaboration database required');
});
test('accepts the isolated local database', () => {
    expect(() => assertCollaborationTestDatabase('postgresql://u:p@127.0.0.1:55432/covai_collaboration_test')).not.toThrow();
});
