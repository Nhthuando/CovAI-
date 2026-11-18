import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

const LEGAL_CONTENT = {
  privacy: {
    title: "Privacy Policy",
    updated: "2026-11-16",
    sections: [
      {
        heading: "Data we collect",
        paragraph: "CovAI collects your account email, uploaded project snapshots, and generated tests to provide test generation and coverage analysis. We also collect operational metrics described on our Data Telemetry page.",
      },
      {
        heading: "Processing and storage",
        paragraph: "Project snapshots and generated tests are stored with your account so you can access your work. User code runs in an isolated Docker sandbox, and relevant code and prompts are sent to Google Gemini to generate tests.",
      },
      {
        heading: "Retention and deletion",
        paragraph: "Project data is retained while needed to provide your workspace and its results. You can request deletion of your projects or account; backup copies may remain until their scheduled expiration, and records required by law may be retained longer.",
      },
      {
        heading: "Contact and privacy requests",
        paragraph: "Contact the CovAI team through the support channel provided with your account to request access, correction, or deletion of your data. Include your account email and the project concerned, without sharing passwords or secrets.",
      },
    ],
  },
  terms: {
    title: "Terms of Service",
    updated: "2026-11-16",
    sections: [
      {
        heading: "Acceptable use",
        paragraph: "Use CovAI only for projects you are authorized to process and in compliance with applicable law. Do not upload malicious workloads, attempt to escape the sandbox, or interfere with other users or the service.",
      },
      {
        heading: "Ownership of your work",
        paragraph: "You retain ownership of your code and generated tests. You authorize CovAI to process your project, execute it in an isolated Docker sandbox, and send relevant inputs to Google Gemini to provide the requested features.",
      },
      {
        heading: "Sandbox and usage limits",
        paragraph: "Runs are subject to resource, execution-time, and usage limits, and may be stopped when those limits are reached. Review generated tests before using them and avoid uploading credentials or other secrets.",
      },
      {
        heading: "Service availability",
        paragraph: "Availability and generation quality can vary with maintenance, capacity, and third-party services such as Google Gemini. CovAI does not guarantee uninterrupted access, successful runs, or complete test coverage.",
      },
      {
        heading: "Responsibility and liability",
        paragraph: "You are responsible for validating generated output and deciding whether it is suitable for your project. To the extent permitted by law, CovAI is provided as available without warranties, and the team is not liable for indirect losses arising from use of the service.",
      },
    ],
  },
  telemetry: {
    title: "Data Telemetry",
    updated: "2026-11-16",
    sections: [
      {
        heading: "Metrics we collect",
        paragraph: "CovAI collects run counts, run durations, token usage, and error codes to understand service performance and resource consumption. These metrics help identify failed runs and capacity needs.",
      },
      {
        heading: "Source code stays out of telemetry",
        paragraph: "Telemetry does not include source code, project snapshots, generated tests, or prompt contents. Code processing for sandbox execution and Google Gemini test generation is described separately in the Privacy Policy.",
      },
      {
        heading: "How metrics are used",
        paragraph: "Operational metrics support reliability monitoring, troubleshooting, and usage accounting. Access should be limited to the team members who need these metrics to operate the service.",
      },
      {
        heading: "Opt out and contact",
        paragraph: "Contact the CovAI team through the support channel provided with your account to request an opt-out from optional usage analytics. Essential operational metrics may still be needed to run the service and account for resource usage; the team can explain which metrics remain necessary.",
      },
    ],
  },
};

export default function LegalPage({ section }) {
  const { title, updated, sections } = LEGAL_CONTENT[section];

  useEffect(() => {
    window.scrollTo(0, 0);
    document.title = `${title} · CovAI`;
  }, [section, title]);

  return (
    <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="mx-auto max-w-3xl px-6 py-5">
          <Link to="/" className="inline-flex items-center gap-2 rounded-md text-sm text-[var(--color-primary)] hover:underline">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to home
          </Link>
        </div>
      </div>
      <article className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">Last updated: {updated}</p>
        <div className="mt-10 space-y-8">
          {sections.map(({ heading, paragraph }) => (
            <section key={heading}>
              <h2 className="text-xl font-semibold">{heading}</h2>
              <p className="mt-3 leading-relaxed text-[var(--color-text-secondary)]">{paragraph}</p>
            </section>
          ))}
        </div>
        <nav aria-label="Other legal pages" className="mt-12 flex flex-wrap gap-6 border-t border-[var(--color-border)] pt-6 text-sm">
          {Object.entries(LEGAL_CONTENT)
            .filter(([key]) => key !== section)
            .map(([key, page]) => (
              <Link key={key} to={`/${key}`} className="rounded-md text-[var(--color-primary)] hover:underline">
                {page.title}
              </Link>
            ))}
        </nav>
      </article>
    </main>
  );
}
