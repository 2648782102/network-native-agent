# Security Policy

## Reporting

Please report vulnerabilities privately through GitHub Security Advisories for this repository. Do not open a public issue containing credentials, private paths, or exploit details.

## Scope

This project is a research sandbox. It does not ship a hosted service, does not accept third-party credentials, and does not perform outbound writes on its own.

## Credentials

- Never commit model API keys, GitHub tokens, SSH keys, or `.env` files.
- Runtime data belongs in `habitat/`, experiments in `work/`; both are ignored by Git.
- If a credential is committed, revoke it first, then rewrite history.

## Supported Versions

Only the latest `main` branch is supported.
