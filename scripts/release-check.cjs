#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const { existsSync, readFileSync, readdirSync } = require('node:fs');
const { join, relative, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const gates = [
  ['lint', 'pnpm', ['lint']],
  ['typecheck', 'pnpm', ['typecheck']],
  ['tests', 'pnpm', ['test']],
  ['program tests', 'cargo', ['test', '-p', 'bazo', '--lib', '--quiet']],
  ['program build', 'pnpm', ['build:program']],
  ['production build', 'pnpm', ['build']],
  ['Devnet accounts', 'pnpm', ['setup:devnet', '--', '--check']],
];

function filesUnder(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function auditBrowserBundle() {
  const bundle = join(root, 'apps/web/.next/static');
  if (!existsSync(bundle))
    throw new Error('Production browser bundle is missing');
  const names = [
    'PYTH_API_KEY',
    'BAZO_COORDINATOR_SECRET',
    'BAZO_AUTH_SESSION_SECRET',
  ];
  const credentials = names.filter(name => {
    const value = process.env[name];
    return value && value.length >= 16 && !value.startsWith('replace-with-');
  });
  if (credentials.length !== names.length)
    throw new Error(
      'Credential audit needs all three configured non-placeholder secrets',
    );
  const leaks = [];
  const files = filesUnder(bundle);
  const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: root });
  if (tracked.status !== 0)
    throw new Error('Could not enumerate tracked files');
  const trackedFiles = tracked.stdout
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map(path => join(root, path));
  for (const path of [...files, ...trackedFiles]) {
    const content = readFileSync(path);
    for (const name of credentials) {
      if (content.includes(Buffer.from(process.env[name])))
        leaks.push(`${relative(root, path)}: ${name} [redacted]`);
    }
  }
  if (leaks.length)
    throw new Error(
      `Browser bundle or tracked files contain credentials:\n${leaks.join('\n')}`,
    );
  process.stdout.write(
    `Credential audit: ${files.length} browser files and ${trackedFiles.length} tracked files, no configured secrets found.\n`,
  );
}

let failed = false;
for (const [label, command, args] of gates) {
  process.stdout.write(`Checking ${label}...\n`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, NO_DNA: '1' },
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.stderr.write(
      `${label}: failed${result.error ? ` (${result.error.code})` : ''}.\n`,
    );
    failed = true;
  } else {
    process.stdout.write(`${label}: passed.\n`);
  }
}
try {
  auditBrowserBundle();
} catch (error) {
  process.stderr.write(`Privacy audit: ${error.message}\n`);
  failed = true;
}
process.exitCode = failed ? 1 : 0;
