/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow ESM packages
  transpilePackages: ["wagmi", "viem", "@wagmi/core"],

  // Webpack config
  webpack: (config, { isServer }) => {
    // Fixes for viem/wagmi browser-only modules + missing optional deps
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs:           false,
      net:          false,
      tls:          false,
      crypto:       false,
      encoding:     false,   // MetaMask SDK optional dep
      "pino-pretty": false,  // WalletConnect logger optional dep
    };

    return config;
  },

  // Suppress known harmless warnings from optional deps
  logging: {
    fetches: { fullUrl: false },
  },

  // Security headers
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff"                         },
          { key: "X-Frame-Options",        value: "DENY"                            },
          { key: "Referrer-Policy",        value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
