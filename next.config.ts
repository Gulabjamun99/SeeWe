import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Native/heavy Node-only parsers used by POST /api/resume/parse — keep them
  // out of the bundler so pdfjs/canvas dynamic requires keep working.
  serverExternalPackages: ["pdf-parse", "mammoth"],
};

export default nextConfig;
