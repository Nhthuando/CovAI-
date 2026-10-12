import { useEffect, useRef, useState } from "react";
import { getSystemTestEvidence } from "../../../services/systemTest.service.js";

const waiting = [];
let active = 0;
const drain = () => {
  while (active < 3 && waiting.length) {
    const item = waiting.shift();
    if (item.signal.aborted) { item.reject(new Error("Cancelled")); continue; }
    active++;
    item.task().then(item.resolve, item.reject).finally(() => { active--; drain(); });
  }
};
const enqueue = (task, signal) => new Promise((resolve, reject) => {
  waiting.push({ task, signal, resolve, reject });
  drain();
});

export default function SystemTestEvidencePreview({ snapshotId, scenario, onEnlarge }) {
  const container = useRef(null);
  const [preview, setPreview] = useState({ url: null, state: "idle" });
  const hasScreenshot = !!scenario.evidence?.hasScreenshot;
  const id = scenario.id;

  useEffect(() => {
    if (!hasScreenshot || !snapshotId || !id) return;
    const controller = new AbortController();
    let objectUrl;
    let started = false;
    const load = () => {
      if (started || controller.signal.aborted) return;
      started = true;
      setPreview({ url: null, state: "loading" });
      enqueue(() => getSystemTestEvidence(snapshotId, id, "image", { signal: controller.signal }), controller.signal)
        .then(blob => {
          if (controller.signal.aborted) return;
          objectUrl = URL.createObjectURL(blob);
          setPreview({ url: objectUrl, state: "ready" });
        })
        .catch(() => { if (!controller.signal.aborted) setPreview({ url: null, state: "unavailable" }); });
    };
    const observer = typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { load(); observer.disconnect(); } }, { rootMargin: "200px" })
      : null;
    if (observer && container.current) observer.observe(container.current);
    else load();
    // Printing loads remaining previews, with the same concurrency limit.
    window.addEventListener("beforeprint", load);
    return () => {
      controller.abort();
      observer?.disconnect();
      window.removeEventListener("beforeprint", load);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [snapshotId, id, hasScreenshot]);

  const image = preview.url && <img src={preview.url} alt={`Screenshot: ${scenario.title}`} className="block max-h-64 max-w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] object-contain object-left" />;
  return (
    <figure ref={container} className="px-4 pb-4 pt-1 text-[11px] text-[var(--color-text-muted)] break-inside-avoid">
      {image ? (
        onEnlarge ? <button type="button" onClick={onEnlarge} className="block max-w-full cursor-zoom-in text-left" aria-label={`Enlarge screenshot for ${scenario.title}`}>{image}</button>
          : <a href={preview.url} target="_blank" rel="noreferrer" aria-label={`Enlarge screenshot for ${scenario.title}`}>{image}</a>
      ) : <div className="py-2" role="status">{!hasScreenshot ? "No screenshot captured for this scenario." : preview.state === "unavailable" ? "Screenshot unavailable. The evidence file could not be loaded." : preview.state === "loading" ? "Loading screenshot…" : "Screenshot loads when visible."}</div>}
      {image && <figcaption className="mt-1.5">Captured during execution · Click image to enlarge</figcaption>}
    </figure>
  );
}
