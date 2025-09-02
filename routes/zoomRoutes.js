const express = require("express");
const router = express.Router();
const { handleEngagementEnded, loadZoomConfig } = require("../utils/zoom");
const axios = require("axios");
const { getAccessToken } = require("../utils/zoom"); 

// Webhook handler
router.post("/", async (req, res) => {
  try {
    const { event, payload } = req.body;

    console.log("Webhook received:", event);

    // Zoom sends: "contact_center.engagement_ended"
    if (event === "contact_center.engagement_ended") {
      const engagementId = payload.engagement_id;
      const accountId = payload.account_id || "default";

      console.log(
        `Engagement ended. engagementId=${engagementId}, accountId=${accountId}`
      );

      await handleEngagementEnded(engagementId, accountId);
    }

    res.status(200).send({ received: true });
  } catch (err) {
    console.error("Webhook error:", err.message);
    res.status(500).send({ error: err.message });
  }
});

// New route: Fetch recording & transcript URLs directly from Zoom
router.get("/:engagementId/recordings", async (req, res) => {
  const { engagementId } = req.params;
  try {
    const token = await getAccessToken();

    const url = `https://api.zoom.us/v2/contact_center/engagements/${engagementId}/recordings`;
    console.log(`Fetching recording for engagement ${engagementId}`);

    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const recordings = response.data.recordings || [];
    const voiceRec = recordings.find((r) => r.channel === "voice");

    if (!voiceRec) {
      return res.status(404).json({ error: "No voice recording found" });
    }

    res.json({
      recordingUrl: voiceRec.download_url,
      transcriptUrl: voiceRec.transcript_url || null,
    });
  } catch (err) {
    console.error("Error fetching recordings:", err.message);
    res.status(500).json({ error: "Failed to fetch recordings" });
  }
});

module.exports = router;
