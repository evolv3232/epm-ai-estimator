# EPM AI Estimator V5 - Free Lead Capture

Upload these files to your GitHub repo and overwrite the old files:

- server.js
- package.json
- wix-widget.html
- README.md

Render should redeploy automatically.

## What changed

V5 adds free lead capture.

When the customer clicks **Get My Final Quote**, the widget sends the lead directly to your Render backend.

The backend:
1. Saves the lead to `data/leads.json`
2. Shows it at `/admin`
3. Optionally emails you the lead if Gmail SMTP is configured

## Free lead dashboard

After deploy, open:

https://epm-ai-estimator.onrender.com/admin

## Optional free email notification with Gmail

In Render, add these environment variables:

EMAIL_USER=yourgmail@gmail.com
EMAIL_PASS=your_gmail_app_password
LEAD_EMAIL_TO=yourgmail@gmail.com

Important: EMAIL_PASS must be a Gmail App Password, not your normal Gmail password.

If you skip the email variables, leads still save to `/admin`.
