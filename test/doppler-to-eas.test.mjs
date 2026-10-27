import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'doppler-to-eas.mjs');

function run(args, { app = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'd2e-'));
  if (app) writeFileSync(join(dir, 'app.json'), '{}');
  const log = join(dir, 'eas.log');
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir, encoding: 'utf8', input: '',
    env: { ...process.env, NO_COLOR: '1', EAS_LOG: log, PATH: join(here, 'bin') + delimiter + process.env.PATH },
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
  return { code: r.status, out: r.stdout + r.stderr, calls };
}
const pushed = (calls, name) => calls.find((c) => c.includes(`--name ${name} `));

test('dry run lists variables, pushes nothing, never prints values', () => {
  const r = run(['dev', '--dry-run']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Doppler app\/dev → EAS "development"/);
  assert.match(r.out, /EXPO_PUBLIC_API_URL \[plaintext\]/);
  assert.match(r.out, /API_SECRET \[secret\]/);
  assert.match(r.out, /Skipped \(empty in Doppler\): EMPTY_ONE/);
  assert.doesNotMatch(r.out, /DOPPLER_PROJECT|s3cr3t/);
  assert.equal(r.calls.length, 0);
});

test('pushes with the right visibility and environment', () => {
  const r = run(['prd', '--yes', '--exclude', 'FAIL_ME']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.calls.length, 2);
  assert.match(pushed(r.calls, 'API_SECRET'), /--environment production --visibility secret .*--force --non-interactive/);
  assert.match(pushed(r.calls, 'EXPO_PUBLIC_API_URL'), /--visibility plaintext/);
});

test('failures exit 1 and redact the value', () => {
  const r = run(['dev', '--yes']);
  assert.equal(r.code, 1);
  assert.match(r.out, /FAIL_ME: Error: could not save ••••/);
  assert.doesNotMatch(r.out, /boom-value/);
});

test('needs --yes without a terminal', () => {
  const r = run(['dev']);
  assert.equal(r.code, 2);
  assert.equal(r.calls.length, 0);
});

test('"all" uses the map, one environment per config', () => {
  const r = run(['all', '--yes', '--only', 'API_SECRET']);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.calls.map((c) => c.match(/--environment (\w+)/)[1]), ['development', 'preview', 'production']);
});

test('--environment overrides, --map and --visibility apply', () => {
  assert.match(run(['dev_personal', '--yes', '--only', 'API_SECRET', '--environment', 'preview']).calls[0], /--environment preview/);
  assert.equal(run(['odd', '--dry-run']).code, 2);
  assert.match(run(['odd', '--yes', '--only', 'API_SECRET', '--map', 'qa=preview', '--visibility', 'sensitive']).calls[0], /--environment preview --visibility sensitive/);
});

test('--public-prefix replaces the default', () => {
  const r = run(['dev', '--yes', '--only', 'EXPO_PUBLIC_API_URL,API_SECRET', '--public-prefix', 'API_']);
  assert.match(pushed(r.calls, 'API_SECRET'), /plaintext/);
  assert.match(pushed(r.calls, 'EXPO_PUBLIC_API_URL'), /--visibility secret/);
});

test('usage and setup errors exit 2', () => {
  assert.equal(run([]).code, 2);
  assert.equal(run(['dev', '--nope']).code, 2);
  assert.equal(run(['all', '--environment', 'preview']).code, 2);
  assert.equal(run(['dev', '--environment', 'staging']).code, 2);
  assert.equal(run(['dev', '--only', 'NOT_THERE', '--dry-run']).code, 2);
  assert.equal(run(['dev', '--dry-run'], { app: false }).code, 2);
  assert.equal(run(['missing', '--dry-run']).code, 1);
  assert.equal(run(['--version']).code, 0);
});
