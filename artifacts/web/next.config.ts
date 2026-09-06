import type { NextConfig } from "next";

const apiUrl = process.env.NEXT_PUBLIC_API_URL;
let apiHostname: string | undefined;
try {
  apiHostname = apiUrl ? new URL(apiUrl).hostname : undefined;
} catch {
  apiHostname = undefined;
}

const nextConfig: NextConfig = {
  transpilePackages: ["@workspace/api-client-react"],
  images: {
    remotePatterns: [
      // Posters can live on the API's own media host or on whatever
      // public source the catalog importer pulled them from.
      ...(apiHostname
        ? [{ protocol: "https" as const, hostname: apiHostname }]
        : []),
      { protocol: "https" as const, hostname: "**" },
    ],
  },
};

export default nextConfig;
