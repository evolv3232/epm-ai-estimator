import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || "*"
}));

app.use(express.json({ limit: "25mb" }));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const REGRID_TOKEN = process.env.REGRID_TOKEN || "";

const LEADS_DIR = path.join(process.cwd(), "data");
const LEADS_FILE = path.join(LEADS_DIR, "leads.json");

function ensureLeadsFile() {
  if (!fs.existsSync(LEADS_DIR)) fs.mkdirSync(LEADS_DIR, { recursive: true });
  if (!fs.existsSync(LEADS_FILE)) fs.writeFileSync(LEADS_FILE, "[]", "utf8");
}

function readLeads() {
  ensureLeadsFile();
  try {
    return JSON.parse(fs.readFileSync(LEADS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveLead(lead) {
  ensureLeadsFile();
  const leads = readLeads();
  leads.unshift(lead);
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2), "utf8");
  return lead;
}

function requireEnv() {
  const missing = [];
  if (!process.env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (!GOOGLE_MAPS_API_KEY) missing.push("GOOGLE_MAPS_API_KEY");
  return missing;
}

function roundTo(value, step) {
  return Math.round(value / step) * step;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function geocodeAddress(address) {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", GOOGLE_MAPS_API_KEY);

  const res = await fetch(url);
  const data = await res.json();

  if (data.status !== "OK" || !data.results?.length) {
    throw new Error(`Google geocoding failed: ${data.status || "UNKNOWN"}`);
  }

  const result = data.results[0];
  return {
    formattedAddress: result.formatted_address,
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng
  };
}

function staticMapUrl(lat, lng, zoom = 20, size = "640x640", maptype = "satellite") {
  const url = new URL("https://maps.googleapis.com/maps/api/staticmap");
  url.searchParams.set("center", `${lat},${lng}`);
  url.searchParams.set("zoom", String(zoom));
  url.searchParams.set("size", size);
  url.searchParams.set("scale", "2");
  url.searchParams.set("maptype", maptype);
  url.searchParams.set("key", GOOGLE_MAPS_API_KEY);
  return url.toString();
}

function streetViewUrl(lat, lng, size = "640x640") {
  const url = new URL("https://maps.googleapis.com/maps/api/streetview");
  url.searchParams.set("size", size);
  url.searchParams.set("location", `${lat},${lng}`);
  url.searchParams.set("fov", "80");
  url.searchParams.set("heading", "0");
  url.searchParams.set("pitch", "5");
  url.searchParams.set("key", GOOGLE_MAPS_API_KEY);
  return url.toString();
}

async function getImageAsBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return buffer.toString("base64");
}

async function fetchRegridParcel(lat, lng) {
  if (!REGRID_TOKEN) {
    console.error("REGRID_TOKEN is missing from Render environment variables.");
    return null;
  }

  try {
    const url = new URL("https://app.regrid.com/api/v2/parcels/point");
    url.searchParams.set("token", REGRID_TOKEN);
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("limit", "1");

    const res = await fetch(url);
    const responseText = await res.text();

    console.log("Regrid request coordinates:", { lat, lng });
    console.log("Regrid HTTP status:", res.status);

    if (!res.ok) {
      console.error("Regrid response:", responseText);
      return null;
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error("Regrid returned invalid JSON:", responseText);
      return null;
    }

    console.log("Regrid feature count:", data?.features?.length || 0);

    const feature = data?.features?.[0] || null;

    if (!feature) {
      console.error("Regrid returned no parcel feature for these coordinates.");
      return null;
    }

    console.log("Regrid parcel properties:", feature.properties || {});
    console.log("Regrid geometry type:", feature.geometry?.type || null);

    return feature;
  } catch (error) {
    console.error("Regrid request error:", error);
    return null;
  }
}

function polygonAreaSqMeters(ring) {
  const R = 6378137;
  let area = 0;
  if (!ring || ring.length < 3) return 0;

  for (let i = 0; i < ring.length; i++) {
    const p1 = ring[i];
    const p2 = ring[(i + 1) % ring.length];

    const lon1 = p1[0] * Math.PI / 180;
    const lon2 = p2[0] * Math.PI / 180;
    const lat1 = p1[1] * Math.PI / 180;
    const lat2 = p2[1] * Math.PI / 180;

    area += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }

  return Math.abs(area * R * R / 2);
}

function parcelAreaSqFt(feature) {
  const geometry = feature?.geometry;
  if (!geometry) return null;

  try {
    let sqm = 0;
    if (geometry.type === "Polygon") {
      sqm += polygonAreaSqMeters(geometry.coordinates[0]);
    } else if (geometry.type === "MultiPolygon") {
      geometry.coordinates.forEach(poly => {
        sqm += polygonAreaSqMeters(poly[0]);
      });
    }
    return sqm * 10.7639;
  } catch {
    return null;
  }
}

function propAny(props, keys) {
  if (!props) return null;
  const lower = {};
  Object.keys(props).forEach(k => lower[k.toLowerCase()] = props[k]);

  for (const key of keys) {
    const value = lower[key.toLowerCase()];
    if (value !== undefined && value !== null && value !== "" && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function regridFallbackProfile(feature) {
  if (!feature) {
    throw new Error(
      "Unable to verify parcel data. Regrid did not return a usable parcel for this property."
    );
  }

  const props = feature?.properties || {};

  const parcelSqFt =
    parcelAreaSqFt(feature) ||
    propAny(props, [
      "ll_gissqft",
      "gis_sqft",
      "land_sqft",
      "lot_sqft",
      "parcel_sqft"
    ]);

  if (!parcelSqFt || parcelSqFt <= 0) {
    throw new Error(
      "Unable to determine parcel size from the Regrid response."
    );
  }

  let livingArea = propAny(props, [
    "bldg_sqft",
    "building_sqft",
    "living_area",
    "livingarea",
    "sqft_living",
    "total_area",
    "res_area",
    "impr_sqft",
    "struct_sqft"
  ]);

  let stories = propAny(props, [
    "stories",
    "num_stories",
    "story",
    "bldg_stories"
  ]);

  if (!stories && livingArea) {
    stories = livingArea > 2100 ? 2 : 1;
  }

  stories = stories && stories >= 2 ? 2 : 1;

  if (!livingArea) {
    throw new Error(
      "Regrid returned a parcel, but no usable building-size data was found."
    );
  }

  const footprint = livingArea / stories;

  const driveway = clamp(parcelSqFt * 0.055, 340, 700);
  const walkway = clamp(parcelSqFt * 0.010, 55, 140);
  const entry = clamp(parcelSqFt * 0.006, 30, 70);
  const sidewalk = clamp(Math.sqrt(parcelSqFt) * 1.9, 120, 260);
  const totalSurface = driveway + walkway + entry + sidewalk;
  const fence = clamp(Math.sqrt(parcelSqFt) * 2.25, 145, 310);
  const roofArea = livingArea * (stories === 2 ? 1.10 : 1.25);

  const lawnArea =
    parcelSqFt -
    footprint -
    totalSurface;

  if (lawnArea <= 0 || lawnArea >= parcelSqFt) {
    throw new Error(
      "Calculated lawn area was not plausible for this parcel."
    );
  }

  return {
    parcelAreaSqFt: roundTo(parcelSqFt, 25),
    livingAreaSqFt: roundTo(livingArea, 25),
    stories,
    lawnAreaSqFt: roundTo(lawnArea, 25),
    drivewaySqFt: roundTo(driveway, 10),
    walkwaySqFt: roundTo(walkway, 5),
    entryPorchSqFt: roundTo(entry, 5),
    sidewalkSqFt: roundTo(sidewalk, 5),
    totalSurfaceSqFt: roundTo(totalSurface, 10),
    fenceLinearFt: roundTo(fence, 5),
    roofAreaSqFt: roundTo(roofArea, 25),
    windowCount: stories === 2 ? 22 : 14,
    confidence: "medium",
    source: "Regrid parcel + EPM formulas",
    measurementStatus: "verified_parcel"
  };
}

async function aiAnalyzeImages({ satelliteBase64, streetBase64, address, lat, lng, fallbackProfile }) {
  const prompt = `
You are EPM's exterior property estimating assistant.

Analyze the satellite image and street view image for:
${address}
Coordinates: ${lat}, ${lng}

Goal:
Estimate practical working measurements for EPM exterior property maintenance quotes.

Return ONLY valid JSON with this exact schema:
{
  "propertyType": "single_family_residential | townhouse | unknown",
  "stories": number,
  "parcelAreaSqFt": number,
  "livingAreaSqFt": number,
  "lawnAreaSqFt": number,
  "drivewaySqFt": number,
  "walkwaySqFt": number,
  "entryPorchSqFt": number,
  "sidewalkSqFt": number,
  "totalSurfaceSqFt": number,
  "fenceLinearFt": number,
  "roofAreaSqFt": number,
  "windowCount": number,
  "confidence": "low | medium | high",
  "measurementNotes": string[]
}

Use these fallback values as a starting reference if the images are unclear:
${JSON.stringify(fallbackProfile, null, 2)}

Rules:
- Use one solid number for each metric, not a range.
- Total surface must equal driveway + walkway + entryPorch + sidewalk.
- Use the satellite image primarily for lawn, concrete, roof, and fence.
- Use street view primarily for stories, front windows, garage/driveway context, and visible entry/walkway.
- Be conservative but practical for quoting.
- If the images are unclear, use fallback values and set confidence to low or medium.
- Do not claim exactness. These are working estimates.
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:image/png;base64,${satelliteBase64}` } },
          { type: "image_url", image_url: { url: `data:image/png;base64,${streetBase64}` } }
        ]
      }
    ],
    response_format: { type: "json_object" },
    temperature: 0.2
  });

  const text = response.choices[0]?.message?.content || "{}";
  const parsed = JSON.parse(text);

  const totalSurface =
    Number(parsed.drivewaySqFt || 0) +
    Number(parsed.walkwaySqFt || 0) +
    Number(parsed.entryPorchSqFt || 0) +
    Number(parsed.sidewalkSqFt || 0);

  return {
    propertyType: parsed.propertyType || "unknown",
    stories: Number(parsed.stories || fallbackProfile.stories || 1),
    parcelAreaSqFt: roundTo(Number(parsed.parcelAreaSqFt || fallbackProfile.parcelAreaSqFt), 25),
    livingAreaSqFt: roundTo(Number(parsed.livingAreaSqFt || fallbackProfile.livingAreaSqFt), 25),
    lawnAreaSqFt: roundTo(Number(parsed.lawnAreaSqFt || fallbackProfile.lawnAreaSqFt), 25),
    drivewaySqFt: roundTo(Number(parsed.drivewaySqFt || fallbackProfile.drivewaySqFt), 10),
    walkwaySqFt: roundTo(Number(parsed.walkwaySqFt || fallbackProfile.walkwaySqFt), 5),
    entryPorchSqFt: roundTo(Number(parsed.entryPorchSqFt || fallbackProfile.entryPorchSqFt), 5),
    sidewalkSqFt: roundTo(Number(parsed.sidewalkSqFt || fallbackProfile.sidewalkSqFt), 5),
    totalSurfaceSqFt: roundTo(totalSurface || fallbackProfile.totalSurfaceSqFt, 10),
    fenceLinearFt: roundTo(Number(parsed.fenceLinearFt || fallbackProfile.fenceLinearFt), 5),
    roofAreaSqFt: roundTo(Number(parsed.roofAreaSqFt || fallbackProfile.roofAreaSqFt), 25),
    windowCount: Math.round(Number(parsed.windowCount || fallbackProfile.windowCount || 20)),
    confidence: parsed.confidence || fallbackProfile.confidence || "medium",
    measurementNotes: Array.isArray(parsed.measurementNotes) ? parsed.measurementNotes : [],
    source: "Google Satellite + Google Street View + AI Vision + Regrid/EPM fallback"
  };
}

function quoteFromMetrics(metrics, services) {
  const lineItems = [];

  const add = (name, calculation, price) => {
    lineItems.push({ name, calculation, price: Math.round(price) });
  };

  if (services.includes("lawn")) add("Lawn Care", `${metrics.lawnAreaSqFt} sq ft`, 0);
  if (services.includes("surface")) add("Surface Cleaning", `${metrics.totalSurfaceSqFt} sq ft × $0.20`, metrics.totalSurfaceSqFt * 0.20);
  if (services.includes("houseWindow")) add("House & Window Wash", `${metrics.livingAreaSqFt} sq ft`, 0);
  if (services.includes("fence")) add("Fence Washing", `${metrics.fenceLinearFt} linear ft`, 0);
  if (services.includes("gutters")) add("Gutter Cleaning", metrics.stories >= 2 ? "Two-story flat rate" : "One-story flat rate", metrics.stories >= 2 ? 225 : 175);
  if (services.includes("roof")) add("Roof Cleaning", `${metrics.roofAreaSqFt} sq ft`, 0);

  const subtotal = lineItems.reduce((sum, item) => sum + item.price, 0);
  return {
    lineItems,
    subtotal,
    discountRate: 0,
    savings: 0,
    total: subtotal
  };
}


function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function moneyDisplay(value) {
  return "$" + Math.round(Number(value || 0)).toLocaleString();
}

function formatSubmittedDate(value) {
  try {
    return new Date(value).toLocaleString("en-US", {
      timeZone: process.env.ADMIN_TIMEZONE || "America/Chicago",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  } catch {
    return value || "";
  }
}

function leadMatchesAdminKey(req) {
  const required = process.env.ADMIN_KEY;
  if (!required) return true;
  return req.query.key === required;
}

function leadToText(lead) {
  const q = lead.quote || {};
  const m = lead.metrics || {};
  const customer = lead.customer || {};

  let text = "";
  text += "New EPM Final Quote Request\n\n";
  text += `Submitted: ${lead.createdAt}\n`;
  text += `Lead ID: ${lead.id}\n\n`;

  text += "Customer\n";
  text += `Name: ${customer.name || ""}\n`;
  text += `Phone: ${customer.phone || ""}\n`;
  text += `Email: ${customer.email || ""}\n`;
  text += `Preferred Callback: ${customer.preferredTime || ""}\n`;
  text += `Notes: ${customer.notes || ""}\n\n`;

  text += "Property\n";
  text += `Address: ${lead.property?.formattedAddress || ""}\n`;
  text += `Lat/Lng: ${lead.property?.lat || ""}, ${lead.property?.lng || ""}\n\n`;

  text += "Measurements\n";
  text += `Stories: ${m.stories || ""}\n`;
  text += `Parcel: ${m.parcelAreaSqFt || ""} sq ft\n`;
  text += `Living: ${m.livingAreaSqFt || ""} sq ft\n`;
  text += `Lawn: ${m.lawnAreaSqFt || ""} sq ft\n`;
  text += `Driveway: ${m.drivewaySqFt || ""} sq ft\n`;
  text += `Walkway: ${m.walkwaySqFt || ""} sq ft\n`;
  text += `Entry/Porch: ${m.entryPorchSqFt || ""} sq ft\n`;
  text += `Sidewalk: ${m.sidewalkSqFt || ""} sq ft\n`;
  text += `Total Surface: ${m.totalSurfaceSqFt || ""} sq ft\n`;
  text += `Fence: ${m.fenceLinearFt || ""} linear ft\n`;
  text += `Roof: ${m.roofAreaSqFt || ""} sq ft\n`;
  text += `Window Panes: ${lead.windowPanes || ""}\n\n`;

  text += "Selected Services\n";
  (lead.selectedServices || []).forEach(item => {
    text += `- ${item}\n`;
  });

  text += "\nMaintenance Schedule\n";
  (lead.serviceFrequencies || []).forEach(item => {
    text += `- ${item}\n`;
  });

  if (lead.houseWashSides?.length) {
    text += `\nHouse Wash Sides: ${lead.houseWashSides.join(", ")}\n`;
  }

  const quantities = lead.addOnQuantities || {};
  if (Object.keys(quantities).length) {
    text += "\nAdd-On Quantities\n";
    text += `- Bushes: ${quantities.bushes || 0}\n`;
    text += `- Tree Limbs: ${quantities.treeLimbs || 0}\n`;
    text += `- Affected Car Spaces: ${quantities.stainSpaces || 0}\n`;
  }

  text += "\nItemized Quote\n";
  (q.lines || []).forEach(line => {
    text += `- ${line.name}: ${line.custom ? "Custom Quote" : "$" + Math.round(line.price || 0)}\n`;
    (line.children || []).forEach(child => {
      text += `   • ${child[0]}: ${child[1]} = ${child[2]}\n`;
    });
  });

  text += `\nSubtotal: $${q.subtotal || 0}\n`;
  text += `Discount: ${Math.round((q.discountRate || 0) * 100)}%\n`;
  text += `Savings: $${q.savings || 0}\n`;
  text += `Estimated Total: $${q.total || 0}\n`;

  return text;
}

async function sendLeadEmail(lead) {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  const to = process.env.LEAD_EMAIL_TO || user;

  if (!user || !pass || !to) {
    return { sent: false, reason: "Email environment variables not configured" };
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass }
  });

  await transporter.sendMail({
    from: `"EPM Quote Widget" <${user}>`,
    to,
    subject: `New EPM Final Quote Request - ${lead.customer?.name || "Website Lead"}`,
    text: leadToText(lead)
  });

  return { sent: true };
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    name: "EPM AI Estimator Backend",
    version: "5.0-leads",
    endpoints: ["/api/estimate", "/api/property-image", "/api/leads", "/admin"]
  });
});

app.get("/admin", (req, res) => {
  if (!leadMatchesAdminKey(req)) {
    return res.status(401).send("Unauthorized. Add ?key=YOUR_ADMIN_KEY to the URL.");
  }

  const leads = readLeads();
  const adminKeyQuery = process.env.ADMIN_KEY ? `?key=${encodeURIComponent(process.env.ADMIN_KEY)}` : "";

  const cards = leads.map((lead, index) => {
    const customer = lead.customer || {};
    const property = lead.property || {};
    const metrics = lead.metrics || {};
    const quote = lead.quote || lead.quoteSnapshot || {};
    const lines = quote.lines || quote.lineItems || [];
    const frequencies = lead.serviceFrequencies || [];
    const selectedServices = lead.selectedServices || [];
    const quantities = lead.addOnQuantities || {};
    const images = lead.images || {};

    const servicesHtml = selectedServices.length
      ? selectedServices.map(item => `<li>${escapeHtml(item)}</li>`).join("")
      : "<li>No services recorded</li>";

    const frequencyHtml = frequencies.length
      ? frequencies.map(item => `<li>${escapeHtml(item)}</li>`).join("")
      : "<li>One-time / no schedule recorded</li>";

    const lineItemsHtml = lines.length
      ? lines.map(line => {
          const children = (line.children || []).map(child => `
            <tr>
              <td class="indent">${escapeHtml(child[0])}</td>
              <td>${escapeHtml(child[1])}</td>
              <td class="amount">${escapeHtml(child[2])}</td>
            </tr>
          `).join("");

          return `
            <tr class="service-row">
              <td><strong>${escapeHtml(line.name)}</strong></td>
              <td>${line.custom ? "Custom Quote" : "Estimated service price"}</td>
              <td class="amount"><strong>${line.custom ? "Custom Quote" : moneyDisplay(line.price)}</strong></td>
            </tr>
            ${children}
          `;
        }).join("")
      : `<tr><td colspan="3">No quote line items were stored.</td></tr>`;

    const satelliteUrl = images.satellite
      ? (String(images.satellite).startsWith("http") ? images.satellite : `${req.protocol}://${req.get("host")}${images.satellite}`)
      : "";
    const streetUrl = images.street
      ? (String(images.street).startsWith("http") ? images.street : `${req.protocol}://${req.get("host")}${images.street}`)
      : "";

    return `
      <details class="lead-card" ${index === 0 ? "open" : ""}>
        <summary>
          <div>
            <span class="status-pill">${lead.callbackOnly ? "Callback Request" : "Final Quote Request"}</span>
            <h2>${escapeHtml(customer.name || "Unnamed Lead")}</h2>
            <p>${escapeHtml(property.formattedAddress || "No property address")}</p>
          </div>
          <div class="summary-right">
            <strong>${moneyDisplay(quote.total)}</strong>
            <span>${escapeHtml(formatSubmittedDate(lead.createdAt || lead.submittedAt))}</span>
          </div>
        </summary>

        <div class="lead-body">
          <section>
            <h3>Customer</h3>
            <div class="facts">
              <div><span>Name</span><strong>${escapeHtml(customer.name)}</strong></div>
              <div><span>Phone</span><strong><a href="tel:${escapeHtml(customer.phone)}">${escapeHtml(customer.phone)}</a></strong></div>
              <div><span>Email</span><strong><a href="mailto:${escapeHtml(customer.email)}">${escapeHtml(customer.email)}</a></strong></div>
              <div><span>Lead ID</span><strong>${escapeHtml(lead.id)}</strong></div>
            </div>
            ${customer.notes ? `<div class="notes"><strong>Customer notes</strong><p>${escapeHtml(customer.notes)}</p></div>` : ""}
          </section>

          <section>
            <h3>Property</h3>
            <div class="facts">
              <div><span>Address</span><strong>${escapeHtml(property.formattedAddress)}</strong></div>
              <div><span>Stories</span><strong>${escapeHtml(metrics.stories)}</strong></div>
              <div><span>Living Area</span><strong>${escapeHtml(metrics.livingAreaSqFt)} sq ft</strong></div>
              <div><span>Parcel Area</span><strong>${escapeHtml(metrics.parcelAreaSqFt)} sq ft</strong></div>
              <div><span>Lawn</span><strong>${escapeHtml(metrics.lawnAreaSqFt)} sq ft</strong></div>
              <div><span>Total Surface</span><strong>${escapeHtml(metrics.totalSurfaceSqFt)} sq ft</strong></div>
              <div><span>Roof</span><strong>${escapeHtml(metrics.roofAreaSqFt)} sq ft</strong></div>
              <div><span>Fence</span><strong>${escapeHtml(metrics.fenceLinearFt)} linear ft</strong></div>
              <div><span>Window Panes</span><strong>${escapeHtml(lead.windowPanes)}</strong></div>
            </div>
          </section>

          ${(satelliteUrl || streetUrl) ? `
          <section>
            <h3>Property Views</h3>
            <div class="image-grid">
              ${satelliteUrl ? `<div><span>Aerial View</span><img src="${escapeHtml(satelliteUrl)}" alt="Aerial property view"></div>` : ""}
              ${streetUrl ? `<div><span>Street View</span><img src="${escapeHtml(streetUrl)}" alt="Street property view"></div>` : ""}
            </div>
          </section>` : ""}

          <section class="two-column">
            <div>
              <h3>Selected Services</h3>
              <ul>${servicesHtml}</ul>
            </div>
            <div>
              <h3>Maintenance Schedule</h3>
              <ul>${frequencyHtml}</ul>
            </div>
          </section>

          <section>
            <h3>Add-On Quantities</h3>
            <div class="facts">
              <div><span>Bushes</span><strong>${escapeHtml(quantities.bushes || 0)}</strong></div>
              <div><span>Low Tree Limbs</span><strong>${escapeHtml(quantities.treeLimbs || 0)}</strong></div>
              <div><span>Affected Car Spaces</span><strong>${escapeHtml(quantities.stainSpaces || 0)}</strong></div>
              <div><span>House-Wash Sides</span><strong>${escapeHtml((lead.houseWashSides || []).join(", ") || "None")}</strong></div>
            </div>
          </section>

          <section>
            <h3>Complete Submitted Quote</h3>
            <div class="quote-table-wrap">
              <table class="quote-table">
                <thead><tr><th>Service / Area</th><th>Calculation</th><th>Price</th></tr></thead>
                <tbody>${lineItemsHtml}</tbody>
              </table>
            </div>

            <div class="totals">
              <div><span>Subtotal</span><strong>${moneyDisplay(quote.subtotal)}</strong></div>
              <div><span>Bundle Discount</span><strong>${Math.round(Number(quote.discountRate || 0) * 100)}%</strong></div>
              <div><span>Savings</span><strong>${moneyDisplay(quote.savings)}</strong></div>
              <div class="grand-total"><span>Estimated Total</span><strong>${moneyDisplay(quote.total)}</strong></div>
            </div>
          </section>

          ${lead.estimateText ? `
          <section>
            <h3>Text Copy of Submitted Estimate</h3>
            <pre>${escapeHtml(lead.estimateText)}</pre>
          </section>` : ""}
        </div>
      </details>
    `;
  }).join("");

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>EPM Lead Dashboard</title>
        <style>
          *{box-sizing:border-box}
          body{font-family:Arial,sans-serif;margin:0;padding:24px;background:#eef4ec;color:#061b33}
          .page{max-width:1200px;margin:auto}
          .topbar{background:linear-gradient(135deg,#061b33,#123a63);color:white;border-radius:18px;padding:24px;margin-bottom:18px}
          .topbar h1{margin:0 0 6px}
          .topbar p{margin:0;color:#d9ead8}
          .lead-card{background:white;border:1px solid #cfddca;border-radius:16px;margin:14px 0;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,.06)}
          summary{cursor:pointer;display:flex;justify-content:space-between;gap:16px;align-items:center;padding:18px;list-style:none}
          summary::-webkit-details-marker{display:none}
          summary h2{margin:7px 0 4px;font-size:20px}
          summary p{margin:0;color:#64748b}
          .summary-right{text-align:right;display:grid;gap:5px}
          .summary-right strong{font-size:24px;color:#2f7d20}
          .summary-right span{font-size:12px;color:#64748b}
          .status-pill{display:inline-block;background:#eaf5e6;color:#256818;padding:5px 9px;border-radius:999px;font-size:11px;font-weight:bold}
          .lead-body{padding:0 18px 20px;border-top:1px solid #e2e8f0}
          section{padding-top:18px}
          section h3{margin:0 0 11px}
          .facts{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
          .facts div{background:#f8fafc;border:1px solid #e2e8f0;border-radius:11px;padding:11px}
          .facts span{display:block;color:#64748b;font-size:11px;margin-bottom:4px}
          .facts strong{font-size:14px}
          a{color:#2f7d20}
          .notes{margin-top:10px;padding:12px;border-left:4px solid #2f7d20;background:#f7fbf5}
          .notes p{margin:6px 0 0}
          .two-column{display:grid;grid-template-columns:1fr 1fr;gap:14px}
          .two-column>div{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px}
          ul{margin:0;padding-left:20px}
          li{margin:5px 0}
          .image-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
          .image-grid div{border:1px solid #d7e4d2;border-radius:12px;overflow:hidden}
          .image-grid span{display:block;background:#061b33;color:white;padding:8px 10px;font-weight:bold;font-size:12px}
          .image-grid img{width:100%;display:block;aspect-ratio:1/1;object-fit:cover}
          .quote-table-wrap{overflow:auto}
          .quote-table{width:100%;border-collapse:collapse;background:white}
          .quote-table th,.quote-table td{border:1px solid #e2e8f0;padding:9px;text-align:left;font-size:13px}
          .quote-table th{background:#061b33;color:white}
          .quote-table .service-row td{background:#f4f8f3}
          .quote-table .indent{padding-left:25px}
          .quote-table .amount{text-align:right;white-space:nowrap}
          .totals{margin-left:auto;margin-top:12px;max-width:420px}
          .totals div{display:flex;justify-content:space-between;padding:8px;border-bottom:1px solid #e2e8f0}
          .totals .grand-total{font-size:19px;border-top:2px solid #2f7d20;border-bottom:0}
          .totals .grand-total strong{color:#2f7d20;font-size:24px}
          pre{white-space:pre-wrap;background:#071a2f;color:#e5f4e1;padding:15px;border-radius:12px;overflow:auto;font-size:12px}
          .empty{background:white;border-radius:14px;padding:24px;text-align:center}
          @media(max-width:800px){
            body{padding:12px}
            summary{align-items:flex-start}
            .facts{grid-template-columns:1fr 1fr}
            .two-column,.image-grid{grid-template-columns:1fr}
          }
          @media(max-width:480px){
            .facts{grid-template-columns:1fr}
            summary{display:block}
            .summary-right{text-align:left;margin-top:10px}
          }
        </style>
      </head>
      <body>
        <div class="page">
          <div class="topbar">
            <h1>EPM Lead Dashboard</h1>
            <p>${leads.length} saved lead${leads.length === 1 ? "" : "s"} · complete submitted quotes and property details</p>
          </div>
          ${cards || '<div class="empty"><h2>No leads yet</h2><p>Submitted final-quote requests will appear here.</p></div>'}
        </div>
      </body>
    </html>
  `);
});


app.get("/api/leads", (req, res) => {
  if (!leadMatchesAdminKey(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  res.json({ leads: readLeads() });
});

app.post("/api/leads", async (req, res) => {
  try {
    const body = req.body || {};
    const lead = {
      id: "lead_" + Date.now(),
      createdAt: new Date().toISOString(),
      customer: body.customer || {},
      property: body.property || {},
      images: body.images || {},
      metrics: body.metrics || {},
      quote: body.quote || body.quoteSnapshot || {},
      quoteSnapshot: body.quoteSnapshot || body.quote || {},
      windowPanes: body.windowPanes || 0,
      selectedServices: body.selectedServices || [],
      serviceFrequencies: body.serviceFrequencies || [],
      addOnQuantities: body.addOnQuantities || {},
      houseWashSides: body.houseWashSides || [],
      submittedAt: body.submittedAt || new Date().toISOString(),
      estimateText: body.estimateText || "",
      callbackOnly: Boolean(body.callbackOnly),
      rawSubmission: body
    };

    saveLead(lead);

    let email = { sent: false };
    try {
      email = await sendLeadEmail(lead);
    } catch (emailError) {
      email = { sent: false, error: emailError.message };
    }

    res.json({
      ok: true,
      leadId: lead.id,
      saved: true,
      email,
      message: "Your estimate was submitted to EPM successfully."
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || "Lead submission failed" });
  }
});

app.get("/api/property-image", async (req, res) => {
  try {
    const { type, lat, lng } = req.query;

    if (!lat || !lng) return res.status(400).send("Missing lat/lng");

    const imageUrl =
      type === "street"
        ? streetViewUrl(lat, lng, "640x640")
        : staticMapUrl(lat, lng, 20, "640x640", "satellite");

    const imageRes = await fetch(imageUrl);
    if (!imageRes.ok) return res.status(imageRes.status).send("Image fetch failed");

    const contentType = imageRes.headers.get("content-type") || "image/png";
    const buffer = Buffer.from(await imageRes.arrayBuffer());

    res.set("Content-Type", contentType);
    res.set("Cache-Control", "public, max-age=86400");
    res.send(buffer);
  } catch (error) {
    console.error(error);
    res.status(500).send("Image proxy failed");
  }
});

app.post("/api/estimate", async (req, res) => {
  try {
    const missing = requireEnv();
    if (missing.length) return res.status(500).json({ error: "Missing required environment variables", missing });

    const { address, lat, lng, services = [] } = req.body;

    let property = null;
    if (lat && lng && address) {
      property = { formattedAddress: address, lat: Number(lat), lng: Number(lng) };
    } else if (address) {
      property = await geocodeAddress(address);
    } else {
      return res.status(400).json({ error: "Address is required." });
    }

    const satelliteUrl = staticMapUrl(property.lat, property.lng, 20);
    const streetUrl = streetViewUrl(property.lat, property.lng);

    const [satelliteBase64, streetBase64, regridFeature] = await Promise.all([
      getImageAsBase64(satelliteUrl),
      getImageAsBase64(streetUrl),
      fetchRegridParcel(property.lat, property.lng)
    ]);

    const fallbackProfile = regridFallbackProfile(regridFeature);

    const metrics = await aiAnalyzeImages({
      satelliteBase64,
      streetBase64,
      address: property.formattedAddress,
      lat: property.lat,
      lng: property.lng,
      fallbackProfile
    });

    const quote = quoteFromMetrics(metrics, services);

    res.json({
      property,
      images: {
        satellite: `/api/property-image?type=satellite&lat=${property.lat}&lng=${property.lng}`,
        street: `/api/property-image?type=street&lat=${property.lat}&lng=${property.lng}`
      },
      regridFound: Boolean(regridFeature),
      measurementDebug: {
        regridFound: Boolean(regridFeature),
        parcelSource: regridFeature ? "Regrid parcel" : "No verified parcel",
        fallbackUsed: false
      },
      metrics,
      quote,
      disclaimer: "This is a working AI estimate based on verified parcel data, imagery, and property records. Final pricing is confirmed after EPM reviews the property."
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || "Estimate failed" });
  }
});

app.listen(PORT, () => {
  console.log(`EPM AI Estimator Backend running on port ${PORT}`);
});
