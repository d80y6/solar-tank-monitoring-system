/**
 * Integration tests against a real MySQL server.
 *
 * These tests exist because unit tests with mocked pools cannot catch a mismatch
 * between a SQL statement and the migration DDL that creates the table. They run
 * only when RUN_MYSQL_INTEGRATION_TESTS=1 and a disposable database is provided,
 * so they can never touch an operational database by accident.
 *
 *   RUN_MYSQL_INTEGRATION_TESTS=1 \
 *   MYSQL_INTEGRATION_URL="mysql://root@127.0.0.1:3306/solar_tank_ci" \
 *   pnpm db:setup:mysql && \
 *   RUN_MYSQL_INTEGRATION_TESTS=1 MYSQL_INTEGRATION_URL=... pnpm test
 *
 * The CI workflow starts a MySQL service container, applies every migration and
 * the demo seed, then runs this file.
 */
import { randomBytes } from "node:crypto";

import type { RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const integrationUrl = process.env.MYSQL_INTEGRATION_URL?.trim();
const enabled =
  process.env.RUN_MYSQL_INTEGRATION_TESTS === "1" && Boolean(integrationUrl);

// The repositories read their connection settings from the environment at call
// time, so pointing the standard variable at the disposable database is enough.
if (enabled) {
  process.env.MYSQL_DATABASE_URL = integrationUrl;
  process.env.SOLAR_TANK_STORAGE_DRIVER = "mysql";
  process.env.MYSQL_SSL_MODE = process.env.MYSQL_SSL_MODE ?? "disabled";
}

const suite = enabled ? describe : describe.skip;

const runId = randomBytes(4).toString("hex");

suite("MySQL integration", () => {
  let pool: import("mysql2/promise").Pool;
  let actorUserId: string | null = null;
  const actorEmail = `integration-${runId}@example.test`;

  beforeAll(async () => {
    const { getMysqlPool } = await import(
      "@/features/monitoring/lib/mysql-connection"
    );

    pool = getMysqlPool();
    await pool.query("SELECT 1");

    // monitoring_devices.key_rotated_by_user_id, monitoring_alerts.*_by_user_id,
    // and auth_audit_events.actor_user_id are foreign keys into auth_users, so
    // an actor has to exist before those code paths can be exercised.
    const { createAdminUserIfMissing } = await import(
      "@/features/auth/lib/mysql-auth-repository"
    );

    try {
      const actor = await createAdminUserIfMissing({
        email: actorEmail,
        fullName: `Integration Actor ${runId}`,
        password: `integration-password-${runId}`,
        username: `integration${runId}`,
      });

      actorUserId = actor.userId;
    } catch {
      actorUserId = null;
    }
  });

  afterAll(async () => {
    if (!pool) {
      return;
    }

    // Remove everything this suite created so the database can be reused.
    if (actorUserId) {
      // Foreign keys are ON DELETE SET NULL for the rows the actor touched, so
      // this only removes the account itself.
      await pool
        .execute("DELETE FROM auth_users WHERE id = ?", [actorUserId])
        .catch(() => undefined);
    }

    await pool
      .execute("DELETE FROM auth_user_site_scopes WHERE id LIKE ?", [
        `integration_${runId}%`,
      ])
      .catch(() => undefined);
    await pool
      .execute("DELETE FROM monitoring_device_key_events WHERE device_id = ?", [
        "device-tph-main",
      ])
      .catch(() => undefined);
    await pool
      .execute("DELETE FROM monitoring_ingest_nonces WHERE nonce_hash LIKE ?", [
        `hmac-sha256:%${runId}%`,
      ])
      .catch(() => undefined);
    await pool
      .execute("DELETE FROM monitoring_ingest_events WHERE device_identifier = ?", [
        `integration-device-${runId}`,
      ])
      .catch(() => undefined);
    await pool
      .execute("DELETE FROM monitoring_hardware_profiles WHERE code = ?", [
        `integration-profile-${runId}`,
      ])
      .catch(() => undefined);
    await pool
      .execute("DELETE FROM monitoring_firmware_templates WHERE template_key = ?", [
        `integration-template-${runId}`,
      ])
      .catch(() => undefined);
    await pool
      .execute("DELETE FROM monitoring_alerts WHERE dedupe_key LIKE ?", [
        `integration:${runId}%`,
      ])
      .catch(() => undefined);
    await pool
      .execute("DELETE FROM auth_audit_events WHERE event_type = ?", [
        `integration_event_${runId}`,
      ])
      .catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  it("has every migration recorded in the ledger", async () => {
    const [rows] = await pool.query<Array<RowDataPacket & { id: string }>>(
      "SELECT id FROM schema_migrations",
    );
    const ids = rows.map((row) => row.id);
    const expected = [
      "database/migrations/001_create_monitoring_core_mysql.sql",
      "database/migrations/004_create_device_firmware_provisioning_mysql.sql",
      "database/migrations/010_create_ops_alerting_mysql.sql",
      "database/migrations/011_extend_device_key_rotation_mysql.sql",
      "database/migrations/012_create_site_access_scopes_mysql.sql",
      "database/migrations/013_translate_hardware_profile_names_mysql.sql",
    ];

    for (const migration of expected) {
      expect(ids).toContain(migration);
    }
  });

  it("reads the reference registry and the seeded reading history", async () => {
    const { listMonitoringReferenceFromMysql } = await import(
      "@/features/monitoring/lib/mysql-reference-repository"
    );
    const reference = await listMonitoringReferenceFromMysql();

    expect(reference.sites.length).toBeGreaterThan(0);
    expect(reference.tanks.length).toBeGreaterThan(0);
    expect(reference.devices.length).toBeGreaterThan(0);

    const device = reference.devices.find((item) => item.id === "device-tph-main");

    expect(device).toBeDefined();
    expect(device?.keyVersion).toBeGreaterThanOrEqual(1);
  });

  it("writes an ingest event with the columns the DDL actually defines", async () => {
    const { recordMonitoringIngestEvent } = await import(
      "@/features/monitoring/lib/mysql-ingest-event-repository"
    );
    const { countRecentIngestRejectionsFromMysql } = await import(
      "@/features/ops/lib/mysql-alert-repository"
    );
    const deviceIdentifier = `integration-device-${runId}`;

    await recordMonitoringIngestEvent({
      deviceIdentifier,
      deviceId: null,
      eventType: "ingest_rejected",
      ipAddress: "203.0.113.9",
      metadata: { reason: "integration-test" },
      // request_id is a foreign key into monitoring_device_requests, so a
      // synthetic value would be rejected by the database.
      requestId: null,
      responseStatus: 401,
      userAgent: "vitest",
    });

    const [rows] = await pool.execute<
      Array<
        RowDataPacket & {
          device_identifier: string;
          event_type: string;
          response_status: number;
        }
      >
    >(
      `SELECT device_identifier, event_type, response_status
         FROM monitoring_ingest_events
        WHERE device_identifier = ?
        LIMIT 1`,
      [deviceIdentifier],
    );

    expect(rows[0]?.event_type).toBe("ingest_rejected");
    expect(rows[0]?.response_status).toBe(401);

    const rejections = await countRecentIngestRejectionsFromMysql({
      windowMinutes: 60,
    });

    expect(rejections.count).toBeGreaterThan(0);
    expect(rejections.topDeviceIdentifiers).toContain(deviceIdentifier);
  });

  it("records a nonce once and rejects the replay", async () => {
    const { recordIngestNonce, deleteIngestNoncesOlderThanInMysql } = await import(
      "@/features/monitoring/lib/mysql-ingest-event-repository"
    );
    const nonce = `integration-${runId}`;
    const first = await recordIngestNonce({
      deviceId: "device-tph-main",
      nonce,
      requestTimestamp: new Date(),
      retentionMinutes: 120,
    });
    const replay = await recordIngestNonce({
      deviceId: "device-tph-main",
      nonce,
      requestTimestamp: new Date(),
      retentionMinutes: 120,
    });

    expect(first).toBe(true);
    expect(replay).toBe(false);

    // The prune floor is one minute (a shorter window would delete nonces that
    // are still protecting live requests), so insert an aged nonce to prune.
    const agedNonce = `integration-aged-${runId}`;

    await recordIngestNonce({
      deviceId: "device-tph-main",
      nonce: agedNonce,
      now: new Date(Date.now() - 10 * 60_000),
      requestTimestamp: new Date(Date.now() - 10 * 60_000),
      retentionMinutes: 120,
    });

    const pruned = await deleteIngestNoncesOlderThanInMysql({
      olderThanMinutes: 5,
    });

    expect(pruned).toBeGreaterThanOrEqual(1);

    const [remaining] = await pool.execute<Array<RowDataPacket & { count: number }>>(
      "SELECT COUNT(*) AS count FROM monitoring_ingest_nonces WHERE device_id = ?",
      ["device-tph-main"],
    );

    expect(Number(remaining[0]?.count)).toBe(1);
  });

  it("rotates a device key and keeps the previous key inside the grace window", async () => {
    const { rotateMonitoringDeviceKeyInMysql, getMonitoringDeviceByIdFromMysql } =
      await import("@/features/monitoring/lib/mysql-device-key-repository");
    const { isPreviousDeviceKeyWithinGrace } = await import(
      "@/features/monitoring/lib/device-key"
    );

    expect(actorUserId, "the suite needs an actor account").toBeTruthy();

    const rotation = await rotateMonitoringDeviceKeyInMysql({
      actorLabel: `integration-${runId}`,
      actorUserId: actorUserId ?? "",
      deviceId: "device-tph-main",
      graceHours: 72,
    });

    expect(rotation.ok).toBe(true);

    if (!rotation.ok) {
      return;
    }

    expect(rotation.deviceKey.startsWith("stk_")).toBe(true);

    const device = await getMonitoringDeviceByIdFromMysql("device-tph-main");

    expect(device?.keyVersion).toBeGreaterThanOrEqual(2);
    expect(device?.previousApiKeyHash).toBeTruthy();
    expect(
      isPreviousDeviceKeyWithinGrace({
        device: device ?? { previousApiKeyHash: null },
        now: new Date(),
      }),
    ).toBe(true);

    const [events] = await pool.query<Array<RowDataPacket & { event_type: string }>>(
      `SELECT event_type FROM monitoring_device_key_events
        WHERE device_id = ?
        ORDER BY created_at DESC LIMIT 3`,
      ["device-tph-main"],
    );

    expect(events.map((row) => row.event_type)).toContain("rotated");
  });

  it("stores per-location scopes for an account", async () => {
    const { replaceUserSiteScopesInMysql, listSiteScopesForUserFromMysql } =
      await import("@/features/auth/lib/mysql-site-scope-repository");
    const [siteRows] = await pool.query<Array<RowDataPacket & { id: string }>>(
      "SELECT id FROM monitoring_sites ORDER BY id ASC LIMIT 1",
    );
    const siteId = siteRows[0]?.id;

    expect(siteId).toBeTruthy();

    const userId = actorUserId;

    if (!siteId || !userId) {
      // A database without an administrator account cannot test scopes.
      return;
    }

    const result = await replaceUserSiteScopesInMysql({
      grantedByUserId: userId,
      note: `integration_${runId}`,
      scopeRole: "operator",
      siteIds: [siteId],
      userId,
    });

    expect(result.granted).toBeGreaterThanOrEqual(1);

    const scopes = await listSiteScopesForUserFromMysql(userId);

    expect(scopes.some((scope) => scope.siteId === siteId)).toBe(true);

    // Replace with an empty list and confirm the scope is revoked again.
    await replaceUserSiteScopesInMysql({
      grantedByUserId: userId,
      scopeRole: "viewer",
      siteIds: [],
      userId,
    });

    expect(await listSiteScopesForUserFromMysql(userId)).toHaveLength(0);
  });

  it("filters and pages the audit log with real SQL", async () => {
    const { listAuthAuditEvents, recordAuthAuditEvent } = await import(
      "@/features/auth/lib/mysql-auth-repository"
    );
    const eventType = `integration_event_${runId}`;

    await recordAuthAuditEvent({
      actorUserId,
      eventType,
      metadata: { runId },
      targetUserId: null,
    });

    const page = await listAuthAuditEvents({
      eventType,
      from: new Date(Date.now() - 60_000).toISOString(),
      limit: 10,
      search: runId,
    });

    expect(page.total).toBe(1);
    expect(page.events[0]?.eventType).toBe(eventType);
    expect(page.events[0]?.metadata).toEqual({ runId });
    expect(page.eventTypes).toContain(eventType);
  });

  it("creates firmware templates and hardware profiles and refuses unsafe deletes", async () => {
    const {
      createFirmwareTemplateInMysql,
      createHardwareProfileInMysql,
      deleteFirmwareTemplateFromMysql,
      deleteHardwareProfileFromMysql,
      findFirmwareTemplateFromMysql,
      updateFirmwareTemplateInMysql,
    } = await import("@/features/monitoring/lib/mysql-hardware-registry-repository");

    const template = await createFirmwareTemplateInMysql({
      checksumSha256: null,
      displayName: `Integration template ${runId}`,
      isActive: false,
      sourcePath: `firmware/templates/integration-${runId}`,
      templateKey: `integration-template-${runId}`,
      version: "v1",
    });
    const profile = await createHardwareProfileInMysql({
      boardFamily: "esp8266",
      boardLabel: "Integration board",
      code: `integration-profile-${runId}`,
      echoPin: "D5",
      firmwareTemplateId: template.id,
      isActive: false,
      name: `Integration profile ${runId}`,
      reportIntervalMs: 20000,
      sensorType: "HC-SR04",
      supportedTankShape: "any",
      triggerPin: "D6",
    });

    expect(profile.firmwareTemplateId).toBe(template.id);

    // A template still used by a profile must not be deleted.
    const blocked = await deleteFirmwareTemplateFromMysql(template.id);

    expect(blocked.deleted).toBe(false);
    expect(blocked.reason).toBe("in-use");
    expect(blocked.usageCount).toBeGreaterThanOrEqual(1);

    const updated = await updateFirmwareTemplateInMysql({
      checksumSha256: "a".repeat(64),
      displayName: `Integration template ${runId} updated`,
      id: template.id,
      isActive: true,
      sourcePath: template.sourcePath,
    });

    expect(updated?.isActive).toBe(true);
    expect(updated?.checksumSha256).toBe("a".repeat(64));

    // Deleting the profile first unblocks the template.
    const profileDeleted = await deleteHardwareProfileFromMysql(profile.id);

    expect(profileDeleted.deleted).toBe(true);

    const templateDeleted = await deleteFirmwareTemplateFromMysql(template.id);

    expect(templateDeleted.deleted).toBe(true);
    expect(await findFirmwareTemplateFromMysql(template.id)).toBeNull();
  });

  it("stores, acknowledges, and resolves an operational alert", async () => {
    const {
      acknowledgeMonitoringAlertInMysql,
      listActiveMonitoringAlertsFromMysql,
      resolveMonitoringAlertInMysql,
      syncMonitoringAlertsInMysql,
    } = await import("@/features/ops/lib/mysql-alert-repository");
    const { getOpsConfig } = await import("@/features/ops/lib/ops-config");

    const dedupeKey = `integration:${runId}`;
    const sync = await syncMonitoringAlertsInMysql({
      candidates: [
        {
          dedupeKey,
          detail: "Integration test alert.",
          ruleKey: "storage_unavailable",
          severity: "warning",
          subjectId: "integration",
          subjectType: "system",
          title: `Integration alert ${runId}`,
        },
      ],
      config: getOpsConfig(),
    });

    expect(sync.created).toBeGreaterThanOrEqual(1);

    const active = await listActiveMonitoringAlertsFromMysql();
    const alert = active.find((item) => item.dedupeKey === dedupeKey);

    expect(alert).toBeDefined();

    if (!alert) {
      return;
    }

    const acknowledged = await acknowledgeMonitoringAlertInMysql({
      actorLabel: "integration",
      actorUserId: actorUserId ?? "",
      alertId: alert.id,
      note: "integration acknowledge",
    });

    expect(acknowledged?.status).toBe("acknowledged");

    const resolved = await resolveMonitoringAlertInMysql({
      actorLabel: "integration",
      actorUserId: actorUserId ?? "",
      alertId: alert.id,
      note: "integration resolve",
    });

    expect(resolved?.status).toBe("resolved");
  });

  it("records and reads scheduled job runs", async () => {
    const { recordOpsJobRunInMysql, listRecentOpsJobRunsFromMysql } = await import(
      "@/features/ops/lib/mysql-alert-repository"
    );

    const startedAt = new Date(Date.now() - 250);

    await recordOpsJobRunInMysql({
      detail: { runId },
      durationMs: 250,
      finishedAt: new Date(),
      jobKey: `integration_job_${runId}`,
      startedAt,
      status: "succeeded",
    });

    const runs = await listRecentOpsJobRunsFromMysql({
      jobKey: `integration_job_${runId}`,
      limit: 5,
    });

    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("succeeded");
  });
});
