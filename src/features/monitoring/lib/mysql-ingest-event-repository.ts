import { randomUUID } from "node:crypto";

import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { hmacSha256Hex } from "@/features/auth/lib/auth-crypto";
import { reportError } from "@/lib/error-tracker";

import { getMysqlPool } from "./mysql-connection";
import { getMonitoringStorageDriver } from "./monitoring-storage";

export type MonitoringIngestEventType =
  | "ingest_accepted"
  | "ingest_rejected"
  | "ingest_activated_device"
  | "ingest_provisioned_device"
  | "ingest_rate_limited"
  | "ingest_duplicate_suppressed";

export type RecordIngestEventInput = {
  deviceIdentifier?: string | null;
  deviceId?: string | null;
  eventType: MonitoringIngestEventType;
  metadata?: Record<string, unknown> | null;
  requestId?: string | null;
  responseStatus: number;
  ipAddress?: string | null;
  userAgent?: string | null;
};

type IngestEventRow = RowDataPacket & {
  created_at: Date;
  device_id: string | null;
  device_identifier: string | null;
  event_type: string;
  id: string;
  metadata_json: unknown;
  request_id: string | null;
  response_status: number;
};

export type MonitoringIngestEventSummary = {
  createdAt: string;
  deviceId: string | null;
  deviceIdentifier: string | null;
  eventType: string;
  id: string;
  metadata: unknown;
  requestId: string | null;
  responseStatus: number;
};

function hashIdentity(value?: string | null): string | null {
  const cleanValue = value?.trim();

  if (!cleanValue) {
    return null;
  }

  return `hmac-sha256:${hmacSha256Hex(cleanValue)}`;
}

function stringifyMetadata(metadata?: Record<string, unknown> | null): string | null {
  if (!metadata) {
    return null;
  }

  try {
    const serialized = JSON.stringify(metadata);

    // Keep audit rows bounded; the raw payload is stored with the reading.
    return serialized.length > 4_000 ? serialized.slice(0, 4_000) : serialized;
  } catch {
    return null;
  }
}

export function createIngestEventId(): string {
  return `ingest_evt_${randomUUID()}`;
}

/**
 * Persists a device-ingestion audit row.
 *
 * This is what makes "why did this device stop sending data?" answerable:
 * every accepted payload, every rejection, and every rate-limited retry
 * leaves a trace with the request correlation ID.
 *
 * Auditing is best effort: it never fails the ingest response and never runs
 * when memory storage is active.
 */
export async function recordMonitoringIngestEvent({
  deviceIdentifier,
  deviceId,
  eventType,
  metadata,
  requestId,
  responseStatus,
  ipAddress,
  userAgent,
}: RecordIngestEventInput): Promise<void> {
  if (getMonitoringStorageDriver() !== "mysql") {
    return;
  }

  try {
    const pool = getMysqlPool();

    await pool.execute(
      `INSERT INTO monitoring_ingest_events (
         id,
         device_identifier,
         device_id,
         request_id,
         event_type,
         response_status,
         ip_hash,
         user_agent_hash,
         metadata_json
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        createIngestEventId(),
        deviceIdentifier?.trim() || null,
        deviceId?.trim() || null,
        requestId ?? null,
        eventType,
        responseStatus,
        hashIdentity(ipAddress),
        hashIdentity(userAgent),
        stringifyMetadata(metadata),
      ],
    );
  } catch (error) {
    reportError({
      scope: "ingest.audit-write-failed",
      error,
      level: "warn",
      fields: { deviceIdentifier, eventType },
    });
  }
}

export async function listRecentMonitoringIngestEvents({
  deviceIdentifier,
  eventType,
  limit = 50,
}: {
  deviceIdentifier?: string;
  eventType?: MonitoringIngestEventType;
  limit?: number;
} = {}): Promise<MonitoringIngestEventSummary[]> {
  const pool = getMysqlPool();
  const conditions: string[] = [];
  const values: Array<string | number> = [];

  if (deviceIdentifier?.trim()) {
    conditions.push("device_identifier = ?");
    values.push(deviceIdentifier.trim());
  }

  if (eventType) {
    conditions.push("event_type = ?");
    values.push(eventType);
  }

  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 200);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const [rows] = await pool.execute<IngestEventRow[]>(
    `SELECT id, device_identifier, device_id, request_id, event_type,
            response_status, metadata_json, created_at
       FROM monitoring_ingest_events
       ${where}
      ORDER BY created_at DESC
      LIMIT ${safeLimit}`,
    values,
  );

  return rows.map((row) => ({
    createdAt: row.created_at.toISOString(),
    deviceId: row.device_id,
    deviceIdentifier: row.device_identifier,
    eventType: row.event_type,
    id: row.id,
    metadata:
      typeof row.metadata_json === "string"
        ? (() => {
            try {
              return JSON.parse(row.metadata_json);
            } catch {
              return row.metadata_json;
            }
          })()
        : row.metadata_json,
    requestId: row.request_id,
    responseStatus: row.response_status,
  }));
}

const inMemoryNonces = new Map<string, number>();
const MAX_IN_MEMORY_NONCES = 5_000;

/**
 * Records a telemetry nonce so the same signed payload cannot be accepted
 * twice.
 *
 * Returns `true` when the nonce is new (accept) and `false` when it was
 * already used (replay). The durable store is MySQL; memory storage keeps an
 * in-process bounded cache so development and preview deployments still get
 * replay protection.
 */
export async function recordIngestNonce({
  deviceId,
  nonce,
  requestTimestamp,
  now = new Date(),
  retentionMinutes = 60,
}: {
  deviceId: string;
  nonce: string;
  requestTimestamp: Date;
  now?: Date;
  retentionMinutes?: number;
}): Promise<boolean> {
  const nonceHash = `hmac-sha256:${hmacSha256Hex(`${deviceId}:${nonce}`)}`;

  if (getMonitoringStorageDriver() !== "mysql") {
    const existing = inMemoryNonces.get(nonceHash);

    if (
      existing !== undefined &&
      now.getTime() - existing < retentionMinutes * 60_000
    ) {
      return false;
    }

    if (inMemoryNonces.size >= MAX_IN_MEMORY_NONCES) {
      for (const [key, seenAt] of inMemoryNonces) {
        if (now.getTime() - seenAt > retentionMinutes * 60_000) {
          inMemoryNonces.delete(key);
        }
      }
    }

    inMemoryNonces.set(nonceHash, now.getTime());

    return true;
  }

  try {
    const pool = getMysqlPool();
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT IGNORE INTO monitoring_ingest_nonces
         (device_id, nonce_hash, request_timestamp, created_at)
       VALUES (?, ?, ?, ?)`,
      [deviceId, nonceHash, requestTimestamp, now],
    );

    return result.affectedRows > 0;
  } catch (error) {
    // If the nonce store is unavailable, prefer availability of telemetry
    // over blocking the device, but record the degradation loudly.
    reportError({
      scope: "ingest.nonce-store-failed",
      error,
      level: "warn",
      fields: { deviceId },
    });

    return true;
  }
}

export async function deleteIngestNoncesOlderThanInMysql({
  olderThanMinutes,
  now = new Date(),
  limit = 20_000,
}: {
  olderThanMinutes: number;
  now?: Date;
  limit?: number;
}): Promise<number> {
  const pool = getMysqlPool();
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 100), 100_000);
  const safeMinutes = Math.max(Math.trunc(olderThanMinutes), 1);

  const [result] = await pool.execute<ResultSetHeader>(
    `DELETE FROM monitoring_ingest_nonces
      WHERE created_at < DATE_SUB(?, INTERVAL ? MINUTE)
      LIMIT ${safeLimit}`,
    [now, safeMinutes],
  );

  return result.affectedRows;
}
