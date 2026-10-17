import type { NextConfig } from "next";

/**
 * Security headers are applied per request in `src/proxy.ts` so that the
 * Content-Security-Policy and the frame policy can depend on the runtime
 * environment (production versus development/preview). Keeping them in one
 * place avoids duplicated or conflicting header values.
 */
const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        // Static assets served straight from `public/` still need hardening
        // headers when the deployment does not run the proxy (for example a
        // CDN rule that bypasses middleware).
        source: "/:path*.:extension(png|jpg|jpeg|svg|webp|ico|woff|woff2)",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
