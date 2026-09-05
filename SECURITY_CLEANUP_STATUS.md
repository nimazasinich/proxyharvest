# Security cleanup status

This marker documents the cleanup intent for the unsafe V25.1 auto-materialization path.

The following must stay removed from production branches:

- `deploy/v25.1/*`
- `deploy/v25.1-xz/*`

Reason: the previous CI path combined an incomplete artifact, unaudited fallback fetches from a Vercel preview URL, destructive root file replacement, and `contents: write` pushback to `main`.

Deployment should resume only from explicit, reviewed runtime files.

**Status:** confirmed removed. The `deploy/v25.1*` chunked artifacts were still present in the tree (as an incomplete, non-reconstructable chunk set) until this cleanup pass deleted them. The old `.github/workflows/materialize-v25.1.yml` filename was itself just a stale name on the unrelated, already-safe `Validate ProxyHarvest GitHub Main` job (read-only permissions, no write-back); it has been renamed to `.github/workflows/validate-github-main.yml` to stop it from looking like the removed unsafe workflow.
