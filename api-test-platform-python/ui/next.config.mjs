/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  async rewrites() {
    const managementUrl =
      process.env.MANAGEMENT_API_URL ?? "http://localhost:8100";
    return [
      {
        source: "/management-api/:path*",
        destination: `${managementUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
