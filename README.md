# EPM Backend V7 — OpenAI Visual Estimator

This version removes Regrid completely.

## Measurement sources

The estimator now uses:

- Google Geocoding
- Two Google aerial-image zoom levels
- Four Google Street View directions
- OpenAI vision analysis
- Known image scale calculated from latitude and map zoom

It does not read or require `REGRID_TOKEN`.

## Required Render environment variables

Keep:

- `OPENAI_API_KEY`
- `GOOGLE_MAPS_API_KEY`
- `EMAIL_USER`
- `EMAIL_PASS`
- `LEAD_EMAIL_TO`

Optional:

- `OPENAI_VISION_MODEL` — defaults to `gpt-4o-mini`
- `ALLOWED_ORIGIN`
- `ADMIN_KEY`
- `ADMIN_TIMEZONE`

You may delete `REGRID_TOKEN` from Render because this version does not use it.

## Install

1. Extract this ZIP.
2. Replace `server.js` and `package.json` in GitHub.
3. Commit the changes.
4. Wait for Render to redeploy and show `Live`.
5. Replace the Wix embed with the included OpenAI-only widget file.
6. Test at least five visibly different properties.

## Important accuracy note

These are visual working estimates, not parcel-record or survey measurements. The system uses image scale and multiple views to improve consistency, but EPM should still verify final scope and price.

## Lead dashboard

Open:

`https://epm-ai-estimator.onrender.com/admin`

If you configured `ADMIN_KEY`, use:

`https://epm-ai-estimator.onrender.com/admin?key=YOUR_ADMIN_KEY`


## Verification after deployment

Open these URLs after Render says Live:

- `https://epm-ai-estimator.onrender.com/`
- `https://epm-ai-estimator.onrender.com/api/version`

Both must say:

`7.1-openai-only`

If they do not, Render is still deploying the old GitHub code or the wrong repository/branch.
