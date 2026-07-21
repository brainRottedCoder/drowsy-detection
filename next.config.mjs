import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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
  // A stray lockfile at C:\Users\...\package-lock.json (outside this project)
  // made Turbopack misdetect the workspace root, which eventually hard-failed
  // with "couldn't find the Next.js package from the project directory".
  // Pinning the root here fixes it.
  turbopack: {
    root: __dirname,
  },
}

export default nextConfig
