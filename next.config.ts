import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  // 允许通过 127.0.0.1 访问开发服务器，否则 Next 会拦截 chunk/HMR 请求导致页面无法水合
  allowedDevOrigins: ["localhost", "127.0.0.1"],
};

export default nextConfig;
