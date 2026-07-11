# EPM Backend V6 — Complete Lead Storage

This backend update stores and displays the entire quote submission.

## Replace these files in GitHub

- `server.js`
- `package.json`

Commit the changes. Render should redeploy automatically.

## Lead dashboard

Open:

`https://epm-ai-estimator.onrender.com/admin`

The dashboard now shows:

- Customer name, phone, email, and notes
- Property address and metrics
- Aerial and Street View images
- Every selected service
- Maintenance schedule selections
- Bush, limb, and stain-treatment quantities
- House-wash sides
- Every itemized quote line
- Subtotal, bundle discount, savings, and estimated total
- Full text copy of the submitted estimate

## Optional admin protection

In Render → Environment, add:

- Key: `ADMIN_KEY`
- Value: any private password-like string you choose

Then open the dashboard using:

`https://epm-ai-estimator.onrender.com/admin?key=YOUR_ADMIN_KEY`

If `ADMIN_KEY` is not set, `/admin` remains publicly accessible.

## Email environment variables

Keep these in Render:

- `EMAIL_USER`
- `EMAIL_PASS`
- `LEAD_EMAIL_TO`

## Important storage note

This version saves leads to `data/leads.json`. A normal Render web-service filesystem can be replaced during redeploys or restarts. Email notifications remain a separate copy of each lead. For durable long-term storage, connect a database or persistent disk later.


## No-fallback measurement update

This version removes the hardcoded 7,200 sq ft parcel fallback and the repeated ~4,600 sq ft lawn result.

If Regrid does not return a usable parcel or building size, the API now returns an error instead of inventing measurements.

### Upload instructions

1. Extract this ZIP.
2. In GitHub, replace `server.js` with the included file.
3. Keep `package.json` unchanged unless GitHub asks you to replace it too.
4. Commit the changes.
5. Wait for Render to redeploy and show `Live`.
6. Test several different properties.
7. Check Render logs for:
   - Regrid HTTP status
   - Regrid feature count
   - Parcel properties
   - Geometry type

### Required Render environment variable

`REGRID_TOKEN` must contain your valid Regrid token.
