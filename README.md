# EPM Stable Measurements Update

Fixes:
- Internal pricing formulas and rounding language are hidden from customers.
- The same property measurements are reused when service selections change.
- Lawn price no longer changes when another service is added.
- Browser and backend measurement caching last 14 days.
- Quote pricing still recalculates only from selected services.

Deploy:
1. Replace GitHub root `server.js` and `package.json`.
2. Commit and redeploy Render.
3. Replace Wix embed with `wix-widget.html`.

Optional Render variable:
`MEASUREMENT_CACHE_DAYS=14`
