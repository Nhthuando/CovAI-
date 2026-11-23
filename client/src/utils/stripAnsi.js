export function stripAnsi(text) {
  return String(text ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\[(?:\d{1,3}(?:;\d{1,3})*)m/g, '');
}
