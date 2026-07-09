import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'maps.googleapis.com',
      },
    ],
  },
  allowedDevOrigins: [
    '127.0.0.1',
    'localhost',
    '*.agent-sandbox-my-b1-gw.trae.ai',
    '*.agent-sandbox-my-c1-gw.trae.ai',
  ],
};

export default nextConfig;
