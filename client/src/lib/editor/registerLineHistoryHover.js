import { getLineHistory } from '../../services/projectEditor.service';
const cache = new Map();
const pending = new Map();
const remember = (key, history) => {
  cache.delete(key); cache.set(key, { history, at: Date.now() });
  while (cache.size > 512) cache.delete(cache.keys().next().value);
};
const escape = value => String(value ?? '').replace(/[\\`*_{}[\]()#+!|<>]/g, '\\$&');
export function registerLineHistoryHover(monaco, editor, scope, getProvider) {
  return monaco.languages.registerHoverProvider('*', {
    async provideHover(model, position, token) {
      if (model !== editor.getModel()) return null;
      const provider = getProvider();
      if (provider?.queue.length) return { contents: [{ value: 'Unsynced edit', isTrusted: false }] };
      const identity = provider?.identity;
      const input = { snapshotId: scope.snapshotId, path: identity?.path || scope.path, line: position.lineNumber,
        ...(identity ? { documentId: identity.documentId, generation: identity.generation, revision: provider.revision } : {}) };
      const auth = localStorage.getItem('token');
      const modelVersion = model.getVersionId();
      const keyFor = line => JSON.stringify([auth, scope.projectId, { ...input, line }, identity ? null : modelVersion]);
      const key = keyFor(input.line);
      try {
        const hit = cache.get(key);
        let history = hit && Date.now() - hit.at < 5000 ? hit.history : null;
        if (!history) {
          let request = pending.get(key);
          if (!request) {
            // Hover cancellation must not abort a request shared with another
            // hover. Bound its lifetime and retain the result for nearby lines.
            request = getLineHistory(scope.projectId, input, AbortSignal.timeout(5000)).then(result => {
              if (localStorage.getItem('token') !== auth) return result;
              remember(key, result);
              for (const range of result.nearby || []) for (let line = range.start; line <= range.end; line++) {
                remember(keyFor(line), { ...range, line, contentHash: result.contentHash });
              }
              return result;
            }).finally(() => pending.delete(key));
            pending.set(key, request);
          }
          history = await request;
        }
        if (token.isCancellationRequested || localStorage.getItem('token') !== auth || model !== editor.getModel() || getProvider() !== provider || provider?.disposed
          || (identity ? provider.revision !== input.revision || provider.identity?.documentId !== input.documentId || provider.identity?.generation !== input.generation : model.getVersionId() !== modelVersion)) return null;
        const title = history.source === 'AI_APPLY' ? `AI-generated · Applied by ${history.actorName}`
          : history.actorName ? `Last edited by ${history.actorName}` : history.source === 'GIT' ? `Git author: ${history.author}` : 'No line history available';
        const detail = [history.timestamp && new Date(history.timestamp).toLocaleString('en-GB'), history.commit?.slice(0, 8), history.summary].filter(Boolean).map(escape).join(' · ');
        return { range: new monaco.Range(position.lineNumber, 1, position.lineNumber, model.getLineMaxColumn(position.lineNumber)), contents: [{ value: `${escape(title)}${detail ? `\n\n${detail}` : ''}`, isTrusted: false, supportHtml: false }] };
      } catch { return null; }
    },
  });
}
