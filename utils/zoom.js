const axios = require("axios");
const fs = require("fs");
const path = require("path");
const Engagement = require("../models/Engagement");
const ZoomConfig = require("../models/ZoomConfig");
const { decrypt } = require("./crypto");

let cachedConfig = null;
let cachedToken = null;
let cachedTokenExp = 0;

async function loadZoomConfig() {
  if (cachedConfig) return cachedConfig;

  const cfg = await ZoomConfig.findOne();
  if (!cfg) throw new Error("No Zoom configuration found.");

  cachedConfig = {
    clientId: decrypt(cfg.clientIdEnc),
    clientSecret: decrypt(cfg.clientSecretEnc),
    accountId: decrypt(cfg.accountIdEnc),
  };
  return cachedConfig;
}

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExp) {
    return cachedToken;
  }

  const { clientId, clientSecret, accountId } = await loadZoomConfig();

  const res = await axios.post("https://zoom.us/oauth/token", null, {
    params: { grant_type: "account_credentials", account_id: accountId },
    auth: { username: clientId, password: clientSecret },
  });

  cachedToken = res.data.access_token;
  // expires_in is in seconds. Subtract small buffer (60s).
  cachedTokenExp = now + (res.data.expires_in - 60) * 1000;
  console.log("Fetched new Zoom access token (expires in seconds):", res.data.expires_in);
  return cachedToken;
}

async function getEngagement(accessToken, engagementId) {
  const url = `https://api.zoom.us/v2/contact_center/engagements/${engagementId}`;
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.data;
}

async function getRecordingUrls(engagementId) {
  const token = await getAccessToken();
  const recRes = await axios.get(
    `https://api.zoom.us/v2/contact_center/engagements/${engagementId}/recordings`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return recRes.data.recordings || [];
}

// Retry wrapper for recordings (returns info needed to download)
async function getRecording(accessToken, engagementId, attempt = 1) {
  const url = `https://api.zoom.us/v2/contact_center/engagements/${engagementId}/recordings`;

  console.log(`[${engagementId}] Fetching recording (attempt ${attempt}): ${url}`);

  try {
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const recordings = res.data.recordings || [];
    // prefer 'voice' channel, fallback to first
    const rec = recordings.find(r => r.channel === "voice") || recordings[0];

    if (!rec) throw new Error("No recording entries found for engagement");

    const downloadUrl = rec.download_url || rec.url || null;
    if (!downloadUrl) throw new Error("Recording has no download_url");

    const ext = rec.file_extension ? `.${rec.file_extension}` : ".mp3";
    const fileName = `${engagementId}${ext}`;

    // Determine start time: try rec.start_time, then res.data.start_time, else now
    const startTimeRaw = rec.start_time || res.data.start_time || new Date().toISOString();
    const startTime = new Date(startTimeRaw);

    const duration = rec.duration || res.data.duration || 0;

    return { downloadUrl, fileName, startTime, duration, meta: res.data, recording: rec };

  } catch (err) {
    // Only retry for 404 (not ready) or network/transient errors
    const status = err.response?.status;
    if ((status === 404 || status === 202 || !status) && attempt < 5) {
      const waitMs = 10000;
      console.log(`[${engagementId}] Recording not ready yet (status ${status}). Retrying in ${waitMs/1000}s...`);
      await new Promise(r => setTimeout(r, waitMs));
      return getRecording(accessToken, engagementId, attempt + 1);
    }
    console.error(`[${engagementId}] getRecording failed:`, err.message || err);
    throw err;
  }
}

async function streamDownload(downloadUrl, accessToken, absPath) {
  await fs.promises.mkdir(path.dirname(absPath), { recursive: true });

  console.log(`Downloading recording to ${absPath}`);

  const writer = fs.createWriteStream(absPath);
  const res = await axios.get(downloadUrl, {
    responseType: "stream",
    headers: { Authorization: `Bearer ${accessToken}` },
    // timeout could be useful for very large downloads; rely on default for now
  });

  return new Promise((resolve, reject) => {
    res.data.pipe(writer);
    writer.on("finish", () => {
      console.log("Download complete:", absPath);
      resolve(absPath);
    });
    writer.on("error", (err) => {
      console.error("Write stream error:", err);
      reject(err);
    });
  });
}

// Retry transcript fetch (VTT expected). Returns VTT text.
async function fetchTranscriptWithRetry(url, token, attempt = 1) {
  try {
    const transcriptRes = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: "text",
    });
    return transcriptRes.data;
  } catch (err) {
    const status = err.response?.status;
    if ((status === 404 || status === 202 || !status) && attempt < 5) {
      const waitMs = 15000;
      console.log(`Transcript not ready yet (attempt ${attempt}). Retrying in ${waitMs/1000}s...`);
      await new Promise(r => setTimeout(r, waitMs));
      return fetchTranscriptWithRetry(url, token, attempt + 1);
    }
    console.error("fetchTranscriptWithRetry failed:", err.message || err);
    throw err;
  }
}

// Main handler
async function handleEngagementEnded(engagementId) {
  console.log(`Handling engagement ${engagementId}`);

  // Step 1: Check if already processed
  const existing = await Engagement.findOne({ engagementId });
  if (existing?.localPath && fs.existsSync(existing.localPath)) {
    console.log(`[${engagementId}] Already processed, skipping.`);
    return existing;
  }

  const token = await getAccessToken();

  // Fetch engagement metadata
  let engagementData = {};
  try {
    engagementData = await getEngagement(token, engagementId);
  } catch (err) {
    console.error(`[${engagementId}] Failed to fetch engagement metadata:`, err.message || err);
    throw err;
  }

  // Retry for recording if not ready
  const { downloadUrl, fileName, startTime, duration, recording } = await getRecording(token, engagementId);

  const cfg = await ZoomConfig.findOne();
  const basePath = cfg?.downloadPath || "";

  const dir = path.join(
    basePath,
    "recordings",
    String(startTime.getFullYear()),
    String(startTime.getMonth() + 1).padStart(2, "0"),
    String(startTime.getDate()).padStart(2, "0")
  );

  const absPath = path.join(dir, fileName);

  const publicUrl = `/recordings/${startTime.getFullYear()}/${String(
    startTime.getMonth() + 1
  ).padStart(2, "0")}/${String(startTime.getDate()).padStart(2, "0")}/${fileName}`;

  // Step 2: Download only if file doesn’t exist
  if (!fs.existsSync(absPath)) {
    try {
      await streamDownload(downloadUrl, token, absPath);
    } catch (err) {
      console.error(`[${engagementId}] Download failed:`, err.message || err);
      throw err;
    }
  } else {
    console.log(`[${engagementId}] Recording file already exists: ${absPath}`);
  }

  // Build consumer display
  const consumerName = engagementData.consumers?.[0]?.consumer_display_name;
  const consumerNumber = engagementData.consumers?.[0]?.consumer_number;
  const consumerField =
    consumerName && consumerNumber
      ? `${consumerName}\n${consumerNumber}`
      : consumerName || consumerNumber || "-";

  // Fetch & parse transcript (if available)
  let transcriptLines = [];
  if (recording.transcript_url) {
    try {
      const vttData = await fetchTranscriptWithRetry(recording.transcript_url, token);
      const lines = vttData.split(/\r?\n/);
      let currentTime = "";

      for (let rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line === "WEBVTT" || /^[0-9]+$/.test(line)) continue;

        // timestamp line
        if (line.includes("-->")) {
          // Example: "00:00:01.000 --> 00:00:04.000"
          const left = line.split("-->")[0].trim();
          // keep HH:MM:SS or MM:SS
          currentTime = left.split(".")[0];
          continue;
        }

        // cue text line(s)
        // If the line looks like "Speaker: message", capture speaker
        if (line.includes(":")) {
          const [possibleSpeaker, ...msgParts] = line.split(":");
          const rest = msgParts.join(":").trim();

          // Heuristic: if possibleSpeaker is short (<= 30 chars) and the rest is not empty, treat as speaker
          if (possibleSpeaker.length <= 30 && rest.length > 0 && /^[A-Za-z0-9 \-_.]{1,30}$/.test(possibleSpeaker)) {
            transcriptLines.push({
              speaker: possibleSpeaker.trim(),
              time: currentTime,
              text: rest,
            });
            continue;
          }
        }

        // fallback: plain text without explicit speaker
        transcriptLines.push({
          speaker: "Unknown",
          time: currentTime,
          text: line,
        });
      }

      console.log(`[${engagementId}] Parsed ${transcriptLines.length} transcript lines`);
    } catch (err) {
      console.warn(`[${engagementId}] Could not fetch/parse transcript:`, err.message || err);
      // continue without transcript
    }
  } else {
    console.log(`[${engagementId}] No transcript_url present for recording`);
  }

  // Save/update engagement doc in MongoDB
  const saved = await Engagement.findOneAndUpdate(
    { engagementId },
    {
      engagementId,
      startTime: startTime || new Date(),
      duration: duration || recording.duration || engagementData.duration || 0,
      consumer: consumerField,
      agent: engagementData.agents?.map(a => a.display_name).join(", ") || "",
      queue: engagementData.queues?.[0]?.queue_name || "",
      flow: engagementData.flows?.[0]?.flow_name || "",
      disposition: Array.isArray(engagementData.dispositions)
        ? engagementData.dispositions[0]?.name || ""
        : engagementData.disposition || "",
      notes: Array.isArray(engagementData.notes)
        ? engagementData.notes.map(note => note.content || "").join(" | ")
        : "",
      channel: recording.channel || engagementData.channel || "",
      recordingUrl: downloadUrl,
      localPath: absPath,
      publicUrl,
      transfer_type: engagementData.transfer_type || "-",
      upgraded_to_channel_type: engagementData.upgraded_to_channel_type || "-",
      accept_type: engagementData.events?.some(e => e.event_type === "Agent Accept") ? "manual" : "-",
      direction: engagementData.direction || "",
      source: engagementData.source || "",
      waitingDuration: engagementData.waiting_duration || 0,
      handlingDuration: engagementData.handling_duration || 0,
      wrapUpDuration: engagementData.wrap_up_duration || 0,
      transcript: transcriptLines,
      voicemail: !!engagementData.voice_mail,
      recordingConsent: engagementData.recording_consent || false,
      updatedAt: new Date(),
    },
    { upsert: true, new: true }
  );

  console.log(`[${engagementId}] Saved engagement info with transcript`);
  return saved;
}

module.exports = {
  handleEngagementEnded,
  loadZoomConfig,
  getAccessToken,
  getRecordingUrls,
  streamDownload,
  getRecording,
};
