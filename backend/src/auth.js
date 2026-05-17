const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { AUTH } = require("./config");
const { storeAuthToken, getAuthToken, deleteAuthToken, checkAuthRateLimit, blacklistSession, isSessionBlacklisted } = require("./redis");
const { sendSMS } = require("./sms");
const { findPatientByPhone } = require("./monday");

const JWT_SECRET = process.env.JWT_SECRET;
const PORTAL_URL = process.env.PORTAL_URL || "https://medically-modern.github.io/patient-portal";

// ─── Generate & send magic link ───

async function requestMagicLink(phone) {
  // Rate limit
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) {
    return { error: "Invalid phone number", status: 400 };
  }

  const allowed = await checkAuthRateLimit(digits, AUTH.RATE_LIMIT_AUTH, AUTH.RATE_LIMIT_AUTH_WINDOW);
  if (!allowed) {
    return { error: "Too many requests. Try again in an hour.", status: 429 };
  }

  // Find patient in Monday
  const patient = await findPatientByPhone(digits);
  if (!patient || !patient.uid) {
    // Don't reveal whether the phone exists — always say "sent"
    // This prevents phone enumeration attacks
    console.log(`[auth] Magic link requested for unknown phone: ${digits.slice(-4)}`);
    return { success: true, message: "If this number is in our system, you'll receive a login link shortly." };
  }

  // Generate cryptographic token
  const token = crypto.randomBytes(AUTH.TOKEN_BYTES).toString("hex");

  // Store in Redis with TTL
  await storeAuthToken(token, patient.uid, AUTH.TOKEN_TTL);

  // Send SMS
  const link = `${PORTAL_URL}?auth=${token}`;
  const smsBody = `Your Medically Modern login link (expires in 10 minutes):\n${link}\n\nDo not share this link.`;

  if (process.env.PRODUCTION_SMS_ENABLED === "true" || patient.name.includes("[TEST]")) {
    await sendSMS(digits, smsBody);
    console.log(`[auth] Magic link sent to ***${digits.slice(-4)} for UID ${patient.uid}`);
  } else {
    console.log(`[auth] SMS disabled — magic link for ***${digits.slice(-4)}: ${link}`);
  }

  return { success: true, message: "If this number is in our system, you'll receive a login link shortly." };
}

// ─── Verify magic link token → issue JWT session ───

async function verifyMagicLink(token) {
  if (!token || token.length !== AUTH.TOKEN_BYTES * 2) {
    return { error: "Invalid link", status: 400 };
  }

  // Lookup token in Redis
  const uid = await getAuthToken(token);
  if (!uid) {
    return { error: "This link has expired or already been used. Please request a new one.", status: 401 };
  }

  // One-time use — delete immediately
  await deleteAuthToken(token);

  // Generate JWT
  const jti = crypto.randomUUID();
  const jwtToken = jwt.sign(
    { uid, jti },
    JWT_SECRET,
    { expiresIn: AUTH.JWT_EXPIRY, issuer: "medically-modern-portal" }
  );

  console.log(`[auth] Session created for UID ${uid} (jti: ${jti})`);

  return {
    success: true,
    jwt: jwtToken,
    uid,
    expiresIn: AUTH.JWT_EXPIRY,
  };
}

// ─── JWT authentication middleware ───

function requireAuth(req, res, next) {
  const token = req.cookies?.session;
  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET, { issuer: "medically-modern-portal" });
    req.uid = payload.uid;
    req.jti = payload.jti;

    // Check blacklist (for logout)
    isSessionBlacklisted(payload.jti).then((blacklisted) => {
      if (blacklisted) {
        return res.status(401).json({ error: "Session expired" });
      }
      next();
    });
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Session expired" });
    }
    return res.status(401).json({ error: "Invalid session" });
  }
}

// ─── Logout (blacklist JWT) ───

async function logout(jti, exp) {
  // Blacklist for remaining lifetime of the JWT
  const remaining = exp - Math.floor(Date.now() / 1000);
  if (remaining > 0) {
    await blacklistSession(jti, remaining);
  }
}

// ─── Cookie configuration ───

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "none",      // Required for cross-origin (GitHub Pages → Railway)
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days in ms
  path: "/",
};

module.exports = { requestMagicLink, verifyMagicLink, requireAuth, logout, COOKIE_OPTIONS };
