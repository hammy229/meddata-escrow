import type { NextConfig } from "next";

import { securityHeaders } from "./lib/http/security-headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders(process.env.NODE_ENV === "development"),
      },
    ];
  },
};

export default nextConfig;
