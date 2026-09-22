export function privateStorageConfig() {
  const secret = process.env.BAZO_AUTH_SESSION_SECRET;
  const directory = process.env.BAZO_PRIVATE_BLOB_DIRECTORY;
  if (!secret || secret.length < 32 || !directory || !directory.startsWith('/')) return undefined;
  return { secret, directory };
}
