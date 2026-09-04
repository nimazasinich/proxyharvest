# Security cleanup status

This marker documents the cleanup intent for the unsafe V25.1 auto-materialization path.

The following must stay removed from production branches:

- `.github/workflows/materialize-v25.1.yml`
- `deploy/v25.1/READY`
- `deploy/v25.1/_content_path_probe.txt`
- `deploy/v25.1/chunks/*`
- `deploy/v25.1/transfer/*`
- `deploy/v25.1/xz/*`
- `deploy/v25.1/xz8/*`
- `deploy/v25.1-xz/*`

Reason: the previous CI path combined an incomplete artifact, unaudited fallback fetches from a Vercel preview URL, destructive root file replacement, and `contents: write` pushback to `main`.

Deployment should resume only from explicit, reviewed runtime files.
