/**
 * Next.js instrumentation hook: runs once per server process before the
 * application handles traffic.
 *
 * Its only job today is to refuse an unsafe production configuration at boot
 * instead of discovering it during an incident. The same facts are reported by
 * GET /api/ready for operators who prefer a probe over a failed deploy.
 *
 * The process exits after a fatal finding: Next.js only logs an unhandled
 * rejection from this hook, which would leave a misconfigured instance serving
 * traffic. Exiting makes the deployment fail visibly.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { ProductionGuardrailError, assertProductionGuardrails } = await import(
    "./src/lib/production-guardrails"
  );

  try {
    assertProductionGuardrails();
  } catch (error) {
    if (error instanceof ProductionGuardrailError) {
      console.error(error.message);
      process.exit(1);
    }

    throw error;
  }
}
