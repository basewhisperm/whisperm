/** @type {import('next').NextConfig} */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://js.stripe.com https://js.paystack.co https://accounts.google.com",
  "connect-src 'self' https://api.stripe.com https://hooks.stripe.com https://api.paystack.co https://oauth2.googleapis.com https://www.googleapis.com",
  "frame-src https://js.stripe.com https://hooks.stripe.com",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options",    value: "nosniff" },
  { key: "X-Frame-Options",           value: "DENY" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
  { key: "Referrer-Policy",           value: "strict-origin-when-cross-origin" },
  { key: "Content-Security-Policy",   value: CSP },
  { key: "X-XSS-Protection",         value: "0" },
];

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  async redirects() {
    return [
      {
        source: "/(.*)",
        has: [{ type: "header", key: "x-forwarded-proto", value: "http" }],
        destination: "https://whisperm.io/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
