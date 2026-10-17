/**
 * Turns a Vitest JSON report into GitHub Actions annotations.
 *
 * Why this exists: on a headless CI run the interesting part of a failure is
 * usually one assertion message, and digging through a full log to find it is
 * slow. Annotations surface the failing test and its message directly on the
 * pull request, and they stay attached to the workflow run afterwards.
 *
 * The functions are pure so they can be unit tested without running Vitest.
 */

/** Escapes a value for use inside a workflow command. */
export function escapeWorkflowCommandValue(value) {
  return String(value)
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

/** Escapes a property value (for example `file=` or `title=`). */
export function escapeWorkflowCommandProperty(value) {
  return escapeWorkflowCommandValue(value)
    .replaceAll(":", "%3A")
    .replaceAll(",", "%2C");
}

const MAX_MESSAGE_LENGTH = 1_200;

export function truncateMessage(message, limit = MAX_MESSAGE_LENGTH) {
  const text = String(message ?? "").trim();

  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, limit)}… (truncated)`;
}

/**
 * Collects failing tests from a Vitest JSON report, including suites that failed
 * to load (which report no assertion results but do carry a message).
 */
export function extractFailures(report) {
  const failures = [];

  for (const suite of report?.testResults ?? []) {
    const suitePath = suite.name ?? "unknown";

    for (const assertion of suite.assertionResults ?? []) {
      if (assertion.status === "failed") {
        failures.push({
          file: suitePath,
          message: truncateMessage(
            (assertion.failureMessages ?? []).join("\n\n") || "Test failed.",
          ),
          title: assertion.fullName ?? assertion.title ?? "unknown test",
        });
      }
    }

    const suiteFailed = suite.status === "failed";
    const hasAssertionFailure = (suite.assertionResults ?? []).some(
      (assertion) => assertion.status === "failed",
    );

    if (suiteFailed && !hasAssertionFailure) {
      failures.push({
        file: suitePath,
        message: truncateMessage(suite.message || "Test file failed to load."),
        title: "Test file failed to load",
      });
    }
  }

  return failures;
}

export function formatAnnotation(failure) {
  const properties = [
    `file=${escapeWorkflowCommandProperty(failure.file)}`,
    `title=${escapeWorkflowCommandProperty(failure.title)}`,
  ];

  return `::error ${properties.join(",")}::${escapeWorkflowCommandValue(failure.message)}`;
}

export function formatSummary(report) {
  const total = report?.numTotalTests ?? 0;
  const failed = report?.numFailedTests ?? 0;
  const passed = report?.numPassedTests ?? 0;
  const skipped = report?.numPendingTests ?? 0;

  return `Vitest: ${passed} passed, ${failed} failed, ${skipped} skipped, ${total} total.`;
}
