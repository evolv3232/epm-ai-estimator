import express from "express";
import { prependRecord, readCollection, updateRecord } from "../services/storage.js";
import { sendNotification } from "../services/email.js";
import { money, newId, newToken, publicBaseUrl } from "../utils/format.js";
import { renderProposalPage } from "../utils/proposalPage.js";

const router = express.Router();

router.get("/health", (req, res) => {
  res.json({
    ok: true,
    version: "15.0.0",
    proposalRoutesReady: true
  });
});

router.post("/", async (req, res) => {
  try {
    const body = req.body || {};
    const lineItems = Array.isArray(body.lineItems)
      ? body.lineItems.map(item => ({
          service: String(item.service || "").trim(),
          description: String(item.description || "").trim(),
          amount: Number(item.amount || 0)
        })).filter(item => item.service && item.amount >= 0)
      : [];

    if (!body.customerName || !body.propertyAddress || !lineItems.length) {
      return res.status(400).json({
        error: "Customer name, property address, and at least one service are required."
      });
    }

    const proposals = readCollection("proposals");
    const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0);
    const proposal = {
      id: newId("proposal_"),
      token: newToken(),
      proposalNumber: String(body.proposalNumber || "").trim() ||
        `EPM-${new Date().getFullYear()}-${String(proposals.length + 1).padStart(4, "0")}`,
      customer: {
        name: String(body.customerName || "").trim(),
        phone: String(body.customerPhone || "").trim(),
        email: String(body.customerEmail || "").trim()
      },
      propertyAddress: String(body.propertyAddress || "").trim(),
      preparedDate: String(body.preparedDate || new Date().toISOString().slice(0, 10)).trim(),
      notes: String(body.notes || "").trim(),
      lineItems,
      subtotal,
      total: subtotal,
      status: "Sent — Awaiting Approval",
      paymentTerms: "Payment due immediately after completion",
      paymentMethod: null,
      paymentReportedAt: null,
      approvedAt: null,
      signatureName: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    prependRecord("proposals", proposal);
    prependRecord("leads", {
      id: newId("lead_"),
      createdAt: proposal.createdAt,
      submissionType: "Proposal Created",
      customer: proposal.customer,
      property: { formattedAddress: proposal.propertyAddress },
      proposal,
      quote: {
        status: proposal.status,
        subtotal,
        savings: 0,
        total: subtotal,
        lines: lineItems
      },
      estimateText: `Proposal ${proposal.proposalNumber} created for ${money(subtotal)}.`
    });

    const url = `${publicBaseUrl(req)}/proposal/${proposal.token}`;

    await sendNotification({
      subject: `EPM Proposal Created - ${proposal.proposalNumber}`,
      text: `Proposal ${proposal.proposalNumber}\nCustomer: ${proposal.customer.name}\nTotal: ${money(proposal.total)}\nLink: ${url}`
    }).catch(() => null);

    res.json({ ok: true, proposal, url });
  } catch (error) {
    console.error("Create proposal error:", error);
    res.status(500).json({ error: "Unable to create proposal." });
  }
});

router.get("/", (req, res) => {
  res.json({ ok: true, proposals: readCollection("proposals") });
});

router.get("/:token", (req, res) => {
  const proposal = readCollection("proposals").find(item => item.token === req.params.token);
  if (!proposal) return res.status(404).json({ error: "Proposal not found." });
  res.json({ ok: true, proposal });
});

router.post("/:token/approve", (req, res) => {
  const signatureName = String(req.body?.signatureName || "").trim();
  const acceptedAllTerms = Boolean(req.body?.acceptedAllTerms);

  if (!signatureName || !acceptedAllTerms) {
    return res.status(400).json({ error: "Signature and acceptance of all terms are required." });
  }

  const updated = updateRecord(
    "proposals",
    item => item.token === req.params.token,
    proposal => ({
      ...proposal,
      status: "Approved — Payment Due After Completion",
      signatureName,
      approvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })
  );

  if (!updated) return res.status(404).json({ error: "Proposal not found." });

  prependRecord("leads", {
    id: newId("lead_"),
    createdAt: new Date().toISOString(),
    submissionType: "Proposal Approval",
    customer: updated.customer,
    property: { formattedAddress: updated.propertyAddress },
    proposal: updated,
    approval: {
      signatureName,
      acceptedAllTerms: true,
      approvedAt: updated.approvedAt,
      agreementVersion: "EPM Service Agreement V1"
    },
    quote: {
      status: updated.status,
      subtotal: updated.subtotal,
      savings: 0,
      total: updated.total,
      lines: updated.lineItems
    },
    estimateText: `Proposal ${updated.proposalNumber} approved by ${signatureName}.`
  });

  res.json({ ok: true, proposal: updated });
});

router.post("/:token/payment-report", (req, res) => {
  const method = String(req.body?.method || "").trim();

  if (!["Zelle", "Cash"].includes(method)) {
    return res.status(400).json({ error: "Invalid payment method." });
  }

  const updated = updateRecord(
    "proposals",
    item => item.token === req.params.token,
    proposal => ({
      ...proposal,
      paymentMethod: method,
      paymentReportedAt: new Date().toISOString(),
      status: method === "Zelle"
        ? "Payment Reported — Awaiting EPM Confirmation"
        : "Cash Selected — Due After Completion",
      updatedAt: new Date().toISOString()
    })
  );

  if (!updated) return res.status(404).json({ error: "Proposal not found." });
  res.json({ ok: true, proposal: updated });
});

router.get("/page/:token", (req, res) => {
  const proposal = readCollection("proposals").find(item => item.token === req.params.token);
  if (!proposal) return res.status(404).send("Proposal not found.");
  res.send(renderProposalPage(proposal));
});

export default router;
