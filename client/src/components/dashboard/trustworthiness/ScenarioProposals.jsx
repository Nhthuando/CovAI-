import { useState } from 'react';
import { ListPlus, Sparkles } from 'lucide-react';
import { Button } from '../../ui/button';
import { Panel } from './ui';
import { QuestionStack } from './questionUi';

export default function ScenarioProposals({ proposal, version, draft, busy, onAdd }) {
  const [selected, setSelected] = useState(null);
  const proposed = proposal.data?.result?.cases || [];
  if (!proposed.length) return null;
  return (
    <Panel title={<span className="inline-flex items-center gap-2"><Sparkles className="size-4 text-[var(--color-primary)]" aria-hidden="true" />Proposed questions <span className="font-mono tabular-nums text-[var(--color-text-muted)]">{proposed.length}</span></span>}
      description="Open a question to check it before adding it to your draft."
      actions={<Button disabled={busy || !draft || proposal.data.result.revision !== version.revision}
        onClick={() => onAdd(proposed)}><ListPlus aria-hidden="true" />Add all to draft</Button>}>
      <QuestionStack items={proposed} selectedIndex={selected} onSelect={setSelected} />
    </Panel>
  );
}
