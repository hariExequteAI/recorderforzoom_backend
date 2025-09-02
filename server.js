// server.js
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const morgan = require("morgan");
const helmet = require("helmet");
const compression = require("compression");

// DB + Models
const connectDB = require("./config/db");
const ZoomConfig = require("./models/ZoomConfig");

const app = express();

// --- Trust proxy if you're behind ngrok / vercel proxy etc. ---
app.set("trust proxy", true);

// --- Basic middleware ---
app.use(helmet({ crossOriginResourcePolicy: false })); // allow static files cross-origin
app.use(compression());
app.use(morgan("dev"));
app.use(express.json({ limit: "2mb" }));

// --- CORS (allow localhost dev, vercel, and ngrok tunnels) ---
const allowedOrigins = [
  "https://zoomrecordingapplication.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

const dynamicOriginAllow = (origin) => {
  if (!origin) return true; // curl / mobile apps
  try {
    const url = new URL(origin);
    // Allow localhost on any port
    if (["localhost", "127.0.0.1"].includes(url.hostname)) return true;
    // Allow ngrok (free + reserved)
    if (url.hostname.endsWith(".ngrok-free.app")) return true;
    if (url.hostname.endsWith(".ngrok.io")) return true;
    // Allow your Vercel frontend
    if (origin === "https://zoomrecordingapplication.vercel.app") return true;
    return false;
  } catch {
    return false;
  }
};

app.use(
  cors({
    origin: (origin, cb) => {
      if (dynamicOriginAllow(origin) || allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      return cb(
        new Error(`CORS policy does not allow access from origin: ${origin}`),
        false
      );
    },
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    // Allow the ngrok interstitial-bypass header + Range (browsers often send for audio)
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "ngrok-skip-browser-warning",
      "Range",
    ],
  })
);

// Handle OPTIONS preflight for all paths (use RegExp, not "*")
app.options(/.*/, cors());

// --- Health check & root info (handy for ngrok) ---
function healthPayload() {
  return {
    ok: true,
    env: process.env.NODE_ENV || "development",
    time: new Date().toISOString(),
  };
}

app.get("/health", (req, res) => res.json(healthPayload()));
// Add /api/health so frontend with base .../api can call /api/health
app.get("/api/health", (req, res) => res.json(healthPayload()));

app.get("/", (req, res) => {
  res.send(
    `<pre>Backend is up ✅
- Time: ${new Date().toISOString()}
- Try: GET /health or /api/health
- APIs start with /api/* and /webhook
</pre>`
  );
});

/**
 * Helper to safely require a router and clearly report which file fails.
 * If a router contains an invalid path (e.g., "*" / "/:" / full URL),
 * path-to-regexp may throw during require time.
 */
function safeRequireRouter(label, relPath) {
  try {
    const abs = path.resolve(__dirname, relPath);
    const router = require(abs);
    console.log(`[ROUTER] Loaded ${label} from ${relPath}`);
    return router;
  } catch (err) {
    console.error(`\n[ROUTER LOAD ERROR] ${label} (${relPath}) threw during require.`);
    console.error(
      "Common causes: '*' wildcard (use a RegExp /.*/ or proper path), '/:' without a name, empty path '', or using a full URL as a path."
    );
    console.error("Original error:\n", err);
    process.exit(1);
  }
}

// --- Load routers with guard to identify the crashing file ---
const authRoutes = safeRequireRouter("authRoutes", "./routes/authRoutes");
const engagementRoutes = safeRequireRouter("engagementRoutes", "./routes/engagementRoutes");
const configRoutes = safeRequireRouter("configRoutes", "./routes/configRoutes");
const zoomRoutes = safeRequireRouter("zoomRoutes", "./routes/zoomRoutes");
const webhookRoutes = safeRequireRouter("webhookRoutes", "./routes/webhookRoutes");
// recordings router (serves encrypted .enc + .meta.json OR plain .mp3/.wav)
const recordingRoutes = safeRequireRouter("recordingRoutes", "./routes/recordingRoutes");

// --- API Routes (make sure your route files export a Router) ---
app.use("/api/auth", authRoutes);
app.use("/api/engagements", engagementRoutes);
app.use("/api/config", configRoutes);
app.use("/api/zoom", zoomRoutes);
app.use("/webhook", webhookRoutes);

// Use the recordings router (do NOT also mount express.static("/recordings", ...) or it will shadow this)
app.use("/recordings", recordingRoutes);

// 404 for unknown routes
app.use((req, res, next) => {
  res.status(404).json({ error: "Not found", path: req.originalUrl });
});

// Centralized error handler (catches thrown errors incl. CORS)
app.use((err, req, res, next) => {
  console.error("Error:", err.message || err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || "Internal Server Error",
  });
});

const PORT = process.env.PORT || 5000;

// --- Start ---
(async () => {
  try {
    await connectDB(process.env.MONGO_URI);

    // NOTE: We no longer mount express.static('/recordings', ...).
    // The router handles both encrypted and plain files and falls back to
    // process.env.ZOOM_DOWNLOAD_PATH if DB config is missing.

    app.listen(PORT, () => {
      console.log(`Backend listening on http://localhost:${PORT}`);
      console.log(`Health: http://localhost:${PORT}/health`);
      console.log(`Health: http://localhost:${PORT}/api/health`);
    });
  } catch (err) {
    console.error("Startup error:", err.message || err);
    process.exit(1);
  }
})();

// Optional: log unhandled rejections
process.on("unhandledRejection", (reason) => {
  console.error("UnhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("UncaughtException:", err);
  process.exit(1);
});
