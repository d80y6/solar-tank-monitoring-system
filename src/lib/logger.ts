import { redactForLogging } from "./redaction";
import { getRequestContext } from "./request-context";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export type Logger = {
  debug: (message: string, fields?: LogFields) => void;
  info: (message: string, fields?: LogFields) => void;
  warn: (message: string, fields?: LogFields) => void;
  error: (message: string, fields?: LogFields) => void;
  child: (fields: LogFields) => Logger;
};

const LEVEL_WEIGHTS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const DEFAULT_SERVICE_NAME = "solar-tank-monitoring-system";

function parseLogLevel(value: string | undefined): LogLevel | null {
  const cleanValue = value?.trim().toLowerCase();

  if (
    cleanValue === "debug" ||
    cleanValue === "info" ||
    cleanValue === "warn" ||
    cleanValue === "error"
  ) {
    return cleanValue;
  }

  return null;
}

export function getLogLevel(
  envValue = process.env.LOG_LEVEL,
): LogLevel {
  const configured = parseLogLevel(envValue);

  if (configured) {
    return configured;
  }

  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

export function shouldUseJsonLogs(
  envValue = process.env.LOG_FORMAT,
): boolean {
  const cleanValue = envValue?.trim().toLowerCase();

  if (cleanValue === "json") {
    return true;
  }

  if (cleanValue === "pretty" || cleanValue === "text") {
    return false;
  }

  return process.env.NODE_ENV === "production";
}

function getServiceName(): string {
  return process.env.NEXT_PUBLIC_APP_NAME?.trim() || DEFAULT_SERVICE_NAME;
}

function getEnvironmentName(): string {
  return (
    process.env.NEXT_PUBLIC_APP_ENV?.trim() ||
    process.env.NODE_ENV ||
    "development"
  );
}

function formatPrettyLine(entry: Record<string, unknown>): string {
  const { level, time, msg, ...rest } = entry;
  const timestamp =
    typeof time === "string" ? time.slice(11, 23) : new Date().toISOString();
  const fields =
    Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : "";

  return `${timestamp} ${String(level).toUpperCase().padEnd(5)} ${String(msg)}${fields}`;
}

export function createLogger(baseFields: LogFields = {}): Logger {
  const build = (level: LogLevel, message: string, fields?: LogFields) => {
    const threshold = LEVEL_WEIGHTS[getLogLevel()];

    if (LEVEL_WEIGHTS[level] < threshold) {
      return;
    }

    const context = getRequestContext();
    const entry: Record<string, unknown> = {
      level,
      time: new Date().toISOString(),
      msg: message,
      service: getServiceName(),
      env: getEnvironmentName(),
      ...((redactForLogging(baseFields) as LogFields | undefined) ?? {}),
      ...(context?.requestId ? { requestId: context.requestId } : {}),
      ...(context?.route ? { route: context.route } : {}),
      ...(context?.method ? { method: context.method } : {}),
      ...(context?.userId ? { userId: context.userId } : {}),
      ...(context?.role ? { role: context.role } : {}),
      ...((fields ? redactForLogging(fields) : undefined) as LogFields | undefined),
    };

    const line = shouldUseJsonLogs()
      ? JSON.stringify(entry)
      : formatPrettyLine(entry);

    try {
      if (level === "error") {
        globalThis.console.error(line);
        return;
      }

      if (level === "warn") {
        globalThis.console.warn(line);
        return;
      }

      globalThis.console.log(line);
    } catch {
      // Logging must never break the request path.
    }
  };

  return {
    debug: (message, fields) => build("debug", message, fields),
    info: (message, fields) => build("info", message, fields),
    warn: (message, fields) => build("warn", message, fields),
    error: (message, fields) => build("error", message, fields),
    child: (fields) => createLogger({ ...baseFields, ...fields }),
  };
}

export const logger = createLogger();

export function describeError(error: unknown): LogFields {
  return { error: error instanceof Error ? error : String(error) };
}
