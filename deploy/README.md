# Deploy directory policy

This directory must not contain chunked runtime payloads, partial base64 artifacts, or CI-generated deployment packages.

Use it only for reviewed deployment documentation or deterministic scripts that do not write back to the repository from CI.

Blocked paths include:

- `deploy/v25.1*`
- `deploy/*/chunks/*`
- `deploy/*/xz*/*`
- `deploy/*/transfer/*`

A production deployment must use explicit source files committed in the repository root or a reviewed branch, not an auto-materialized payload.
