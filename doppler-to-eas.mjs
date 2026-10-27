#!/usr/bin/env node
/**
 * doppler-to-eas: copy a Doppler config's variables into an EAS (Expo Application
 * Services) environment, so cloud builds get the same values you use locally.
 * https://github.com/ym-scripts/doppler-to-eas
 *
 * Values never touch the disk and are never printed. Variables starting with a public
 * prefix (EXPO_PUBLIC_ by default) ship inside the app anyway, so they're stored as
 * plaintext; everything else is stored as an EAS secret, which only builds can read.
 *
 * Copyright (c) 2026 Aghogho Meyoron. MIT License.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';

const VERSION = '0.1.0';
const EAS_ENVIRONMENTS = ['development', 'preview', 'production'];
const DEFAULT_MAP = 'dev=development,stg=preview,prd=production';

const HELP = `doppler-to-eas ${VERSION}: copy Doppler secrets into an EAS environment.

Usage: doppler-to-eas <doppler-config|all> [options]

  -e, --environment ENV     EAS environment: development, preview or production
                            (default: from --map, by the config's Doppler environment)
  -p, --project NAME        Doppler project (default: from doppler setup in this folder)
  -m, --map LIST            Doppler env → EAS env    default: ${DEFAULT_MAP}
      --public-prefix P     Prefix stored as plaintext (repeatable)  default: EXPO_PUBLIC_
      --visibility V        Visibility for everything else: secret or sensitive  default: secret
      --only K1,K2          Only these variables
      --exclude K1,K2       Skip these variables
  -n, --dry-run             Show what would be pushed, push nothing
  -y, --yes                 Don't ask for confirmation
  -v, --version             Print the version
  -h, --help                Show this help

"all" copies every config in --map, each into its own EAS environment.
Run it from your Expo project folder (where app.json / app.config.* lives).

Exit codes: 0 success, 1 a variable failed to push or you cancelled, 2 usage or setup error.`;

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (c, s) => (color ? `\x1b[${c}m${s}\x1b[0m` : s);
const red = (s) => paint(31, s), green = (s) => paint(32, s), yellow = (s) => paint(33, s), dim = (s) => paint(2, s), bold = (s) => paint(1, s);

function usageError(message) {
  console.error(`${red('✖')} ${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = {
    config: null, environment: null, project: null, map: DEFAULT_MAP, publicPrefixes: [],
    visibility: 'secret', only: null, exclude: [], dryRun: false, yes: false,
  };
  const value = (i, name) => {
    if (i >= argv.length || argv[i].startsWith('-')) usageError(`${name} needs a value`);
    return argv[i];
  };
  const csv = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    if (arg.startsWith('--') && arg.includes('=')) {
      argv.splice(i + 1, 0, arg.slice(arg.indexOf('=') + 1));
      arg = arg.slice(0, arg.indexOf('='));
    }
    switch (arg) {
      case '-e': case '--environment': args.environment = value(++i, arg); break;
      case '-p': case '--project': args.project = value(++i, arg); break;
      case '-m': case '--map': args.map = value(++i, arg); break;
      case '--public-prefix': args.publicPrefixes.push(value(++i, arg)); break;
      case '--visibility': args.visibility = value(++i, arg); break;
      case '--only': args.only = csv(value(++i, arg)); break;
      case '--exclude': args.exclude.push(...csv(value(++i, arg))); break;
      case '-n': case '--dry-run': args.dryRun = true; break;
      case '-y': case '--yes': args.yes = true; break;
      case '-v': case '--version': console.log(VERSION); process.exit(0);
      case '-h': case '--help': console.log(HELP); process.exit(0);
      default:
        if (arg.startsWith('-') || args.config) usageError(`Unknown argument: ${arg}`);
        args.config = arg;
    }
  }
  if (!args.config) usageError('Which Doppler config? For example: doppler-to-eas dev, or doppler-to-eas all');
  if (!args.publicPrefixes.length) args.publicPrefixes = ['EXPO_PUBLIC_'];
  if (!['secret', 'sensitive'].includes(args.visibility)) usageError('--visibility must be secret or sensitive');
  if (args.environment && !EAS_ENVIRONMENTS.includes(args.environment)) usageError(`--environment must be one of: ${EAS_ENVIRONMENTS.join(', ')}`);

  args.map = Object.fromEntries(args.map.split(',').map((pair) => {
    const [from, to] = pair.split('=').map((s) => s?.trim());
    if (!from || !EAS_ENVIRONMENTS.includes(to)) usageError(`Bad --map entry "${pair}". Use doppler=eas, e.g. ${DEFAULT_MAP}`);
    return [from, to];
  }));
  if (args.config === 'all' && args.environment) {
    usageError('--environment can’t be used with "all": each config goes to its own EAS environment.');
  }
  return args;
}

function run(command, args) {
  return spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** Reads the config straight into memory (no file is written). */
function dopplerSecrets(config, project) {
  const result = run('doppler', [
    'secrets', 'download', '--no-file', '--format', 'json', '--config', config,
    ...(project ? ['--project', project] : []),
  ]);
  if (result.error) usageError('The Doppler CLI isn’t installed: https://docs.doppler.com/docs/cli');
  if (result.status !== 0) {
    console.error(`${red('✖')} Doppler: ${result.stderr.trim() || 'could not read secrets'}`);
    process.exit(1);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    usageError('Doppler returned something that isn’t JSON. Is the CLI up to date?');
  }
}

/** Uses a global `eas` when there is one, otherwise eas-cli through npx. */
function easCommand() {
  const probe = run('eas', ['--version']);
  return probe.status === 0 ? ['eas', []] : ['npx', ['-y', 'eas-cli@latest']];
}

const redact = (text, value) => (value ? text.split(value).join('••••') : text);

function plan(args, config) {
  const secrets = dopplerSecrets(config, args.project);
  const environment = args.config === 'all' ? args.map[config] : args.environment ?? args.map[secrets.DOPPLER_ENVIRONMENT];
  if (!environment) {
    usageError(`Can’t tell which EAS environment "${config}" belongs to (Doppler environment "${secrets.DOPPLER_ENVIRONMENT}"). Pass --environment or --map.`);
  }
  const wanted = (name) => !name.startsWith('DOPPLER_') && (!args.only || args.only.includes(name)) && !args.exclude.includes(name);
  const entries = Object.entries(secrets).filter(([name]) => wanted(name)).sort(([a], [b]) => a.localeCompare(b));
  if (args.only) {
    const missing = args.only.filter((k) => !(k in secrets));
    if (missing.length) usageError(`Not in Doppler ${config}: ${missing.join(', ')}`);
  }
  return {
    config,
    project: secrets.DOPPLER_PROJECT,
    environment,
    empty: entries.filter(([, v]) => v === '').map(([k]) => k),
    vars: entries.filter(([, v]) => v !== '').map(([name, value]) => ({
      name,
      value,
      visibility: args.publicPrefixes.some((p) => name.startsWith(p)) ? 'plaintext' : args.visibility,
    })),
  };
}

function confirm(question) {
  if (!process.stdin.isTTY) usageError('No terminal to confirm on. Pass --yes to push without a prompt.');
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => { rl.close(); resolve(/^y(es)?$/i.test(a.trim())); });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!['app.json', 'app.config.js', 'app.config.ts', 'app.config.mjs', 'app.config.cjs'].some((f) => existsSync(path.join(process.cwd(), f)))) {
    usageError('No app.json or app.config.* here. Run this from your Expo project folder.');
  }

  const configs = args.config === 'all' ? Object.keys(args.map) : [args.config];
  const plans = configs.map((c) => plan(args, c));

  for (const p of plans) {
    console.log(`${bold(`Doppler ${p.project}/${p.config}`)} → ${bold(`EAS "${p.environment}"`)}${args.dryRun ? dim(' (dry run)') : ''}`);
    for (const v of p.vars) console.log(`  · ${v.name} ${dim(`[${v.visibility}]`)}`);
    if (p.empty.length) console.log(dim(`  Skipped (empty in Doppler): ${p.empty.join(', ')}`));
    console.log('');
  }

  const total = plans.reduce((n, p) => n + p.vars.length, 0);
  if (args.dryRun) {
    console.log(`Dry run: ${total} variable(s) would be pushed. Nothing was changed.`);
    return 0;
  }
  if (!total) {
    console.log('Nothing to push.');
    return 0;
  }
  if (!args.yes && !(await confirm(`Push ${total} variable(s)? Existing EAS variables with the same name are overwritten. [y/N] `))) {
    console.log('Cancelled. Nothing was pushed.');
    return 1;
  }

  const [eas, easPrefix] = easCommand();
  let failures = 0;
  for (const p of plans) {
    console.log(`\n${bold(`→ EAS "${p.environment}"`)}`);
    for (const { name, value, visibility } of p.vars) {
      const result = run(eas, [
        ...easPrefix, 'env:create',
        '--name', name, '--value', value,
        '--environment', p.environment, '--visibility', visibility,
        '--type', 'string', '--scope', 'project', '--force', '--non-interactive',
      ]);
      if (result.status === 0) {
        console.log(`  ${green('✓')} ${name} ${dim(`[${visibility}]`)}`);
      } else {
        failures++;
        const output = redact(`${result.stderr ?? ''}${result.stdout ?? ''}`.trim() || String(result.error ?? ''), value);
        console.log(`  ${red('✖')} ${name}: ${output.split('\n').slice(-3).join(' ')}`);
      }
    }
  }

  if (failures) {
    console.error(`\n${red('✖')} ${failures} variable(s) failed. Are you logged in? Run: npx eas-cli login`);
    return 1;
  }
  console.log(green(`\n✔ Pushed ${total} variable(s).`) + dim(` Check with: npx eas-cli env:list ${plans[0].environment}`));
  return 0;
}

main().then((code) => process.exit(code), (e) => {
  console.error(red(e.stack || e.message));
  process.exit(1);
});
