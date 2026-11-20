import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Copy, Check, RotateCcw } from "lucide-react";

const SANDBOX_TIERS = {
  unit: {
    id: "unit",
    label: "Unit branch coverage",
    fileName: "src/services/paymentSettlement.ts",
    testFileName: "tests/unit/paymentSettlement.spec.ts",
    runner: "Vitest 2.1 · Babel CFG",
    initialCov: 42.0,
    healedCov: 96.4,
    complexity: "Cyclomatic complexity: 6",
    sourceLines: [
      { num: 1, code: "export async function settleInvoice(invoice, wallet) {", state: "covered" },
      { num: 2, code: "  if (!invoice || invoice.amount <= 0) {", state: "covered" },
      { num: 3, code: "    throw new RangeError('ERR_INVALID_INVOICE_AMOUNT');", state: "fault" },
      { num: 4, code: "  }", state: "covered" },
      { num: 5, code: "  const fxRate = wallet.currency === 'USD' ? 1 : wallet.fx;", state: "covered" },
      { num: 6, code: "  if (!fxRate || fxRate <= 0) {", state: "fault" },
      { num: 7, code: "    throw new Error('ERR_STALE_FX_ORACLE');", state: "fault" },
      { num: 8, code: "  }", state: "fault" },
      { num: 9, code: "  const required = invoice.amount * fxRate;", state: "covered" },
      { num: 10, code: "  if (wallet.availableBalance < required) {", state: "covered" },
      { num: 11, code: "    return { status: 'DECLINED', deficit: required - wallet.availableBalance };", state: "fault" },
      { num: 12, code: "  }", state: "covered" },
      { num: 13, code: "  return { status: 'SETTLED', txHash: '0x9f8c...31a', net: required };", state: "covered" },
      { num: 14, code: "}", state: "covered" },
    ],
    synthesizedLines: [
      "describe('settleInvoice() branch suite', () => {",
      "  it('rejects non-positive invoice amounts (line 3)', async () => {",
      "    await expect(settleInvoice({ amount: -15 }, { currency: 'USD' }))",
      "      .rejects.toThrow('ERR_INVALID_INVOICE_AMOUNT');",
      "  });",
      "",
      "  it('guards missing or zero FX oracle rate (lines 6-8)', async () => {",
      "    const wallet = { currency: 'EUR', fx: 0, availableBalance: 500 };",
      "    await expect(settleInvoice({ amount: 100 }, wallet))",
      "      .rejects.toThrow('ERR_STALE_FX_ORACLE');",
      "  });",
      "",
      "  it('returns exact deficit when balance is insufficient (line 11)', async () => {",
      "    const res = await settleInvoice({ amount: 200 }, {",
      "      currency: 'USD', availableBalance: 125",
      "    });",
      "    expect(res).toEqual({ status: 'DECLINED', deficit: 75 });",
      "  });",
      "});",
    ],
    cfgNodes: [
      { id: "B1", label: "Entry: settleInvoice", before: "verified", after: "verified" },
      { id: "B2", label: "amount <= 0", before: "fault", after: "verified" },
      { id: "B3", label: "fxRate <= 0", before: "fault", after: "verified" },
      { id: "B4", label: "balance < required", before: "fault", after: "verified" },
      { id: "B5", label: "Exit: settled receipt", before: "verified", after: "verified" },
    ],
  },
  integration: {
    id: "integration",
    label: "API contract matrix",
    fileName: "src/routes/v1/webhooks.controller.ts",
    testFileName: "tests/integration/webhooks.matrix.test.ts",
    runner: "Supertest · Ephemeral PostgreSQL",
    initialCov: 48.5,
    healedCov: 97.8,
    complexity: "12 endpoints · 3 auth roles",
    sourceLines: [
      { num: 1, code: "router.post('/v1/webhooks/stripe', verifyHmac, async (req, res) => {", state: "covered" },
      { num: 2, code: "  const sig = req.headers['stripe-signature'];", state: "covered" },
      { num: 3, code: "  if (!sig || !isValidTimestamp(sig)) {", state: "covered" },
      { num: 4, code: "    return res.status(401).json({ code: 'REPLAY_ATTACK_BLOCKED' });", state: "fault" },
      { num: 5, code: "  }", state: "covered" },
      { num: 6, code: "  const duplicate = await prisma.webhookEvent.findUnique({", state: "covered" },
      { num: 7, code: "    where: { eventId: req.body.id }, select: { id: true }", state: "covered" },
      { num: 8, code: "  });", state: "covered" },
      { num: 9, code: "  if (duplicate) {", state: "fault" },
      { num: 10, code: "    return res.status(200).json({ idempotent: true, skipped: true });", state: "fault" },
      { num: 11, code: "  }", state: "fault" },
      { num: 12, code: "  await queue.add('ledger:sync', { eventId: req.body.id });", state: "covered" },
      { num: 13, code: "  return res.status(202).json({ queued: true });", state: "covered" },
      { num: 14, code: "});", state: "covered" },
    ],
    synthesizedLines: [
      "describe('POST /v1/webhooks/stripe contract suite', () => {",
      "  it('returns 401 when HMAC timestamp is expired (line 4)', async () => {",
      "    const res = await request(app)",
      "      .post('/v1/webhooks/stripe')",
      "      .set('stripe-signature', 't=1600000,v1=expired_sig')",
      "      .send({ id: 'evt_replay_01' });",
      "    expect(res.status).toBe(401);",
      "    expect(res.body.code).toBe('REPLAY_ATTACK_BLOCKED');",
      "  });",
      "",
      "  it('short-circuits duplicate eventId with 200 idempotent flag (line 10)', async () => {",
      "    await seedWebhookEvent('evt_dup_99');",
      "    const res = await request(app)",
      "      .post('/v1/webhooks/stripe')",
      "      .set('stripe-signature', signValidPayload('evt_dup_99'))",
      "      .send({ id: 'evt_dup_99' });",
      "    expect(res.status).toBe(200);",
      "    expect(res.body).toEqual({ idempotent: true, skipped: true });",
      "  });",
      "});",
    ],
    cfgNodes: [
      { id: "A1", label: "POST /webhooks/stripe", before: "verified", after: "verified" },
      { id: "A2", label: "401 replay guard", before: "fault", after: "verified" },
      { id: "A3", label: "200 idempotency check", before: "fault", after: "verified" },
      { id: "A4", label: "202 BullMQ dispatch", before: "verified", after: "verified" },
      { id: "A5", label: "Response schema check", before: "verified", after: "verified" },
    ],
  },
  system: {
    id: "system",
    label: "System E2E flow",
    fileName: "e2e/flows/checkoutRecovery.flow.ts",
    testFileName: "tests/system/checkoutRecovery.e2e.spec.ts",
    runner: "Playwright Headless · V8 Coverage",
    initialCov: 39.2,
    healedCov: 95.6,
    complexity: "5 user flows · DOM + network",
    sourceLines: [
      { num: 1, code: "export async function executeCheckoutFlow(page, session) {", state: "covered" },
      { num: 2, code: "  await page.goto('/checkout?plan=enterprise');", state: "covered" },
      { num: 3, code: "  await page.fill('[data-testid=\"card-input\"]', session.card);", state: "covered" },
      { num: 4, code: "  if (session.requires3DSecure) {", state: "fault" },
      { num: 5, code: "    const frame = page.frameLocator('#three-ds-challenge');", state: "fault" },
      { num: 6, code: "    await frame.locator('button:has-text(\"Approve\")').click();", state: "fault" },
      { num: 7, code: "  }", state: "fault" },
      { num: 8, code: "  if (session.simulateNetworkDrop) {", state: "covered" },
      { num: 9, code: "    await page.getByRole('button', { name: 'Retry Payment' }).click();", state: "fault" },
      { num: 10, code: "  }", state: "covered" },
      { num: 11, code: "  await page.waitForURL('**/workspace/onboarding');", state: "covered" },
      { num: 12, code: "  return page.locator('[data-testid=\"receipt-badge\"]').textContent();", state: "covered" },
      { num: 13, code: "}", state: "covered" },
    ],
    synthesizedLines: [
      "test('completes 3DS iframe challenge and recovers from network drop', async ({ page }) => {",
      "  await page.route('**/api/charge', route => route.fulfill({",
      "    status: 200, body: JSON.stringify({ requires3DS: true })",
      "  }));",
      "  await page.goto('/checkout?plan=enterprise');",
      "  const challenge = page.frameLocator('#three-ds-challenge');",
      "  await challenge.getByRole('button', { name: 'Approve' }).click();",
      "",
      "  await expect(page.getByText('Connection restored')).toBeVisible();",
      "  await page.getByRole('button', { name: 'Retry Payment' }).click();",
      "  await expect(page).toHaveURL(/.*\\/workspace\\/onboarding/);",
      "});",
    ],
    cfgNodes: [
      { id: "S1", label: "Mount /checkout", before: "verified", after: "verified" },
      { id: "S2", label: "3DS iframe approval", before: "fault", after: "verified" },
      { id: "S3", label: "Offline retry action", before: "fault", after: "verified" },
      { id: "S4", label: "Onboarding redirect", before: "verified", after: "verified" },
      { id: "S5", label: "V8 coverage merge", before: "verified", after: "verified" },
    ],
  },
};

export default function IDEPreview() {
  const [activeTierKey, setActiveTierKey] = useState("unit");
  const [isHealing, setIsHealing] = useState(false);
  const [isHealed, setIsHealed] = useState(false);
  const [streamedLineCount, setStreamedLineCount] = useState(5);
  const [displayCov, setDisplayCov] = useState(SANDBOX_TIERS.unit.initialCov);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);

  const tier = SANDBOX_TIERS[activeTierKey];

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleSelectTier = (tierId) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setActiveTierKey(tierId);
    setIsHealing(false);
    setIsHealed(false);
    setStreamedLineCount(5);
    setDisplayCov(SANDBOX_TIERS[tierId].initialCov);
  };

  const handleRunAutoHeal = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setIsHealing(true);
    setIsHealed(false);
    setStreamedLineCount(1);

    const totalLines = tier.synthesizedLines.length;
    const startCov = tier.initialCov;
    const endCov = tier.healedCov;
    let step = 0;

    timerRef.current = setInterval(() => {
      step += 1;
      const progress = Math.min(1, step / totalLines);
      setStreamedLineCount(Math.min(totalLines, step + 1));
      const currentCov = startCov + (endCov - startCov) * progress;
      setDisplayCov(Number(currentCov.toFixed(1)));

      if (step >= totalLines) {
        clearInterval(timerRef.current);
        setIsHealing(false);
        setIsHealed(true);
        setDisplayCov(endCov);
      }
    }, 80);
  };

  const handleReset = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setIsHealing(false);
    setIsHealed(false);
    setStreamedLineCount(5);
    setDisplayCov(tier.initialCov);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(tier.synthesizedLines.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section
      id="ide-preview"
      className="relative py-24 md:py-32 border-b border-[var(--lp-line)]"
    >
      <div className="relative max-w-[1280px] mx-auto px-4 sm:px-6">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-10">
          <div className="space-y-2">
            <h2 className="lp-display text-3xl sm:text-4xl font-bold text-[var(--lp-ink)] tracking-tight">
              Interactive branch synthesis sandbox
            </h2>
            <p className="text-sm sm:text-base text-[var(--lp-ink-secondary)] max-w-2xl">
              Select a testing layer below and run the synthesizer to watch
              untested branches resolve into passing specifications.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {isHealed && (
              <button
                type="button"
                onClick={handleReset}
                className="px-3.5 py-2 rounded-lg lp-btn-secondary text-xs lp-mono flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset state</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleRunAutoHeal}
              disabled={isHealing}
              className="lp-btn-primary px-5 py-2.5 rounded-lg text-xs sm:text-sm cursor-pointer disabled:opacity-50"
            >
              {isHealing
                ? "Writing test assertions..."
                : isHealed
                  ? "Re-run branch synthesis"
                  : "Generate missing tests"}
            </button>
          </div>
        </div>

        {/* Tier Selector Bar */}
        <div
          role="tablist"
          aria-label="Testing layer tabs"
          className="inline-flex flex-wrap items-center gap-1 p-1 rounded-lg bg-[var(--lp-pill-bg)] border border-[var(--lp-line)] mb-4"
        >
          {Object.values(SANDBOX_TIERS).map((item) => {
            const active = activeTierKey === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => handleSelectTier(item.id)}
                className={`px-4 py-2 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  active
                    ? "bg-[var(--lp-pill-active)] text-[var(--lp-ink)] border border-[var(--lp-line-strong)] shadow-xs"
                    : "text-[var(--lp-ink-secondary)] hover:text-[var(--lp-ink)] border border-transparent"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Architectural IDE Frame */}
        <div className="rounded-xl lp-machined overflow-hidden">
          <div className="px-4 py-3 bg-[var(--lp-surface)] border-b border-[var(--lp-line)] flex flex-wrap items-center justify-between gap-3 text-xs lp-mono">
            <div className="flex items-center gap-3">
              <span className="text-[var(--lp-ink)] font-medium">{tier.fileName}</span>
              <span className="text-[var(--lp-ink-muted)]">/</span>
              <span className="text-[var(--lp-ink-muted)]">{tier.complexity}</span>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-[var(--lp-ink-secondary)]">Branch coverage</span>
              <span
                className={`text-sm font-bold ${
                  isHealed ? "text-[var(--lp-signal)]" : "text-[var(--lp-fault)]"
                }`}
              >
                {displayCov.toFixed(1)}%
              </span>
              <div className="hidden sm:block w-28 h-1.5 rounded-full bg-[var(--lp-line)] overflow-hidden">
                <div
                  className={`h-full transition-all duration-150 ${
                    isHealed ? "bg-[var(--lp-signal)]" : "bg-[var(--lp-fault)]"
                  }`}
                  style={{ width: `${displayCov}%` }}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[430px]">
            {/* Left Pane: Source AST */}
            <div className="lg:col-span-6 bg-[var(--lp-inset)] p-4 border-b lg:border-b-0 lg:border-r border-[var(--lp-line)] flex flex-col justify-between">
              <div className="lp-mono text-xs leading-[1.75] overflow-x-auto">
                {tier.sourceLines.map((line) => {
                  const isFault = !isHealed && line.state === "fault";

                  return (
                    <div
                      key={line.num}
                      className={`flex items-center px-2.5 py-0.5 transition-colors duration-200 ${
                        isFault
                          ? "bg-[var(--lp-fault-bg)] border-l-2 border-[var(--lp-fault)]"
                          : isHealed && line.state === "fault"
                            ? "bg-[var(--lp-signal-bg)] border-l-2 border-[var(--lp-signal)]"
                            : "border-l-2 border-transparent"
                      }`}
                    >
                      <div className="w-7 text-right pr-3 text-[var(--lp-ink-muted)] select-none text-[11px] shrink-0">
                        {line.num}
                      </div>
                      <pre
                        className={`m-0 whitespace-pre font-mono ${
                          isFault ? "text-[var(--lp-fault-ink)]" : "text-[var(--lp-ink)]"
                        }`}
                      >
                        {line.code}
                      </pre>
                    </div>
                  );
                })}
              </div>

              {/* Control Flow Nodes Strip */}
              <div className="mt-4 pt-3 border-t border-[var(--lp-line)]">
                <div className="text-[11px] lp-mono text-[var(--lp-ink-muted)] mb-2 flex items-center justify-between">
                  <span>Control flow predicates</span>
                  <span className="text-[var(--lp-ink-secondary)]">
                    {isHealed ? "5 of 5 verified" : "2 of 5 verified"}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                  {tier.cfgNodes.map((node) => {
                    const resolved = isHealed || node.before === "verified";
                    return (
                      <div
                        key={node.id}
                        className={`px-2.5 py-1.5 rounded border text-[11px] lp-mono truncate transition-colors ${
                          resolved
                            ? "bg-[var(--lp-surface)] border-[var(--lp-line-strong)] text-[var(--lp-ink)]"
                            : "bg-[var(--lp-fault-bg)] border-[var(--lp-fault-border)] text-[var(--lp-fault)]"
                        }`}
                      >
                        <span className="text-[var(--lp-ink-muted)] mr-1.5">{node.id}</span>
                        <span>{node.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right Pane: Synthesized Spec Stream */}
            <div className="lg:col-span-6 bg-[var(--lp-surface)] p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-3 mb-3 border-b border-[var(--lp-line)] text-xs lp-mono">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isHealed ? "bg-[var(--lp-signal)]" : "bg-[var(--lp-ink-muted)]"
                      }`}
                    />
                    <span className="text-[var(--lp-ink)]">{tier.testFileName}</span>
                  </div>

                  <button
                    type="button"
                    onClick={handleCopy}
                    className="px-2.5 py-1 rounded lp-btn-secondary text-xs lp-mono flex items-center gap-1.5 cursor-pointer"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-[var(--lp-signal)]" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy test file</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="p-3.5 rounded-lg bg-[var(--lp-inset)] border border-[var(--lp-line)] lp-mono text-xs leading-[1.7] min-h-[270px] overflow-x-auto">
                  {tier.synthesizedLines
                    .slice(
                      0,
                      isHealed ? tier.synthesizedLines.length : streamedLineCount
                    )
                    .map((line, idx) => (
                      <div key={idx} className="flex items-center">
                        <span className="w-6 text-right pr-3 text-[var(--lp-ink-muted)] select-none text-[10px]">
                          {idx + 1}
                        </span>
                        <span
                          className={
                            line.includes("expect(")
                              ? "text-[var(--lp-signal)] font-medium"
                              : line.includes("it(") || line.includes("test(")
                                ? "text-[var(--lp-ink)] font-semibold"
                                : "text-[var(--lp-ink-secondary)]"
                          }
                        >
                          {line || " "}
                        </span>
                      </div>
                    ))}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-[var(--lp-line)] flex flex-wrap items-center justify-between gap-3 text-xs lp-mono text-[var(--lp-ink-secondary)]">
                <span>Runner: {tier.runner}</span>
                <Link
                  to="/register"
                  className="text-[var(--lp-ink)] hover:text-[var(--lp-signal)] underline underline-offset-4 transition-colors"
                >
                  Open full editor workspace
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
