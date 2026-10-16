import { describe, expect, it } from "vitest";

import {
  DEMO_DEVICE_KEY_HASH,
  DEMO_REGISTRY_IDS,
  formatFinding,
  PLACEHOLDER_EMAIL_DOMAINS,
  summarizeFindings,
} from "../audit-sample-data.mjs";

describe("sample-data audit constants", () => {
  it("targets the ids that exist in the demo seed", () => {
    expect(DEMO_REGISTRY_IDS.sites).toContain("site-sah");
    expect(DEMO_REGISTRY_IDS.tanks).toContain("tank-sah-main");
    expect(DEMO_REGISTRY_IDS.devices).toContain("device-tph-main");
  });

  it("matches the demo device key hash in the seed migration", async () => {
    const { readFile } = await import("node:fs/promises");

    const seed = await readFile(
      new URL(
        "../../database/seeds/001_seed_demo_monitoring_reference_mysql.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(DEMO_DEVICE_KEY_HASH).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(seed).toContain(DEMO_DEVICE_KEY_HASH.replace("sha256:", ""));
  });

  it("flags placeholder mailbox domains", () => {
    expect(PLACEHOLDER_EMAIL_DOMAINS).toContain("example.com");
  });
});

describe("summarizeFindings", () => {
  it("counts findings per kind", () => {
    expect(
      summarizeFindings([
        { detail: "a", kind: "demo-site" },
        { detail: "b", kind: "demo-site" },
        { detail: "c", kind: "demo-tank" },
      ]),
    ).toEqual({ "demo-site": 2, "demo-tank": 1 });
  });

  it("returns an empty summary for a clean database", () => {
    expect(summarizeFindings([])).toEqual({});
  });
});

describe("formatFinding", () => {
  it("renders the kind and the detail", () => {
    expect(
      formatFinding({ detail: "site site-sah (SAH) is the demo registry site", kind: "demo-site" }),
    ).toBe("- [demo-site] site site-sah (SAH) is the demo registry site");
  });
});
