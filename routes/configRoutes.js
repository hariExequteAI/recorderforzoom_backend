const express = require("express");
const auth = require("../middleware/auth");
const roles = require("../middleware/roles");
const ZoomConfig = require("../models/ZoomConfig");
const { encrypt, decrypt } = require("../utils/crypto");

const router = express.Router();

// Get current company zoom config (admin)
router.get("/zoom", auth, roles("admin"), async (req, res) => {
  const cfg = await ZoomConfig.findOne({ companyId: req.user.companyId });
  if (!cfg) return res.json(null);

  res.json({
    clientId: "****" + decrypt(cfg.clientIdEnc).slice(-4),
    accountId: "****" + decrypt(cfg.accountIdEnc).slice(-4),
    downloadPath: cfg.downloadPath || "" 
    // Never return clientSecret in plain
  });
});

// Save/Update zoom config (admin)
router.post("/zoom", auth, roles("admin"), async (req, res) => {
  const { clientId, clientSecret, accountId, downloadPath } = req.body; 
  const doc = await ZoomConfig.findOneAndUpdate(
    { companyId: req.user.companyId },
    {
      companyId: req.user.companyId,
      clientIdEnc: encrypt(clientId),
      clientSecretEnc: encrypt(clientSecret),
      accountIdEnc: encrypt(accountId),
      downloadPath: downloadPath || "", 
    },
    { upsert: true, new: true }
  );

  res.json({ ok: true });
});

module.exports = router;
