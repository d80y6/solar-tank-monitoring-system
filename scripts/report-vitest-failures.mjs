/**
 * Prints GitHub Actions annotations for a Vitest JSON report.
 *
 * Usage:
 *   pnpm exec vitest run --reporter=json --outputFile=/tmp/vitest-report.json
 *   node scripts/report-vitest-failures.mjs /tmp/vitest-report.json
 *
 * Exits 0 on purpose: the failing test step already fails the job, and this step
 * only exists to make the failure readable.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  extractFailures,
  formatAnnotation,
  formatSummary,
} from "./lib/vitest-report.mjs";

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

async function main() {
  const reportPath = process.argv[2] ?? "/tmp/vitest-report.json";
  let raw;

  try {
    raw = await readFile(reportPath, "utf8");
  } catch {
    // No report means the run failed before Vitest produced one; the step log
    // already carries that error, so stay quiet instead of adding noise.
    console.log(`No Vitest report at ${reportPath}; nothing to annotate.`);
    return;
  }

  let report;

  try {
    report = JSON.parse(raw);
  } catch {
    console.log(`Vitest report at ${reportPath} is not valid JSON; skipping.`);
    return;
  }

  console.log(formatSummary(report));

  const failures = extractFailures(report);

  if (failures.length === 0) {
    console.log("No failing tests in the report.");
    return;
  }

  for (const failure of failures) {
    // Emitting the workflow command on its own line turns each failure into an
    // annotation on the pull request.
    console.log(formatAnnotation(failure));
  }

  console.log(`${failures.length} failure(s) annotated.`);
}

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`Could not report Vitest failures: ${error.message}`);
    process.exit(0);
  });
}
