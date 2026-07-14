import express from "express";
import { readCollection } from "../services/storage.js";
import { escapeHtml, money } from "../utils/format.js";

const router = express.Router();

router.get("/proposals-admin", (req, res) => {
  const rows = readCollection("proposals").map(proposal => `
    <tr>
      <td>${escapeHtml(proposal.proposalNumber)}</td>
      <td>${escapeHtml(proposal.customer?.name)}</td>
      <td>${escapeHtml(proposal.propertyAddress)}</td>
      <td>${money(proposal.total)}</td>
      <td>${escapeHtml(proposal.status)}</td>
      <td><a href="/proposal/${proposal.token}" target="_blank">Open</a></td>
    </tr>`).join("");

  res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>EPM Proposal Records</title><style>
  body{font-family:Arial;background:#f4f7f3;padding:20px;color:#061b33}
  .wrap{max-width:1100px;margin:auto;background:white;padding:20px;border-radius:16px}
  table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid #ddd;text-align:left;font-size:13px}
  th{background:#061b33;color:white}a{color:#2f7d20;font-weight:bold}
  </style></head><body><div class="wrap"><h1>EPM Proposal Records</h1>
  <table><thead><tr><th>Proposal</th><th>Customer</th><th>Property</th><th>Total</th><th>Status</th><th>Link</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="6">No proposals yet.</td></tr>'}</tbody></table></div></body></html>`);
});

router.get("/proposal/:token", (req, res) => {
  const proposal = readCollection("proposals").find(item => item.token === req.params.token);
  if (!proposal) return res.status(404).send("Proposal not found.");

  res.redirect(`/api/proposals/page/${proposal.token}`);
});

export default router;
