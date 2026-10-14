import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
function App() {
  const [items, setItems] = useState([]), [name, setName] = useState(''), [error, setError] = useState('');
  const load = async () => setItems(await (await fetch('/api/items')).json());
  useEffect(() => { load(); }, []);
  const submit = async event => {
    event.preventDefault();
    const response = await fetch('/api/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    if (!response.ok) { setError((await response.json()).error); return; }
    setError(''); setName(''); await load();
  };
  return <main><h1>Items</h1><form onSubmit={submit}><label>Name<input value={name} onChange={event => setName(event.target.value)} /></label><button type="submit">Add</button></form>{error && <p role="alert">{error}</p>}<ul>{items.map((item, index) => <li key={index}>{item.name}</li>)}</ul></main>;
}
createRoot(document.getElementById('root')).render(<App />);
