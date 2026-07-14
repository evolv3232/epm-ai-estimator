import express from "express";
import cors from "cors";
import leadsRouter from "./routes/leads.js";
import proposalsRouter from "./routes/proposals.js";
import pagesRouter from "./routes/pages.js";

const app = express();
const PORT = Number(process.env.PORT || 10000);

const allowedOrigins = String(process.env.ALLOWED_ORIGIN || "")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error("Origin not allowed."));
  }
}));

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.json({
    ok: true,
    name: "EPM Platform Backend",
    version: "15.0.0",
    endpoints: [
      "/api/health",
      "/api/leads",
      "/api/proposals/health",
      "/api/proposals",
      "/proposals-admin"
    ]
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    version: "15.0.0",
    leadsReady: true,
    proposalsReady: true
  });
});

app.use("/api/leads", leadsRouter);
app.use("/api/proposals", proposalsRouter);
app.use("/", pagesRouter);

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: "Unexpected server error." });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`EPM Platform Backend V15 running on port ${PORT}`);
});
