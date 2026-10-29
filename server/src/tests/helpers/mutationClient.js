// A transaction-aware in-memory client for focused filesystem failure tests.
// PostgreSQL locking and cross-process races are covered by the guarded DB suites.
export const createMutationTestClient = ({rootDir,snapshotId = 's',projectId = 'project',ownerId = 'owner'}) => {
    let state = {project:{id:projectId,ownerId,workspaceRevision:0,eventSequence:0},files:new Map(),mutations:new Map()};
    const snapshot = {id:snapshotId,projectId,rootDir,storagePath:rootDir,source:'ZIP'};
    const increment = (row,data) => Object.fromEntries(Object.entries(data).map(([key,value])=>[key,
        value && typeof value === 'object' && 'increment' in value ? (row[key] || 0) + value.increment : value]));
    const client = {
        $executeRaw:async()=>1,
        $transaction:async function(run) {
            const before = structuredClone(state);
            try { return await run(this); }
            catch(error) { state = before;throw error; }
        },
        project:{
            findFirst:async ({where})=> {
                if (where.id !== projectId || where.ownerId && where.ownerId !== ownerId
                    || where.OR && !where.OR.some(clause=>clause.ownerId === ownerId)) return null;
                return {...state.project};
            },
            update:async ({data})=> {Object.assign(state.project,increment(state.project,data));return {...state.project};},
        },
        projectSnapshot:{
            findFirst:async ({where})=>where.projectId && where.projectId !== projectId || where.id && where.id !== snapshotId ? null : {...snapshot},
            findUnique:async ({where})=>where.id === snapshotId ? {...snapshot} : null,
        },
        projectMember:{findUnique:async()=>null},
        projectFileVersion:{
            findUnique:async ({where})=>state.files.get(where.snapshotId_relativePath.relativePath) || null,
            create:async ({data})=> {const row={id:`v-${state.files.size}`,...data};state.files.set(data.relativePath,row);return row;},
            update:async ({where,data})=> {
                const key = where.snapshotId_relativePath.relativePath;
                const row = state.files.get(key);const next={...row,...increment(row,data)};state.files.set(key,next);return next;
            },
            upsert:async ({where,create,update})=> {
                const key = where.snapshotId_relativePath.relativePath;
                const row=state.files.get(key);const next=row ? {...row,...increment(row,update)} : {...create};state.files.set(key,next);return next;
            },
        },
        projectMutation:{
            findUnique:async ({where})=>state.mutations.get(where.projectId_requestId.requestId) || null,
            create:async ({data})=> {const row={id:`m-${state.mutations.size}`,...data};state.mutations.set(data.requestId,row);return row;},
            update:async ({where,data})=> {
                const row=[...state.mutations.values()].find(item=>item.id === where.id);const next={...row,...data};state.mutations.set(row.requestId,next);return next;
            },
        },
        projectEvent:{create:async ({data})=>({id:'event',...data})},
    };
    return client;
};
