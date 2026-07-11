# EPM Backend — Regrid Response Parsing Fix

This version fixes the real Regrid problem shown in Render logs.

## Root cause

Regrid API v2 returns U.S. parcel features under:

`response.parcels.features`

The previous backend only checked:

`response.features`

That made a successful HTTP 200 response look like it contained zero parcels.

Regrid's standardized fields are also nested under:

`feature.properties.fields`

The previous code mostly checked only `feature.properties`.

## What this version changes

- Reads `data.parcels.features` correctly
- Still supports direct `data.features` responses
- Reads nested `feature.properties.fields`
- Retries with a 30-meter radius when an exact point misses
- Falls back to Regrid's address endpoint, not invented measurements
- Uses real Regrid parcel geometry for parcel square footage
- Uses matched building footprint data when available
- Keeps the hardcoded 7,200 sq ft fallback removed
- Locks parcel area so AI cannot overwrite verified Regrid geometry

## Install

1. Extract this ZIP.
2. Replace `server.js` in the GitHub repository.
3. Commit the change.
4. Wait for Render to redeploy and show Live.
5. Test several properties.
6. Review Render logs.

Expected logs now include:

- `Regrid exact-point lookup feature count: 1`
- Parcel headline
- Geometry type
- Regrid parcel field keys
