# doppler-to-eas

[![CI](https://github.com/ym-scripts/doppler-to-eas/actions/workflows/ci.yml/badge.svg)](https://github.com/ym-scripts/doppler-to-eas/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Keep your Expo cloud builds in sync with Doppler.** This copies every variable from a [Doppler](https://doppler.com) config into an [EAS environment](https://docs.expo.dev/eas/environment-variables/), so `eas build` uses the same values you run locally.

```bash
npx github:ym-scripts/doppler-to-eas dev --dry-run
```

```text
Doppler my-app/prd → EAS "production"
  · API_SECRET [secret]
  · EXPO_PUBLIC_API_URL [plaintext]
  · SENTRY_AUTH_TOKEN [secret]
  Skipped (empty in Doppler): FEATURE_FLAG_X

Push 3 variable(s)? Existing EAS variables with the same name are overwritten. [y/N]
```

- **Values never touch the disk** and are never printed. EAS error messages are redacted too.
- **Visibility is set for you.** `EXPO_PUBLIC_*` variables ship inside the app bundle anyway, so they're stored as `plaintext`. Everything else is stored as `secret`, which only builds can read.
- **Asks first.** It shows what will be pushed and waits for a yes. `--dry-run` changes nothing.

## Requirements

- Node.js 18+
- [Doppler CLI](https://docs.doppler.com/docs/cli), logged in (`doppler login`)
- EAS CLI, logged in (`npx eas-cli login`). A global `eas` is used if you have one; otherwise it runs through `npx eas-cli@latest`.
- Run it from your Expo project folder (where `app.json` or `app.config.*` lives). Set the Doppler project with `doppler setup` or `--project`.

## Usage

```bash
doppler-to-eas dev                          # Doppler "dev" → EAS "development"
doppler-to-eas stg                          # → "preview"
doppler-to-eas prd                          # → "production"
doppler-to-eas all                          # dev, stg and prd, one after another
doppler-to-eas dev_personal --environment development
doppler-to-eas prd --only SENTRY_DSN,API_URL --yes
```

Add it to your project's `package.json`:

```json
{ "scripts": { "env:eas": "npx -y github:ym-scripts/doppler-to-eas#v0.1.0" } }
```

Then run `pnpm env:eas prd`.

### Options

| Option                    | Default                                      | Description                                                                                                                    |
| ------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `-e`, `--environment ENV` | from `--map`                                 | EAS environment: `development`, `preview` or `production`. Can't be combined with `all`.                                       |
| `-p`, `--project NAME`    | `doppler setup`                              | Doppler project                                                                                                                |
| `-m`, `--map LIST`        | `dev=development,stg=preview,prd=production` | Maps Doppler **environment** slugs to EAS environments. Branch configs such as `dev_personal` use their environment's mapping. |
| `--public-prefix P`       | `EXPO_PUBLIC_`                               | Variables stored as plaintext. Repeatable; replaces the default.                                                               |
| `--visibility V`          | `secret`                                     | Visibility for everything else: `secret` or `sensitive`                                                                        |
| `--only K1,K2`            |                                              | Only push these variables                                                                                                      |
| `--exclude K1,K2`         |                                              | Don't push these variables                                                                                                     |
| `-n`, `--dry-run`         |                                              | List what would be pushed, push nothing                                                                                        |
| `-y`, `--yes`             |                                              | Don't ask for confirmation (required without a terminal, for example in CI)                                                    |

`DOPPLER_*` metadata variables and empty values are always skipped. Existing EAS variables with the same name are overwritten. Variables that exist only in EAS are left alone.

### Exit codes

| Code | Meaning                                                                                             |
| ---- | --------------------------------------------------------------------------------------------------- |
| `0`  | Everything pushed (or dry run)                                                                      |
| `1`  | At least one variable failed, Doppler couldn't read the config, or you cancelled                    |
| `2`  | Usage or setup error (bad option, Doppler CLI missing, not an Expo project, no terminal to confirm) |

## In CI

```yaml
- run: npx -y github:ym-scripts/doppler-to-eas#v0.1.0 prd --yes
  env:
    DOPPLER_TOKEN: ${{ secrets.DOPPLER_TOKEN }} # a service token for the prd config
    EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}
```

## Security notes

- `eas env:create` takes the value as a command-line argument, so it's briefly visible to other processes run by the same user on the same machine (for example in `ps`). Run this on a machine you trust.
- Anything with a public prefix is bundled into your app and readable by anyone with the binary. Never give a real secret a public prefix.

## Development

```bash
npm test     # node:test with fake doppler and eas CLIs
```

## License

[MIT](LICENSE) © Aghogho Meyoron
