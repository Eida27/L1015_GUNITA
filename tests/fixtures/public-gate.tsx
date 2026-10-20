import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import {
  PreferencesProvider,
  PreferenceControls,
} from '../../src/components/ui/preferences';
import {
  PublicContentGate,
  type PublicContentLoader,
} from '../../src/components/ui/public-content-gate';
import { Dialog } from '../../src/components/ui/dialog';
import { EmptyState } from '../../src/components/ui/states';
const load: PublicContentLoader = async (signal) => {
  const response = await fetch('/__test/content', { signal });
  if (!response.ok) throw new Error('Test transport unavailable');
  const data = await response.json();
  return function Content() {
    return <p data-testid="authored-content">{data.body}</p>;
  };
};
function App() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <PreferenceControls />
      <main id="main">
        <h1>Harness</h1>
        <PublicContentGate load={load} />
        <button onClick={() => setOpen(true)}>Open sheet</button>
        {open ? (
          <Dialog titleId="sheet-title" onClose={() => setOpen(false)}>
            <h2 id="sheet-title">Sheet</h2>
            <EmptyState />
            <button>Last control</button>
          </Dialog>
        ) : null}
      </main>
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <PreferencesProvider>
    <App />
  </PreferencesProvider>,
);
