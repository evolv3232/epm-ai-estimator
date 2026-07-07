# EPM AI Estimator Backend V2

This version adds:

- Aerial/satellite image display
- Street View image display
- Backend image proxy so your Google key is not exposed in image URLs
- AI analysis using both aerial and street-view images
- EPM Home Profile output
- EPM quote output

## Replace these files in GitHub

Upload these files to your existing `epm-ai-estimator` GitHub repo:

- `server.js`
- `package.json`
- `wix-widget.html`

Then Render should redeploy automatically.

## Render Environment Variables

Keep these:

- OPENAI_API_KEY
- GOOGLE_MAPS_API_KEY
- REGRID_TOKEN
- ALLOWED_ORIGIN

No PORT needed.

## After deploy

Open:

https://epm-ai-estimator.onrender.com/

You should see version 2.0.
