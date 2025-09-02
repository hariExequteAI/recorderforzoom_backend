const mongoose = require("mongoose");

const zoomConfigSchema = new mongoose.Schema({
  companyId: { type: String, required: true, unique: true },
  clientIdEnc: { type: String, required: true },
  clientSecretEnc: { type: String, required: true },
  accountIdEnc: { type: String, required: true },
  downloadPath: { type: String, default: "" },
});

module.exports = mongoose.model("ZoomConfig", zoomConfigSchema);
