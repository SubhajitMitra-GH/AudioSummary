import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // Website hosted in a sub-folder (GitHub Pages project site: /AudioSummary). Empty for the Mac app and localhost.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  images: {
    unoptimized: true
  }
};

export default nextConfig;
