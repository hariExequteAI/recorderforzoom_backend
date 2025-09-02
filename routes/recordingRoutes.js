const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { pipeline } = require("stream");
const ZoomConfig = require("../models/ZoomConfig");

const router = express.Router();

const SECRET = process.env.CRYPTO_SECRET || "fallback_please_set_ENV";
const KEY = crypto.createHash("sha256").update(SECRET).digest();
const ALGO = "aes-256-gcm";

const isYear = (s) => /^\d{4}$/.test(s);
const isMonthDay = (s) => /^\d{2}$/.test(s);

async function getRecordingsRoot() {
  const cfg = await ZoomConfig.findOne().lean().catch(() => null);
  const base = cfg?.downloadPath || process.env.ZOOM_DOWNLOAD_PATH;
  return base ? path.join(base, "recordings") : null;
}

function contentTypeFor(ext) {
  return ext === ".wav" ? "audio/wav" : "audio/mpeg";
}

router.get("/:year/:month/:day/:file", async (req, res) => {
  try {
    const { year, month, day, file } = req.params;
    if (!isYear(year) || !isMonthDay(month) || !isMonthDay(day)) {
      return res.status(400).send("Invalid date path");
    }

    const recordingsRoot = await getRecordingsRoot();
    if (!recordingsRoot) return res.status(500).send("Download path not configured");

    const dayDir = path.join(recordingsRoot, year, month, day);
    const requestedExt = path.extname(file).toLowerCase(); // ".mp3" | ".wav" | ""
    const baseName = requestedExt ? path.basename(file, requestedExt) : file;

    // Prefer encrypted if present
    const encPath = path.join(dayDir, `${baseName}.enc`);
    const metaPath = `${encPath}.meta.json`;
    const hasEncrypted = fs.existsSync(encPath) && fs.existsSync(metaPath);

    if (hasEncrypted) {
      // Decrypt + gunzip full stream (no Range)
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      const iv = Buffer.from(meta.iv, "hex");
      const tag = Buffer.from(meta.tag, "hex");

      const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
      decipher.setAuthTag(tag);
      const gunzip = zlib.createGunzip();

      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Disposition", `inline; filename="${baseName}.mp3"`);
      res.setHeader("Accept-Ranges", "none"); // we don't support range on encrypted

      const input = fs.createReadStream(encPath);
      return pipeline(input, decipher, gunzip, res, (err) => {
        if (err) {
          console.error("Decrypt/stream pipeline error:", err);
          if (!res.headersSent) res.status(500).end("Stream error");
        }
      });
    }

    // Plain files: support Range
    const tryExts = requestedExt ? [requestedExt] : [".mp3", ".wav"];
    for (const ext of tryExts) {
      const plainPath = path.join(dayDir, `${baseName}${ext}`);
      if (!fs.existsSync(plainPath)) continue;

      const stat = fs.statSync(plainPath);
      const total = stat.size;
      const range = req.headers.range;

      res.setHeader("Content-Type", contentTypeFor(ext));
      res.setHeader("Content-Disposition", `inline; filename="${baseName}${ext}"`);
      res.setHeader("Accept-Ranges", "bytes");

      if (range) {
        // Parse "bytes=start-end"
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (match) {
          let start = match[1] ? parseInt(match[1], 10) : 0;
          let end = match[2] ? parseInt(match[2], 10) : total - 1;
          if (isNaN(start) || isNaN(end) || start > end || end >= total) {
            res.setHeader("Content-Range", `bytes */${total}`);
            return res.status(416).end(); // Range Not Satisfiable
          }
          res.status(206);
          res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
          res.setHeader("Content-Length", end - start + 1);
          return fs.createReadStream(plainPath, { start, end }).pipe(res);
        }
      }

      // No range -> full file
      res.setHeader("Content-Length", total);
      return fs.createReadStream(plainPath).pipe(res);
    }

    return res.status(404).send("Recording not found");
  } catch (err) {
    console.error("❌ Recording stream failed:", err);
    return res.status(500).send("Server error");
  }
});

module.exports = router;
