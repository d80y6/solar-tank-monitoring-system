/**
 * Boot-time enforcement of the production guardrails.
 *
 * This lives outside `instrumentation.ts` on purpose. Next.js compiles the
 * instrumentation hook for every runtime it uses, including the edge runtime
 * that the proxy runs in, and the edge runtime has no `process.exit`. Keeping
 * the Node.js-only call in a module that is imported dynamically, after a
 * runtime check, keeps the edge bundle free of Node.js APIs.
 *
 * A fatal finding exits the process. Throwing would only be logged by Next.js
 * as an unhandled rejection while the server keeps serving traffic, which is
 * exactly the outcome this check exists to prevent.
 */
export async function enforceProductionGuardrailsAtBoot(): Promise<void> {
  const { assertProductionGuardrails, ProductionGuardrailError } = await import(
    "./production-guardrails"
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
