# EPM AI Estimator Backend

This is the backend system for the EPM smart quoting workflow.

## What it does

Customer enters an address and selected services.

The backend:

1. Geocodes the address with Google.
2. Pulls a Google Static Maps satellite image.
3. Optionally pulls parcel data from Regrid.
4. Sends the satellite image to AI vision.
5. Generates an EPM Home Profile.
6. Applies EPM pricing formulas.
7. Returns a working estimate.

## Required APIs

Google Cloud:
- Maps JavaScript API
- Places API
- Geocoding API
- Static Maps API

OpenAI:
- OpenAI API key for vision analysis

Optional:
- Regrid parcel token

## Setup

1. Install Node.js.
2. Open this folder in your terminal.
3. Run:

```bash
npm install
```

4. Copy `.env.example` to `.env`.

```bash
cp .env.example .env
```

5. Add your API keys inside `.env`.

6. Start the backend:

```bash
npm start
```

7. Test in your browser:

```text
http://localhost:3000
```

## Test estimate request

Use Postman, Thunder Client, or your frontend:

```json
{
  "address": "11751 Greensbrook Garden Dr, Houston, TX",
  "services": ["lawn", "surface", "houseWindow", "gutters"]
}
```

POST to:

```text
http://localhost:3000/api/estimate
```

## Important

This is the backend. Wix cannot run this directly inside an HTML embed.

You need to host this backend on:
- Render
- Railway
- Replit
- Vercel
- Fly.io
- Your own VPS

Then your Wix widget calls the hosted backend URL.
