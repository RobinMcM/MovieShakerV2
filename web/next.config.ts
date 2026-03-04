import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "s-maxage=0, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
