import { useState } from 'react';

// Defer first mount/network work until visited, then retain drafts and UI state.
export default function RetainedPanel({ active, children }) {
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);
  return active || visited ? children : null;
}
