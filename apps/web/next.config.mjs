/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://js.paystack.co https://accounts.google.com https://*.clerk.accounts.dev https://challenges.cloudflare.com",
              "connect-src 'self' https://*.clerk.accounts.dev https://clerk-telemetry.com https://api.stripe.com https://*.cloudflare.com",
              "img-src 'self' data: https://img.clerk.com",
              "style-src 'self' 'unsafe-inline'",
              "font-src 'self'",
              "frame-src 'self' https://*.clerk.accounts.dev https://challenges.cloudflare.com",
              "worker-src blob:",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
