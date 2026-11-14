#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function lanAddress() {
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === 'IPv4' && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address)) {
        return item.address;
      }
    }
  }
  return '<LAN_IP>';
}

async function main() {
  const ip = process.env.NNA_TEST_LAN_IP ?? lanAddress();
  const token = process.env.NNA_TEST_LAN_TOKEN ?? 'replace-with-random-token';
  const port = Number(process.env.NNA_TEST_PORT ?? 8787);
  const habitat = process.env.NNA_TEST_HABITAT ?? './habitat';
  const target = path.resolve(root, 'work', 'network-test-env');
  await mkdir(target, { recursive: true });

  const commands = `# Device A (this machine)
export NNA_LAN_TOKEN='${token}'
node bin/nna.mjs serve --habitat ${habitat} --port ${port} --lan --cidr 192.168.0.0/16

# Device B (same LAN)
curl -s http://${ip}:${port}/health
curl -s -H 'Authorization: Bearer '\"$NNA_LAN_TOKEN\" \\
  http://${ip}:${port}/status
curl -s -X POST \\
  -H 'content-type: application/json' \\
  -H 'Authorization: Bearer '\"$NNA_LAN_TOKEN\" \\
  --data '{"source":"device-b","text":"A signed event from a second LAN device"}' \\
  http://${ip}:${port}/event

# Public gateway (manual only, explicit authorization required)
# 1. Put a reverse proxy / tunnel in front of port ${port}.
# 2. Require the same bearer token.
# 3. Limit to a short time window and record the public URL hash.
# 4. Never expose this service directly with --cidr 0.0.0.0/0.
`;

  const manifest = {
    phase: 'network-test-env',
    generatedAt: new Date().toISOString(),
    lan: {
      bind: '0.0.0.0',
      address: ip,
      port,
      tokenFingerprintOnly: true,
      defaultCidr: '192.168.0.0/16',
    },
    public: {
      enabled: false,
      reason: 'Public exposure requires a manual gateway, short time window, explicit token, and audit record.',
    },
    files: ['commands.sh'],
  };

  await writeFile(path.join(target, 'commands.sh'), commands, 'utf8');
  await writeFile(path.join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    valid: true,
    phase: 'network-test-env',
    directory: path.relative(root, target),
    lanAddress: ip,
    publicEnabled: false,
    note: 'Review work/network-test-env/commands.sh before running. Replace the token first.',
  }, null, 2));
}

main().catch((error) => {
  console.error(`nna network-test-env: ${error.message}`);
  process.exitCode = 1;
});
