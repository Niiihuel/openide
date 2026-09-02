import type {NextConfig} from 'next';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  // Fully static site: works on GitHub Pages, Vercel, Netlify or any static host.
  output: 'export',
  trailingSlash: true,
  basePath,
  images: {unoptimized: true},
};

export default nextConfig;
