/** @type {import('next').NextConfig} */
const API_HOST = process.env.API_PROXY_HOST || 'http://127.0.0.1:8000';

const nextConfig = {
  output: 'standalone',
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_HOST}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
