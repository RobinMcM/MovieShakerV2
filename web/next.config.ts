import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Root and HTML pages: no CDN or browser cache so updates show immediately
        source: "/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=0, max-age=0, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
