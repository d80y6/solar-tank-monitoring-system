import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import { getMysqlPool } from "./mysql-connection";

const RESET_MONITORING_DEVICE_DATA_TABLES = [
  "monitoring_ingest_events",
  "monitoring_device_provisioning_events",
  "monitoring_device_packages",
  "monitoring_device_requests",
  "monitoring_latest_readings",
  "monitoring_readings",
  "monitoring_devices",
  "monitoring_tanks",
  "monitoring_sites",
] as const;

type ResetMonitoringDeviceDataTable =
  (typeof RESET_MONITORING_DEVICE_DATA_TABLES)[number];

type CountRow = RowDataPacket & {
  count: number | string;
};

type IdRow = RowDataPacket & {
  id: string;
};

type PackageLinkRow = RowDataPacket & {
  device_id: string | null;
  id: string;
  request_id: string;
};

type DeviceLinkRow = RowDataPacket & {
  id: string;
  site_id: string;
  tank_id: string;
};

type TankLinkRow = RowDataPacket & {
  id: string;
  site_id: string;
};

export type ResetMonitoringDeviceDataResult = {
  counts: Record<ResetMonitoringDeviceDataTable, number>;
  totalRows: number;
};

export type CleanupMonitoringDeviceRequestsResult = {
  counts: Partial<Record<ResetMonitoringDeviceDataTable, number>>;
  matchedRequestCount: number;
  totalRows: number;
};

export type CleanupMonitoringTanksResult = {
  counts: Partial<Record<ResetMonitoringDeviceDataTable, number>>;
  matchedTankCount: number;
  totalRows: number;
};

export type ResetMonitoringReadingsResult = {
  matchedTankCount: number;
  readingRows: number;
  totalRows: number;
};

function uniqueNonEmpty(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function buildPlaceholders(values: readonly string[]): string {
  return values.map(() => "?").join(", ");
}

function getIds(rows: IdRow[]): string[] {
  return uniqueNonEmpty(rows.map((row) => row.id));
}

function buildWhereFromIdGroups(
  groups: Array<{
    column: string;
    values: string[];
  }>,
): {
  params: string[];
  where: string;
} | null {
  const activeGroups = groups.filter((group) => group.values.length > 0);

  if (activeGroups.length === 0) {
    return null;
  }

  return {
    params: activeGroups.flatMap((group) => group.values),
    where: activeGroups
      .map(
        (group) =>
          `${group.column} IN (${buildPlaceholders(group.values)})`,
      )
      .join(" OR "),
  };
}

async function deleteWhere({
  connection,
  params,
  tableName,
  where,
}: {
  connection: PoolConnection;
  params: string[];
  tableName: ResetMonitoringDeviceDataTable;
  where: string;
}) {
  const [result] = await connection.query<ResultSetHeader>(
    `DELETE FROM ${tableName} WHERE ${where}`,
    params,
  );

  return result.affectedRows;
}

async function countRows({
  connection,
  tableName,
}: {
  connection: PoolConnection;
  tableName: ResetMonitoringDeviceDataTable;
}) {
  const [rows] = await connection.query<CountRow[]>(
    `SELECT COUNT(*) AS count FROM ${tableName}`,
  );

  return Number(rows[0]?.count ?? 0);
}

async function countRowsWhere({
  connection,
  params,
  tableName,
  where,
}: {
  connection: PoolConnection;
  params: string[];
  tableName: ResetMonitoringDeviceDataTable;
  where: string;
}) {
  const [rows] = await connection.query<CountRow[]>(
    `SELECT COUNT(*) AS count FROM ${tableName} WHERE ${where}`,
    params,
  );

  return Number(rows[0]?.count ?? 0);
}

async function getDeletableDeviceRows({
  connection,
  deviceIds,
  matchedRequestIds,
}: {
  connection: PoolConnection;
  deviceIds: string[];
  matchedRequestIds: string[];
}): Promise<DeviceLinkRow[]> {
  const [rows] = await connection.query<DeviceLinkRow[]>(
    `
      SELECT d.id, d.site_id, d.tank_id
      FROM monitoring_devices d
      WHERE d.id IN (${buildPlaceholders(deviceIds)})
        AND NOT EXISTS (
          SELECT 1
          FROM monitoring_device_packages p
          WHERE p.device_id = d.id
            AND p.request_id NOT IN (${buildPlaceholders(matchedRequestIds)})
        )
      FOR UPDATE
    `,
    [...deviceIds, ...matchedRequestIds],
  );

  return rows;
}

export async function resetMonitoringDeviceDataInMysql(): Promise<ResetMonitoringDeviceDataResult> {
  const pool = getMysqlPool();
  const connection = await pool.getConnection();
  const counts = {} as Record<ResetMonitoringDeviceDataTable, number>;

  try {
    await connection.beginTransaction();

    for (const tableName of RESET_MONITORING_DEVICE_DATA_TABLES) {
      counts[tableName] = await countRows({ connection, tableName });
    }

    for (const tableName of RESET_MONITORING_DEVICE_DATA_TABLES) {
      await connection.query(`DELETE FROM ${tableName}`);
    }

    await connection.commit();

    return {
      counts,
      totalRows: Object.values(counts).reduce((total, count) => total + count, 0),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function resetMonitoringReadingsInMysql({
  tankIds,
}: {
  tankIds?: string[];
} = {}): Promise<ResetMonitoringReadingsResult> {
  const cleanTankIds =
    typeof tankIds === "undefined" ? null : uniqueNonEmpty(tankIds);

  if (Array.isArray(cleanTankIds) && cleanTankIds.length === 0) {
    return {
      matchedTankCount: 0,
      readingRows: 0,
      totalRows: 0,
    };
  }

  const pool = getMysqlPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    if (!cleanTankIds) {
      const matchedTankCount = await countRows({
        connection,
        tableName: "monitoring_tanks",
      });
      const readingRows =
        (await countRows({
          connection,
          tableName: "monitoring_latest_readings",
        })) +
        (await countRows({
          connection,
          tableName: "monitoring_readings",
        }));

      await connection.query("DELETE FROM monitoring_latest_readings");
      await connection.query("DELETE FROM monitoring_readings");
      await connection.commit();

      return {
        matchedTankCount,
        readingRows,
        totalRows: readingRows,
      };
    }

    const [tankRows] = await connection.query<IdRow[]>(
      `
        SELECT id
        FROM monitoring_tanks
        WHERE id IN (${buildPlaceholders(cleanTankIds)})
        FOR UPDATE
      `,
      cleanTankIds,
    );
    const matchedTankIds = getIds(tankRows);

    if (matchedTankIds.length === 0) {
      await connection.commit();

      return {
        matchedTankCount: 0,
        readingRows: 0,
        totalRows: 0,
      };
    }

    const where = `tank_id IN (${buildPlaceholders(matchedTankIds)})`;
    const readingRows =
      (await countRowsWhere({
        connection,
        params: matchedTankIds,
        tableName: "monitoring_latest_readings",
        where,
      })) +
      (await countRowsWhere({
        connection,
        params: matchedTankIds,
        tableName: "monitoring_readings",
        where,
      }));

    await deleteWhere({
      connection,
      params: matchedTankIds,
      tableName: "monitoring_latest_readings",
      where,
    });
    await deleteWhere({
      connection,
      params: matchedTankIds,
      tableName: "monitoring_readings",
      where,
    });
    await connection.commit();

    return {
      matchedTankCount: matchedTankIds.length,
      readingRows,
      totalRows: readingRows,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function cleanupMonitoringDeviceRequestsInMysql({
  requestIds,
}: {
  requestIds: string[];
}): Promise<CleanupMonitoringDeviceRequestsResult> {
  const cleanRequestIds = uniqueNonEmpty(requestIds);

  if (cleanRequestIds.length === 0) {
    return {
      counts: {},
      matchedRequestCount: 0,
      totalRows: 0,
    };
  }

  const pool = getMysqlPool();
  const connection = await pool.getConnection();
  const counts: CleanupMonitoringDeviceRequestsResult["counts"] = {};

  try {
    await connection.beginTransaction();

    const requestPlaceholders = buildPlaceholders(cleanRequestIds);
    const [requestRows] = await connection.query<IdRow[]>(
      `
        SELECT id
        FROM monitoring_device_requests
        WHERE id IN (${requestPlaceholders})
        FOR UPDATE
      `,
      cleanRequestIds,
    );
    const matchedRequestIds = getIds(requestRows);

    if (matchedRequestIds.length === 0) {
      await connection.commit();

      return {
        counts,
        matchedRequestCount: 0,
        totalRows: 0,
      };
    }

    const matchedRequestPlaceholders = buildPlaceholders(matchedRequestIds);
    const [packageRows] = await connection.query<PackageLinkRow[]>(
      `
        SELECT id, device_id
        FROM monitoring_device_packages
        WHERE request_id IN (${matchedRequestPlaceholders})
        FOR UPDATE
      `,
      matchedRequestIds,
    );
    const packageIds = uniqueNonEmpty(packageRows.map((row) => row.id));
    const deviceIds = uniqueNonEmpty(
      packageRows.flatMap((row) => (row.device_id ? [row.device_id] : [])),
    );
    const deletableDeviceRows =
      deviceIds.length > 0
        ? await getDeletableDeviceRows({
            connection,
            deviceIds,
            matchedRequestIds,
          })
        : [];
    const deletableDeviceIds = uniqueNonEmpty(
      deletableDeviceRows.map((row) => row.id),
    );
    const deletableTankIds = uniqueNonEmpty(
      deletableDeviceRows.map((row) => row.tank_id),
    );
    const candidateSiteIds = uniqueNonEmpty(
      deletableDeviceRows.map((row) => row.site_id),
    );
    const ingestWhere = buildWhereFromIdGroups([
      { column: "request_id", values: matchedRequestIds },
      { column: "device_id", values: deletableDeviceIds },
    ]);

    if (ingestWhere) {
      counts.monitoring_ingest_events = await deleteWhere({
        connection,
        params: ingestWhere.params,
        tableName: "monitoring_ingest_events",
        where: ingestWhere.where,
      });
    }

    const provisioningWhere = buildWhereFromIdGroups([
      { column: "request_id", values: matchedRequestIds },
      { column: "package_id", values: packageIds },
    ]);

    if (provisioningWhere) {
      counts.monitoring_device_provisioning_events = await deleteWhere({
        connection,
        params: provisioningWhere.params,
        tableName: "monitoring_device_provisioning_events",
        where: provisioningWhere.where,
      });
    }

    if (deletableDeviceIds.length > 0) {
      counts.monitoring_latest_readings = await deleteWhere({
        connection,
        params: deletableDeviceIds,
        tableName: "monitoring_latest_readings",
        where: `device_id IN (${buildPlaceholders(deletableDeviceIds)})`,
      });
      counts.monitoring_readings = await deleteWhere({
        connection,
        params: deletableDeviceIds,
        tableName: "monitoring_readings",
        where: `device_id IN (${buildPlaceholders(deletableDeviceIds)})`,
      });
    }

    counts.monitoring_device_packages = await deleteWhere({
      connection,
      params: matchedRequestIds,
      tableName: "monitoring_device_packages",
      where: `request_id IN (${matchedRequestPlaceholders})`,
    });
    counts.monitoring_device_requests = await deleteWhere({
      connection,
      params: matchedRequestIds,
      tableName: "monitoring_device_requests",
      where: `id IN (${matchedRequestPlaceholders})`,
    });

    if (deletableDeviceIds.length > 0) {
      counts.monitoring_devices = await deleteWhere({
        connection,
        params: deletableDeviceIds,
        tableName: "monitoring_devices",
        where: `id IN (${buildPlaceholders(deletableDeviceIds)})`,
      });
    }

    if (deletableTankIds.length > 0) {
      const [tankResult] = await connection.query<ResultSetHeader>(
        `
          DELETE t
          FROM monitoring_tanks t
          WHERE t.id IN (${buildPlaceholders(deletableTankIds)})
            AND NOT EXISTS (
              SELECT 1
              FROM monitoring_devices d
              WHERE d.tank_id = t.id
            )
        `,
        deletableTankIds,
      );
      counts.monitoring_tanks = tankResult.affectedRows;
    }

    if (candidateSiteIds.length > 0) {
      const [siteResult] = await connection.query<ResultSetHeader>(
        `
          DELETE s
          FROM monitoring_sites s
          WHERE s.id IN (${buildPlaceholders(candidateSiteIds)})
            AND NOT EXISTS (
              SELECT 1
              FROM monitoring_tanks t
              WHERE t.site_id = s.id
            )
            AND NOT EXISTS (
              SELECT 1
              FROM monitoring_devices d
              WHERE d.site_id = s.id
            )
        `,
        candidateSiteIds,
      );
      counts.monitoring_sites = siteResult.affectedRows;
    }

    await connection.commit();

    return {
      counts,
      matchedRequestCount: matchedRequestIds.length,
      totalRows: Object.values(counts).reduce(
        (total, count) => total + (count ?? 0),
        0,
      ),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function cleanupMonitoringTanksInMysql({
  tankIds,
}: {
  tankIds: string[];
}): Promise<CleanupMonitoringTanksResult> {
  const cleanTankIds = uniqueNonEmpty(tankIds);

  if (cleanTankIds.length === 0) {
    return {
      counts: {},
      matchedTankCount: 0,
      totalRows: 0,
    };
  }

  const pool = getMysqlPool();
  const connection = await pool.getConnection();
  const counts: CleanupMonitoringTanksResult["counts"] = {};

  try {
    await connection.beginTransaction();

    const [tankRows] = await connection.query<TankLinkRow[]>(
      `
        SELECT id, site_id
        FROM monitoring_tanks
        WHERE id IN (${buildPlaceholders(cleanTankIds)})
        FOR UPDATE
      `,
      cleanTankIds,
    );
    const matchedTankIds = getIds(tankRows);

    if (matchedTankIds.length === 0) {
      await connection.commit();

      return {
        counts,
        matchedTankCount: 0,
        totalRows: 0,
      };
    }

    const candidateSiteIds = uniqueNonEmpty(
      tankRows.map((row) => row.site_id),
    );
    const [deviceRows] = await connection.query<DeviceLinkRow[]>(
      `
        SELECT id, site_id, tank_id
        FROM monitoring_devices
        WHERE tank_id IN (${buildPlaceholders(matchedTankIds)})
        FOR UPDATE
      `,
      matchedTankIds,
    );
    const deviceIds = uniqueNonEmpty(deviceRows.map((row) => row.id));
    const packageRows =
      deviceIds.length > 0
        ? await (async () => {
            const [rows] = await connection.query<PackageLinkRow[]>(
              `
                SELECT id, request_id, device_id
                FROM monitoring_device_packages
                WHERE device_id IN (${buildPlaceholders(deviceIds)})
                FOR UPDATE
              `,
              deviceIds,
            );

            return rows;
          })()
        : [];
    const requestIds = uniqueNonEmpty(
      packageRows.map((row) => row.request_id),
    );
    const allPackageRows =
      requestIds.length > 0
        ? await (async () => {
            const packageWhere = buildWhereFromIdGroups([
              { column: "device_id", values: deviceIds },
              { column: "request_id", values: requestIds },
            ]);

            if (!packageWhere) {
              return packageRows;
            }

            const [rows] = await connection.query<PackageLinkRow[]>(
              `
                SELECT id, request_id, device_id
                FROM monitoring_device_packages
                WHERE ${packageWhere.where}
                FOR UPDATE
              `,
              packageWhere.params,
            );

            return rows;
          })()
        : packageRows;
    const packageIds = uniqueNonEmpty(allPackageRows.map((row) => row.id));
    const allRequestIds = uniqueNonEmpty(
      allPackageRows.map((row) => row.request_id),
    );
    const ingestWhere = buildWhereFromIdGroups([
      { column: "device_id", values: deviceIds },
      { column: "request_id", values: allRequestIds },
    ]);

    if (ingestWhere) {
      counts.monitoring_ingest_events = await deleteWhere({
        connection,
        params: ingestWhere.params,
        tableName: "monitoring_ingest_events",
        where: ingestWhere.where,
      });
    }

    const provisioningWhere = buildWhereFromIdGroups([
      { column: "request_id", values: allRequestIds },
      { column: "package_id", values: packageIds },
    ]);

    if (provisioningWhere) {
      counts.monitoring_device_provisioning_events = await deleteWhere({
        connection,
        params: provisioningWhere.params,
        tableName: "monitoring_device_provisioning_events",
        where: provisioningWhere.where,
      });
    }

    const readingWhere = buildWhereFromIdGroups([
      { column: "tank_id", values: matchedTankIds },
      { column: "device_id", values: deviceIds },
    ]);

    if (readingWhere) {
      counts.monitoring_latest_readings = await deleteWhere({
        connection,
        params: readingWhere.params,
        tableName: "monitoring_latest_readings",
        where: readingWhere.where,
      });
      counts.monitoring_readings = await deleteWhere({
        connection,
        params: readingWhere.params,
        tableName: "monitoring_readings",
        where: readingWhere.where,
      });
    }

    if (packageIds.length > 0) {
      counts.monitoring_device_packages = await deleteWhere({
        connection,
        params: packageIds,
        tableName: "monitoring_device_packages",
        where: `id IN (${buildPlaceholders(packageIds)})`,
      });
    }

    if (allRequestIds.length > 0) {
      counts.monitoring_device_requests = await deleteWhere({
        connection,
        params: allRequestIds,
        tableName: "monitoring_device_requests",
        where: `id IN (${buildPlaceholders(allRequestIds)})`,
      });
    }

    if (deviceIds.length > 0) {
      counts.monitoring_devices = await deleteWhere({
        connection,
        params: deviceIds,
        tableName: "monitoring_devices",
        where: `id IN (${buildPlaceholders(deviceIds)})`,
      });
    }

    counts.monitoring_tanks = await deleteWhere({
      connection,
      params: matchedTankIds,
      tableName: "monitoring_tanks",
      where: `id IN (${buildPlaceholders(matchedTankIds)})`,
    });

    if (candidateSiteIds.length > 0) {
      const [siteResult] = await connection.query<ResultSetHeader>(
        `
          DELETE s
          FROM monitoring_sites s
          WHERE s.id IN (${buildPlaceholders(candidateSiteIds)})
            AND NOT EXISTS (
              SELECT 1
              FROM monitoring_tanks t
              WHERE t.site_id = s.id
            )
            AND NOT EXISTS (
              SELECT 1
              FROM monitoring_devices d
              WHERE d.site_id = s.id
            )
        `,
        candidateSiteIds,
      );
      counts.monitoring_sites = siteResult.affectedRows;
    }

    await connection.commit();

    return {
      counts,
      matchedTankCount: matchedTankIds.length,
      totalRows: Object.values(counts).reduce(
        (total, count) => total + (count ?? 0),
        0,
      ),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export type PruneMonitoringReadingsResult = {
  cutoff: string;
  deletedRows: number;
  dryRun: boolean;
};

/**
 * Retention pruning for reading history.
 *
 * Disabled by default: operational history is the product's core asset, so
 * deletion only happens when MONITORING_READING_RETENTION_DAYS is set to a
 * positive value. The live snapshot table is never touched, so dashboards
 * keep showing the current level even after old buckets are pruned.
 */
export async function pruneMonitoringReadingsOlderThanFromMysql({
  now = new Date(),
  olderThanDays,
  dryRun = false,
  batchSize = 20_000,
}: {
  now?: Date;
  olderThanDays: number;
  dryRun?: boolean;
  batchSize?: number;
}): Promise<PruneMonitoringReadingsResult> {
  const safeDays = Math.max(Math.trunc(olderThanDays), 1);
  const cutoffDate = new Date(now.getTime() - safeDays * 24 * 60 * 60 * 1_000);
  const cutoff = cutoffDate.toISOString().slice(0, 23).replace("T", " ");
  const safeBatchSize = Math.min(Math.max(Math.trunc(batchSize), 100), 100_000);

  if (dryRun) {
    const pool = getMysqlPool();
    const [rows] = await pool.execute<CountRow[]>(
      `SELECT COUNT(*) AS count
         FROM monitoring_readings
        WHERE received_at < ?`,
      [cutoff],
    );

    return {
      cutoff,
      deletedRows: Number(rows[0]?.count ?? 0),
      dryRun: true,
    };
  }

  const pool = getMysqlPool();
  const [result] = await pool.execute<ResultSetHeader>(
    `DELETE FROM monitoring_readings
      WHERE received_at < ?
      ORDER BY received_at
      LIMIT ${safeBatchSize}`,
    [cutoff],
  );

  return {
    cutoff,
    deletedRows: result.affectedRows,
    dryRun: false,
  };
}
