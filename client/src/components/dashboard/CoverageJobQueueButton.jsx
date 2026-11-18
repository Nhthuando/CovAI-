import { ListOrdered } from "lucide-react";
import Button from "../common/Button.jsx";

export default function CoverageJobQueueButton({ onClick, running }) {
  return (
    <Button variant="secondary" size="sm" icon={ListOrdered} onClick={onClick} title="View Job Queue and real-time execution logs">
      Job Queue
      {running && <span aria-label="Job running" className="ml-2 inline-block size-2 animate-ping rounded-full bg-[var(--color-success)]" />}
    </Button>
  );
}
