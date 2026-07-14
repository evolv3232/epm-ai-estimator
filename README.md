# EPM Backend V15 — Clean Rebuild

This package replaces the broken patched backend with a clean modular backend.

## Included

- Existing quote-request lead endpoint: `POST /api/leads`
- Proposal creation: `POST /api/proposals`
- Proposal health test: `GET /api/proposals/health`
- Customer proposal page: `/proposal/:token`
- Approval storage
- Zelle/cash payment-status tracking
- Proposal records page: `/proposals-admin`
- Optional Gmail lead/proposal notifications
- Correct JSON `package.json`

## Deploy to GitHub

Delete the existing backend files in the repository root, then upload the **contents** of this package:

- `package.json`
- `.gitignore`
- `src/`
- `data/`

The repository root should look like:

```text
package.json
src/
  server.js
  routes/
  services/
  utils/
data/
```

Do not rename `src/server.js` to `package.json`.

## Render settings

- Build Command: `npm install`
- Start Command: `npm start`
- Root Directory: leave blank
- Branch: `main`

Then use:

**Manual Deploy → Clear build cache & deploy**

## Verify after deployment

Open:

- `https://epm-ai-estimator.onrender.com/api/health`
- `https://epm-ai-estimator.onrender.com/api/proposals/health`

Both should return `"ok": true`.

## Environment variables

Recommended:

- `PUBLIC_BASE_URL=https://epm-ai-estimator.onrender.com`
- `ALLOWED_ORIGIN=https://www.exteriorpropertymaintenance.com`

Optional email notifications:

- `EMAIL_USER`
- `EMAIL_PASS`
- `LEAD_EMAIL_TO`

## Wix admin widget

Use:

`EPM_Admin_Proposal_Generator_V15.html`

on the hidden Wix admin page after the backend health check succeeds.

## Storage warning

This version stores JSON files in `data/`. On Render's default ephemeral filesystem, records can be erased after redeploys or instance replacement. Add a Render persistent disk or database before depending on this for permanent records.
