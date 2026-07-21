/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // onnxruntime-web ships browser ESM that Next should not try to bundle as Node.
  serverExternalPackages: ['onnxruntime-web'],
}

export default nextConfig
