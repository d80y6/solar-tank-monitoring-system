import { describe, expect, it } from "vitest";

import {
  escapeWorkflowCommandProperty,
  escapeWorkflowCommandValue,
  extractFailures,
  formatAnnotation,
  formatSummary,
  truncateMessage,
} from "../lib/vitest-report.mjs";

const reportWithFailures = {
  numFailedTests: 1,
  numPassedTests: 3,
  numPendingTests: 0,
  numTotalTests: 4,
  testResults: [
    {
      assertionResults: [
        {
          failureMessages: [],
          fullName: "mysql integration records and reads ingest events",
          status: "passed",
          title: "records and reads ingest events",
        },
        {
          failureMessages: [
            "Error: Unknown column 'metadata_json' in 'field list'\n    at Object.query (src/x.ts:1:1)",
          ],
          fullName: "mysql integration writes an ingest event",
          status: "failed",
          title: "writes an ingest event",
        },
      ],
      name: "src/features/monitoring/tests/mysql-integration.test.ts",
      status: "failed",
    },
    {
      assertionResults: [],
      message: "Error: Cannot find module '@/missing'",
      name: "src/features/monitoring/tests/broken.test.ts",
      status: "failed",
    },
  ],
  success: false,
};

describe("escapes", () => {
  it("escapes the characters that would break a workflow command", () => {
    expect(escapeWorkflowCommandValue("50% ok\nnext line")).toBe(
      "50%25 ok%0Anext line",
    );
    expect(escapeWorkflowCommandProperty("a:b,c")).toBe("a%3Ab%2Cc");
  });
});

describe("truncateMessage", () => {
  it("keeps short messages and marks long ones", () => {
    expect(truncateMessage("short")).toBe("short");
    expect(truncateMessage("x".repeat(50), 10)).toBe("x".repeat(10) + "… (truncated)");
    expect(truncateMessage("x".repeat(50), 10)).toMatch(/truncated\)$/);
  });
});

describe("extractFailures", () => {
  it("collects failing assertions with their suite path and message", () => {
    const failures = extractFailures(reportWithFailures);

    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatchObject({
      file: "src/features/monitoring/tests/mysql-integration.test.ts",
      title: "mysql integration writes an ingest event",
    });
    expect(failures[0]?.message).toContain("Unknown column 'metadata_json'");
    expect(failures[1]?.title).toBe("Test file failed to load");
    expect(failures[1]?.message).toContain("Cannot find module");
  });

  it("returns nothing for a passing report", () => {
    expect(
      extractFailures({ testResults: [{ assertionResults: [], name: "a", status: "passed" }] }),
    ).toEqual([]);
  });

  it("tolerates a missing or malformed report", () => {
    expect(extractFailures(undefined)).toEqual([]);
    expect(extractFailures({})).toEqual([]);
  });
});

describe("formatAnnotation", () => {
  it("produces a single-line workflow command with escaped values", () => {
    const annotation = formatAnnotation({
      file: "src/a.test.ts",
      message: "line one\nline two 100%",
      title: "some: test, name",
    });

    expect(annotation.startsWith("::error ")).toBe(true);
    expect(annotation).toContain("file=src/a.test.ts");
    expect(annotation).toContain("title=some%3A test%2C name");
    expect(annotation).toContain("line one%0Aline two 100%25");
    expect(annotation.split("\n")).toHaveLength(1);
  });
});

describe("formatSummary", () => {
  it("summarises the counts", () => {
    expect(formatSummary(reportWithFailures)).toBe(
      "Vitest: 3 passed, 1 failed, 0 skipped, 4 total.",
    );
    expect(formatSummary(undefined)).toBe("Vitest: 0 passed, 0 failed, 0 skipped, 0 total.");
  });
});
