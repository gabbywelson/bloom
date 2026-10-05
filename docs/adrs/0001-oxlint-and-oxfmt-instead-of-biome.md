# 0001. Oxlint + Oxfmt for lint and format, not Biome

Date: 2026-10-04

## Context

The brief suggested Biome for lint/format, but the repo already had Oxlint
installed and configured with the Effect team's `@effect/tsgo` presets
(`oxlint-presets/recommended.json`, type-aware rules via `oxlint-tsgolint`).
Those presets encode Effect-specific lint rules we want. Biome does not
consume them, and running two linters is noise.

Formatting still needed a tool. Oxfmt (same project as Oxlint) is a
Prettier-compatible formatter that handles TS/JS, Svelte, JSON, YAML,
Markdown and CSS, which covers every file type in this repo.

## Decision

- Lint: Oxlint with the Effect presets (`.oxlintrc.json`).
- Format: Oxfmt (`.oxfmtrc.json`).
- Pre-commit via Lefthook runs both on staged files; pre-push runs
  typecheck and tests.
- Biome is not added.

## Consequences

- One toolchain (oxc) for lint and format; both finish in milliseconds.
- Svelte files are formatted by Oxfmt. Svelte-specific _lint_ rules
  (eslint-plugin-svelte) are not enforced yet; `svelte-check` covers types.
- If Oxfmt's Svelte output proves rough, swap only the formatter for
  Prettier + prettier-plugin-svelte without touching lint.
