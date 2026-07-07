import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import OpenAI from "openai";

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
  if (!REGRID_TOKEN) return null;

  try {
    const url = new URL("https://app.regrid.com/api/v2/parcels/point");
    url.searchParams.set("token", REGRID_TOKEN);
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("limit", "1");

    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    return data?.features?.[0] || null;
  } catch {
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
  const props = feature?.properties || {};
  const parcelSqFt =
    parcelAreaSqFt(feature) ||
    propAny(props, ["ll_gissqft", "gis_sqft", "land_sqft", "lot_sqft", "parcel_sqft"]) ||
    7200;

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

  if (!livingArea) {
    livingArea = clamp(parcelSqFt * 0.30, 1450, 3600);
  }

  let stories = propAny(props, ["stories", "num_stories", "story", "bldg_stories"]);
  if (!stories) stories = livingArea > 2100 ? 2 : 1;
  stories = stories >= 2 ? 2 : 1;

  const footprint = livingArea / stories;

  const driveway = clamp(parcelSqFt * 0.055, 340, 700);
  const walkway = clamp(parcelSqFt * 0.010, 55, 140);
  const entry = clamp(parcelSqFt * 0.006, 30, 70);
  const sidewalk = clamp(Math.sqrt(parcelSqFt) * 1.9, 120, 260);
  const totalSurface = driveway + walkway + entry + sidewalk;
  const fence = clamp(Math.sqrt(parcelSqFt) * 2.25, 145, 310);
  const roofArea = livingArea * (stories === 2 ? 1.10 : 1.25);
  const lawnArea = Math.max(850, parcelSqFt - footprint - totalSurface - 850);

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
    source: feature ? "Regrid parcel + EPM formulas" : "EPM formulas"
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
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${satelliteBase64}`
            }
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${streetBase64}`
            }
          }
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
    lineItems.push({
      name,
      calculation,
      price: Math.round(price)
    });
  };

  if (services.includes("lawn")) {
    add("Lawn Care", `${metrics.lawnAreaSqFt} sq ft × $0.025`, metrics.lawnAreaSqFt * 0.025);
  }

  if (services.includes("surface")) {
    add("Surface Cleaning", `${metrics.totalSurfaceSqFt} sq ft × $0.20`, metrics.totalSurfaceSqFt * 0.20);
  }

  if (services.includes("houseWindow")) {
    add("House & Window Wash", `${metrics.livingAreaSqFt} sq ft × $0.07`, metrics.livingAreaSqFt * 0.07);
  }

  if (services.includes("fence")) {
    add("Fence Washing", `${metrics.fenceLinearFt} linear ft × $0.75`, metrics.fenceLinearFt * 0.75);
  }

  if (services.includes("gutters")) {
    const price = metrics.stories >= 2 ? 200 : 175;
    add("Gutter Cleaning", metrics.stories >= 2 ? "Two-story flat rate" : "One-story flat rate", price);
  }

  if (services.includes("roof")) {
    add("Roof Cleaning", `${metrics.roofAreaSqFt} sq ft × $0.12`, metrics.roofAreaSqFt * 0.12);
  }

  const subtotal = lineItems.reduce((sum, item) => sum + item.price, 0);
  let discountRate = 0;
  if (lineItems.length >= 4) discountRate = 0.15;
  else if (lineItems.length === 3) discountRate = 0.10;
  else if (lineItems.length === 2) discountRate = 0.05;

  const savings = Math.round(subtotal * discountRate);
  const total = subtotal - savings;

  return {
    lineItems,
    subtotal,
    discountRate,
    savings,
    total
  };
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    name: "EPM AI Estimator Backend",
    version: "2.0",
    endpoints: ["/api/estimate", "/api/property-image"]
  });
});

app.get("/api/property-image", async (req, res) => {
  try {
    const { type, lat, lng } = req.query;

    if (!lat || !lng) {
      return res.status(400).send("Missing lat/lng");
    }

    const imageUrl =
      type === "street"
        ? streetViewUrl(lat, lng, "640x640")
        : staticMapUrl(lat, lng, 20, "640x640", "satellite");

    const imageRes = await fetch(imageUrl);

    if (!imageRes.ok) {
      return res.status(imageRes.status).send("Image fetch failed");
    }

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
    if (missing.length) {
      return res.status(500).json({
        error: "Missing required environment variables",
        missing
      });
    }

    const { address, lat, lng, services = [] } = req.body;

    let property = null;

    if (lat && lng && address) {
      property = {
        formattedAddress: address,
        lat: Number(lat),
        lng: Number(lng)
      };
    } else if (address) {
      property = await geocodeAddress(address);
    } else {
      return res.status(400).json({
        error: "Address is required."
      });
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
      metrics,
      quote,
      disclaimer: "This is a working AI estimate based on available imagery and property data. Final pricing is confirmed after EPM reviews the property."
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error.message || "Estimate failed"
    });
  }
});

app.listen(PORT, () => {
  console.log(`EPM AI Estimator Backend running on port ${PORT}`);
});
