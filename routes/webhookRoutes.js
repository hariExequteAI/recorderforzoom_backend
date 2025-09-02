// routes/webhookRoutes.js
const express = require("express");
const router = express.Router();
const { handleEngagementEnded } = require("../utils/zoom");

/**
 * Zoom Contact Center webhook endpoint
 * Mounted in server.js at: app.use("/webhook", webhookRoutes)
 *
 * POST /webhook
 */
router.post("/", async (req, res) => {
  try {
    if (!req.body || typeof req.body !== "object") {
      return res.status(400).send("Invalid JSON body");
    }

    const { event, payload } = req.body;

    // Basic logging (trim noisy bodies in production)
    console.log("[WEBHOOK] event:", event);

    if (event === "contact_center.engagement_ended") {
      // Per your current payload shape:
      const engagementId =
        payload?.object?.engagement_id || payload?.engagement?.id;

      console.log("[WEBHOOK] engagement_ended for:", engagementId);

      if (!engagementId) {
        return res.status(400).send("Engagement ID missing");
      }

      // Do the heavy work; if this can be long-running, consider
      // doing it asynchronously and returning 202 Accepted immediately.
      await handleEngagementEnded(engagementId);

      return res.status(200).send("Engagement processed");
    }

    // Optionally handle URL validation (if Zoom sends it)
    // Docs sometimes use event: "endpoint.url_validation" with a plainToken.
    if (event === "endpoint.url_validation") {
      const plainToken = payload?.plainToken;
      if (!plainToken) {
        return res.status(400).send("plainToken missing");
      }
      // If you have a secret token/signature scheme, compute encryptedToken here.
      // For now, reflect the plainToken as per simple validation flows.
      return res.status(200).json({ plainToken, encryptedToken: plainToken });
    }

    // Unknown/irrelevant events get 200 so Zoom considers delivery successful
    console.log("[WEBHOOK] Unhandled event:", event);
    return res.status(200).send("Event ignored");
  } catch (err) {
    console.error("[WEBHOOK] Error handling webhook:", err);
    return res.status(500).send("Webhook error");
  }
});

module.exports = router;
