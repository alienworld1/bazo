import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
for (const fileName of ['.env.local', '.env']) {
  const file = resolve(workspaceRoot, fileName);
  if (existsSync(file)) loadEnvFile(file);
}
const privateBlobDirectory = process.env.BAZO_PRIVATE_BLOB_DIRECTORY;
if (privateBlobDirectory && !privateBlobDirectory.startsWith('/')) {
  process.env.BAZO_PRIVATE_BLOB_DIRECTORY = resolve(
    workspaceRoot,
    privateBlobDirectory,
  );
}

const nextConfig: NextConfig = {
  transpilePackages: ['@bazo/plan-crypto'],
  outputFileTracingExcludes: {
    '/*': ['./.next/export-detail.json'],
  },
};

export default nextConfig;
