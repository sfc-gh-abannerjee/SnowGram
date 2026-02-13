/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  
  // Output configuration for SPCS deployment
  output: 'standalone',
  
  // Environment variables
  // Local dev: Frontend on 3002, Backend on 8082 (avoids conflicts with 3001/8081)
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8082',
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8082',
  },
  
  // Styled components support
  compiler: {
    styledComponents: true,
  },
  
  // Webpack configuration
  webpack: (config, { isServer }) => {
    // Handle SVG imports
    config.module.rules.push({
      test: /\.svg$/,
      use: ['@svgr/webpack'],
    });
    
    return config;
  },
  
  // Image optimization
  images: {
    domains: [],
    unoptimized: true, // For SPCS deployment
  },
  
};

module.exports = nextConfig;






