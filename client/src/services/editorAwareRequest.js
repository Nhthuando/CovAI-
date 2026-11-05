export async function prepareEditorRequest(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (method !== 'POST' || !/(?:run|analysis|generate|suggest|optimize|improvements|mutations|calculate|refresh|cfg\/build)/i.test(url) || /chat|ai-context/.test(url)) return options;
  const { flushMatchingEditors } = await import('../lib/editor/editorModelRegistry');
  await flushMatchingEditors(url);
  return options;
}
export async function editorAwareFetch(url, options) {
  return fetch(url, await prepareEditorRequest(String(url), options));
}
