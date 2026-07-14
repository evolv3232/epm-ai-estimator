import express from "express";
import { prependRecord, readCollection } from "../services/storage.js";
import { sendNotification } from "../services/email.js";
import { newId } from "../utils/format.js";

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const body = req.body || {};
    const customer = body.customer || {};
    const property = body.property || {};

    if (!customer.name || !customer.phone || !property.formattedAddress) {
      return res.status(400).json({
        error: "Customer name, phone number, and property address are required."
      });
    }

    const record = {
      id: newId("lead_"),
      createdAt: new Date().toISOString(),
      ...body
    };

    prependRecord("leads", record);

    const lines = [
      "New EPM submission",
      "",
      `Type: ${body.submissionType || "Estimate Request"}`,
      `Customer: ${customer.name}`,
      `Phone: ${customer.phone}`,
      `Email: ${customer.email || "Not provided"}`,
      `Property: ${property.formattedAddress}`,
      "",
      body.estimateText || JSON.stringify(body, null, 2)
    ];

    const email = await sendNotification({
      subject: `New EPM ${body.submissionType || "Submission"} - ${customer.name}`,
      text: lines.join("\n")
    }).catch(error => ({ sent: false, reason: error.message }));

    res.json({ ok: true, id: record.id, email });
  } catch (error) {
    console.error("Lead submission error:", error);
    res.status(500).json({ error: "Unable to save the submission." });
  }
});

router.get("/", (req, res) => {
  res.json({ ok: true, leads: readCollection("leads") });
});

export default router;
