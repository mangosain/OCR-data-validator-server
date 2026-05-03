import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the Next.js server to read files from anywhere on the host filesystem.
  // This is required for the /api/image, /api/dataset, /api/fs/browse routes
  // which read directly from disk paths selected by the user.
  serverExternalPackages: [],

  // Disable the default restriction that limits server actions to same-origin.
  // Required so that all LAN clients (different IPs) can call API routes.
  experimental: {},

  // Allow images served from the API route (avoids Next.js image optimisation
  // interference when we stream raw images ourselves).
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
