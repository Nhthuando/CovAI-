import { fail } from './common.js';
import { probeProjectChatbot, projectTurnExecutor } from './projectAdapter.service.js';
import { probeChainlitChatbot, chainlitTurnExecutor } from './chainlitTransport.service.js';

// Server-owned registrations. Imported repositories cannot execute adapter plugins.
const adapters = Object.freeze([
    Object.freeze({ id: 'http-chat', version: '2', protocols: ['HTTP_JSON', 'HTTP_SSE', 'HTTP_NDJSON'], matches: candidate => ['NODE_HTTP', 'NEXT', 'FASTAPI', 'PYTHON_HTTP'].includes(candidate.framework), probe: probeProjectChatbot, executor: projectTurnExecutor }),
    Object.freeze({ id: 'chainlit-socketio', version: '1', protocols: ['CHAINLIT_SOCKET_IO'], matches: candidate => candidate.framework === 'CHAINLIT', probe: probeChainlitChatbot, executor: chainlitTurnExecutor }),
]);

export const projectAdapterCatalog = () => adapters.map(({ id, version, protocols }) => ({ id, version, protocols: [...protocols] }));
export function projectAdapterOptions(candidate) {
    return adapters.filter(adapter => adapter.matches(candidate)).map(({ id, version, protocols }) => ({ id, version, protocols: [...protocols] }));
}
export function selectProjectAdapter(candidate) {
    const supported = adapters.filter(adapter => adapter.matches(candidate));
    if (supported.length !== 1) fail('CHATBOT_ADAPTER_UNSUPPORTED', 'No adapter matches the identified protocol/runtime. Evaluation was not performed.');
    const adapter = supported[0];
    return {
        id: adapter.id, version: adapter.version,
        probe: async (runtime, options) => {
            const contract = await adapter.probe(runtime, candidate, options);
            const protocol = contract.protocol || adapter.protocols[0];
            if (!adapter.protocols.includes(protocol)) fail('CHATBOT_ADAPTER_MISMATCH', 'Observed protocol does not match the selected adapter');
            return { ...contract, protocol, adapter: { id: adapter.id, version: adapter.version } };
        },
        executor: (runtime, contract) => adapter.executor(runtime, contract),
    };
}
