/**
 * Next.js instrumentation hook: runs once per server process before the
 * application handles traffic.
 *
 * Its only job today is to refuse an unsafe production configuration at boot
 * instead of discovering it during an incident. The same facts are reported by
 * GET /api/ready for operators who prefer a probe over a failed deploy, and the
 * proxy refuses to serve traffic when the configuration is fatally unsafe.
 *
 * The runtime check comes first and the Node-only module is imported lazily, so
 * this file stays compatible with the edge runtime it is also compiled for.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { enforceProductionGuardrailsAtBoot } = await import(
    "./src/lib/boot-guardrails"
  );

  await enforceProductionGuardrailsAtBoot();
}
