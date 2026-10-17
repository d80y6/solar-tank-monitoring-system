export type BuildInfo = {
  service: string;
  version: string;
  commitSha: string | null;
  commitRef: string | null;
  buildTime: string | null;
  environment: string;
  nodeVersion: string;
};

function cleanValue(value: string | undefined): string | null {
  const text = value?.trim();

  return text ? text : null;
}

export function getBuildInfo(): BuildInfo {
  return {
    service:
      cleanValue(process.env.NEXT_PUBLIC_APP_NAME) ??
      "solar-tank-monitoring-system",
    version: cleanValue(process.env.APP_VERSION) ?? "0.1.0",
    commitSha:
      cleanValue(process.env.VERCEL_GIT_COMMIT_SHA) ??
      cleanValue(process.env.GIT_COMMIT_SHA) ??
      cleanValue(process.env.APP_COMMIT_SHA),
    commitRef:
      cleanValue(process.env.VERCEL_GIT_COMMIT_REF) ??
      cleanValue(process.env.GIT_COMMIT_REF),
    buildTime:
      cleanValue(process.env.APP_BUILD_TIME) ??
      cleanValue(process.env.VERCEL_DEPLOYMENT_CREATED_AT),
    environment:
      cleanValue(process.env.NEXT_PUBLIC_APP_ENV) ??
      process.env.NODE_ENV ??
      "development",
    nodeVersion: process.version,
  };
}

export function getShortCommitSha(): string | null {
  const sha = getBuildInfo().commitSha;

  return sha ? sha.slice(0, 12) : null;
}
