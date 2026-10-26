/** @type {import('next').NextConfig} */
const coverRemotePatterns = [{ protocol: 'https', hostname: '*.r2.dev', pathname: '/**' }];
try {
  const rawCoverUrl = process.env.R2_COVERS_PUBLIC_URL;
  if (rawCoverUrl) {
    const coverUrl = new URL(rawCoverUrl);
    if (coverUrl.protocol === 'https:' && !/r2\.cloudflarestorage\.com$/i.test(coverUrl.hostname)) {
      const prefix = coverUrl.pathname.replace(/\/$/, '');
      coverRemotePatterns.push({ protocol: 'https', hostname: coverUrl.hostname, pathname: `${prefix}/**` });
    }
  }
} catch { /* The app validates the URL at use time and reports configuration errors. */ }

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  images: {
    remotePatterns: coverRemotePatterns,
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 604800,
  },
  // The CSP (with a per-request nonce) is set in middleware.ts.
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  serverExternalPackages: ['@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner'],
};
export default nextConfig;
