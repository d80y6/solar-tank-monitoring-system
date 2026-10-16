# Contributing Guide

This document explains how to contribute to FTM (Fuel Tank Management) so that
work stays tidy, reviewable, and safe for a public repository.

## Core Principles

- Use English for application text, code, and documentation.
- Use file, folder, function, and variable names that are consistent and easy to
  find.
- Never include internal data, credentials, real API keys, passwords, production
  domains, or private network configuration.
- Do not change many things at once without a clear reason.
- Run the local checks before committing and pushing.
- When unsure about field data or security, write the assumption down in the
  documentation instead of claiming it is final.

## Daily Workflow

Before starting:

```powershell
git status
git pull --rebase origin main
pnpm install
```

While working:

```powershell
pnpm dev
```

Before committing:

```powershell
pnpm check
git status
```

Once everything is clean:

```powershell
git add .
git commit -m "type(scope): short summary of the change"
git push origin main
```

## Getting Started From GitHub

If you are starting from scratch:

```powershell
git clone https://github.com/Zendin110206/solar-tank-monitoring-system.git
cd solar-tank-monitoring-system
pnpm install
pnpm check
```

Before each new piece of work:

```powershell
git pull --rebase origin main
```

If a conflict appears:

```text
Stop first. Do not decide by yourself whose files or changes to keep.
```

Never do these without discussing it first:

- `git push --force`;
- deleting someone else's files;
- large structural changes;
- changing the API contract;
- deleting tests;
- committing real data;
- committing `.env.local`.

## Commit Format

Use:

```text
type(scope): short summary
```

Examples:

```text
docs(readme): tidy the project documentation
feat(simulator): add a device payload simulator
feat(api): add the telemetry ingest endpoint
fix(domain): correct the low runtime status
test(telemetry): add a memory store test
chore(repo): clean placeholder folders
```

Common commit types:

| Type | When to use it |
|---|---|
| `feat` | Adding a feature |
| `fix` | Fixing a bug |
| `docs` | Changing documentation |
| `test` | Adding or fixing tests |
| `refactor` | Tidying code without changing behaviour |
| `chore` | Repository maintenance, config, dependencies |
| `style` | Formatting or small presentational changes |

## Code Standards

- Keep domain logic out of the UI.
- Never put an important formula directly inside a page component.
- Use TypeScript types for important data shapes.
- Add tests for logic that affects operational numbers.
- Avoid new dependencies when a built-in feature solves the problem.
- Keep example data in data files rather than scattered across the codebase.

## Documentation Standards

Documentation must:

- be written in clear English;
- explain technical terms in plain language where possible;
- distinguish example data, simulator data, and real data;
- state limitations honestly;
- avoid a personal conversational style;
- never contain private data.

## Required Checks

Before pushing:

```powershell
pnpm check
```

What `pnpm check` runs:

```text
typecheck -> lint -> test -> build
```

If any step fails, fix it before pushing.

## Pull or Push Checklist

Before pushing to `main`:

- `git pull --rebase origin main` has been run.
- No secret files are included.
- No real data is included.
- `pnpm check` passes.
- The commit message is clear.
- The change matches the intended scope.

## Notes About Branches

Small, coordinated work can still happen on `main`.

For larger features, create a branch:

```powershell
git checkout -b feat/<feature-name>
```

Example:

```powershell
git checkout -b feat/dashboard-fetch-api
```

Then push the branch:

```powershell
git push -u origin feat/dashboard-fetch-api
```
