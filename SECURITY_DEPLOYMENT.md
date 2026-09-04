# ProxyHarvest Deployment Security

## Why this exists

The V25.1 auto-materialization path was unsafe and has been removed.

The removed workflow could run with `contents: write`, reconstruct an incomplete chunked artifact, fall back to fetching files from an external Vercel preview URL, delete the existing Python/Gradio ZeroGPU runtime files, and push generated output back to `main` without human review.

That is not an acceptable deployment path for ProxyHarvest.

## Required deployment rule

Production deployment must be source-controlled, reviewable, and integrity-checked.

Allowed:

- Commit explicit source/runtime files directly to the repository.
- Use GitHub Actions for syntax checks, tests, and read-only verification.
- Deploy to Vercel from a verified commit or from a locally verified artifact whose contents are explicitly visible.
- Use SHA256 checks as evidence, but only when the bytes being verified are fully present.

Not allowed:

- Auto-committing generated runtime back to `main` from CI.
- `contents: write` workflows for materializing deployment payloads.
- Falling back to arbitrary Vercel preview URLs to hydrate production source.
- Treating incomplete chunk sets as deployable artifacts.
- Deleting `app.py`, `static/`, `deploy_space.py`, or `requirements.txt` as a side effect of a generated deployment job.
- Promoting reachability or preview availability to production verification.

## ProxyHarvest V25.1 status

The V25.1 FetchComplete package should be treated as a local verified artifact until its runtime files are committed explicitly and audited.

Do not reintroduce chunked deployment payloads under `deploy/v25.1*` unless a separate manual review confirms:

1. Every segment is present.
2. The reconstructed artifact hash matches the expected SHA256.
3. The unpacked files are inspected before deployment.
4. CI is read-only unless a human explicitly performs the write.

## Safer next step

Create a clean branch containing the explicit runtime files only:

- `index.html`
- `proxyharvest.html`
- `proxyharvest.js`
- `vercel.json`
- `api/hf-advisor.js`
- verification/changelog files

Then run syntax/browser checks and deploy that branch to Vercel. Do not use auto-materialize workflows.
