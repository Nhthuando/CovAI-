// Development-only entry point used by server/e2e/system-dashboard.spec.mjs.
// The entire production dashboard talks to the configured, authenticated API.
/* eslint-disable react-refresh/only-export-components -- isolated browser test entry point */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import SystemTestDashboard from '../src/components/dashboard/SystemTestDashboard.jsx';
import '../src/index.css';

function Fixture() {
  const [visible, setVisible] = useState(true);
  const query = new URLSearchParams(location.search);
  return <BrowserRouter><button type="button" onClick={() => setVisible(value => !value)} className="m-4 rounded border px-3 py-2 text-sm">{visible ? 'Leave test dashboard' : 'Return to test dashboard'}</button>{visible ? <SystemTestDashboard projectId={query.get('projectId')} snapshotId={query.get('snapshotId')} /> : <p className="m-4">Another workspace view</p>}</BrowserRouter>;
}
document.documentElement.dataset.theme = 'dark';
createRoot(document.getElementById('root')).render(<Fixture />);
