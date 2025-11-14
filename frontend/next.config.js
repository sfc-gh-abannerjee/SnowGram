/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  
  // Output configuration for SPCS deployment
  output: 'standalone',
  
  // Environment variables
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000',
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
  
  // Experimental features
  experimental: {
    serverActions: true,
  },
};

module.exports = nextConfig;






