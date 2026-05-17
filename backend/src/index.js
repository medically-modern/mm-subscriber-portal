const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const { requestMagicLink, verifyMagicLink, requireAuth, logout, COOKIE_OPTIONS } = require("./auth");
const { getPatientData, createPatientRequest, updatePatientData, appendPatientNote } = require("./monday");
const { getCachedPatientData, cachePatientData, invalidatePatientCache, healthCheck } = require("./redis");

const app = express();

// ─── Security headers ───
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "script-src": ["'self'"],
      "style-src": ["'self'", "https:", "'unsafe-inline'"],
      "font-src": ["'self'", "https:", "data:"],
      "img-src": ["'self'", "data:", "https:"],
    },
  },
}));

// ─── CORS — GitHub Pages frontend → Railway backend ───
const ALLOWED_ORIGINS = [
  "https://medically-modern.github.io",
  "https://portal.medicallymodern.com",
  process.env.PORTAL_URL,
].filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    // Allow no-origin requests (mobile apps, curl)
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.some((o) => origin.startsWith(o))) return cb(null, true);
    cb(new Error("Not allowed by CORS"));
  },
  credentials: true,  // Required for cookies
}));

app.use(express.json());
app.use(cookieParser());

// Trust Railway proxy for rate limiting
app.set("trust proxy", 1);

// ─── Rate limiters ───
const globalLimiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });

app.use(globalLimiter);

// ─── Health check ───
app.get("/health", async (req, res) => {
  const redisOk = await healthCheck();
  res.json({ status: "ok", redis: redisOk ? "connected" : "disconnected", timestamp: new Date().toISOString() });
});

// ═══════════════════════════════════════════════════════
// AUTH ROUTES
// ═══════════════════════════════════════════════════════

// POST /auth/request-link — Send magic link SMS
app.post("/auth/request-link", authLimiter, async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ error: "Phone number required" });
    }

    const result = await requestMagicLink(phone);
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }

    res.json({ message: result.message });
  } catch (err) {
    console.error("[auth] Error requesting magic link:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /auth/verify/:token — Verify magic link, issue session cookie
app.get("/auth/verify/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const result = await verifyMagicLink(token);

    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }

    // Set httpOnly session cookie (works same-origin)
    res.cookie("session", result.jwt, COOKIE_OPTIONS);

    // Also return token in body for cross-origin (GitHub Pages → Railway)
    // Frontend stores in sessionStorage and sends via Authorization header
    res.json({ success: true, uid: result.uid, token: result.jwt });
  } catch (err) {
    console.error("[auth] Error verifying token:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /auth/logout — Blacklist session, clear cookie
app.post("/auth/logout", requireAuth, async (req, res) => {
  try {
    const jwt = require("jsonwebtoken");
    const sessionToken = req.cookies?.session || req.headers.authorization?.slice(7);
    const decoded = jwt.decode(sessionToken);
    if (decoded?.jti && decoded?.exp) {
      await logout(decoded.jti, decoded.exp);
    }

    res.clearCookie("session", { ...COOKIE_OPTIONS, maxAge: 0 });
    res.json({ success: true });
  } catch (err) {
    console.error("[auth] Logout error:", err.message);
    res.clearCookie("session", { ...COOKIE_OPTIONS, maxAge: 0 });
    res.json({ success: true });
  }
});

// GET /auth/check — Check if session is valid (no data, just auth status)
app.get("/auth/check", requireAuth, (req, res) => {
  res.json({ authenticated: true, uid: req.uid });
});

// ═══════════════════════════════════════════════════════
// PATIENT API ROUTES (all require auth)
// ═══════════════════════════════════════════════════════

// GET /api/me — Full patient profile + subscription data
app.get("/api/me", apiLimiter, requireAuth, async (req, res) => {
  try {
    // Try cache first
    let data = await getCachedPatientData(req.uid);
    if (!data) {
      data = await getPatientData(req.uid);
      if (!data) {
        return res.status(404).json({ error: "Patient not found" });
      }
      // Cache for 5 minutes
      await cachePatientData(req.uid, data, 300);
    }

    // Strip internal fields before sending to client
    const { itemId, ...safeData } = data;
    res.json(safeData);
  } catch (err) {
    console.error("[api] Error fetching patient data:", err.message);
    res.status(500).json({ error: "Unable to load your data. Please try again." });
  }
});

// POST /api/me/refresh — Force cache refresh
app.post("/api/me/refresh", apiLimiter, requireAuth, async (req, res) => {
  try {
    await invalidatePatientCache(req.uid);
    const data = await getPatientData(req.uid);
    if (!data) {
      return res.status(404).json({ error: "Patient not found" });
    }
    await cachePatientData(req.uid, data, 300);

    const { itemId, ...safeData } = data;
    res.json(safeData);
  } catch (err) {
    console.error("[api] Error refreshing patient data:", err.message);
    res.status(500).json({ error: "Unable to refresh your data. Please try again." });
  }
});

// POST /api/me/update — Update patient fields in Monday
app.post("/api/me/update", apiLimiter, requireAuth, async (req, res) => {
  try {
    const updates = req.body;
    if (!updates || Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No updates provided" });
    }
    console.log("[api] Update request for UID", req.uid, "fields:", Object.keys(updates).join(", "));
    await updatePatientData(req.uid, updates);
    // Invalidate cache so next load gets fresh data
    await invalidatePatientCache(req.uid);
    res.json({ success: true, message: "Changes saved!" });
  } catch (err) {
    console.error("[api] Update error:", err.message, err.stack);
    res.status(500).json({ error: "Failed to save changes. Please try again." });
  }
});

// POST /api/me/note — Append note to Patient Portal Notes column
app.post("/api/me/note", apiLimiter, requireAuth, async (req, res) => {
  try {
    const { note } = req.body;
    if (!note || !note.trim()) {
      return res.status(400).json({ error: "Note is required" });
    }
    await appendPatientNote(req.uid, note.trim());
    res.json({ success: true, message: "Note saved!" });
  } catch (err) {
    console.error("[api] Note error:", err.message);
    res.status(500).json({ error: "Failed to save note. Please try again." });
  }
});

// POST /api/me/request — Submit a patient request (creates Monday subitem)
app.post("/api/me/request", apiLimiter, requireAuth, async (req, res) => {
  try {
    const { type, details } = req.body;

    const allowedTypes = ["pause", "resume", "change_subscription", "update_info", "question"];
    if (!type || !allowedTypes.includes(type)) {
      return res.status(400).json({ error: "Invalid request type" });
    }
    if (!details || details.length > 1000) {
      return res.status(400).json({ error: "Details required (max 1000 chars)" });
    }

    // Get the patient's Monday item ID
    const data = await getPatientData(req.uid);
    if (!data) {
      return res.status(404).json({ error: "Patient not found" });
    }

    const typeLabels = {
      pause: "Pause Subscription",
      resume: "Resume Subscription",
      change_subscription: "Change Subscription",
      update_info: "Update Information",
      question: "Patient Question",
    };

    await createPatientRequest(data.itemId, typeLabels[type], details);

    // Invalidate cache so next load shows fresh data
    await invalidatePatientCache(req.uid);

    res.json({ success: true, message: "Your request has been submitted. Our team will review it shortly." });
  } catch (err) {
    console.error("[api] Error creating patient request:", err.message);
    res.status(500).json({ error: "Unable to submit your request. Please try again." });
  }
});

// ─── Start server ───
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[portal-api] Patient portal backend running on port ${PORT}`);
});
