# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org).

## [0.1.0] - 2026-10-27

### Added
- Copy a Doppler config, or all mapped configs, into EAS environments with `eas env:create`.
- `EXPO_PUBLIC_*` variables are stored as plaintext and everything else as secret. Configure this with `--public-prefix` and `--visibility`.
- `--map` for custom Doppler → EAS environment names, and `--environment` to override per run.
- `--only`, `--exclude`, `--dry-run`, and a confirmation prompt (`--yes` to skip it).
- Values are never written to disk or printed. EAS error output is redacted.
