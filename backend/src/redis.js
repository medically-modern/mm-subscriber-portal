const Redis = require("ioredis");

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    return Math.min(times * 200, 5000);
  },
});

redis.on("error", (err) => console.error("[redis] Error:", err.message));
redis.on("connect", () => console.log("[redis] Connected"));

// ─── Auth token storage ───

async function storeAuthToken(token, uid, ttl) {
  await redis.set(`auth:${token}`, uid, "EX", ttl);
}

async function getAuthToken(token) {
  return redis.get(`auth:${token}`);
}

async function deleteAuthToken(token) {
  await redis.del(`auth:${token}`);
}

// ─── Auth rate limiting ───

async function checkAuthRateLimit(phone, maxRequests, windowSeconds) {
  const key = `auth_rate:${phone}`;
  const current = await redis.incr(key);
  if (current === 1) {
    await redis.expire(key, windowSeconds);
  }
  return current <= maxRequests;
}

// ─── Session storage (JWT blacklist for logout) ───

async function blacklistSession(jti, expiresInSeconds) {
  await redis.set(`blacklist:${jti}`, "1", "EX", expiresInSeconds);
}

async function isSessionBlacklisted(jti) {
  const val = await redis.get(`blacklist:${jti}`);
  return val === "1";
}

// ─── Patient data cache ───

async function cachePatientData(uid, data, ttl = 300) {
  await redis.set(`patient:${uid}`, JSON.stringify(data), "EX", ttl);
}

async function getCachedPatientData(uid) {
  const raw = await redis.get(`patient:${uid}`);
  return raw ? JSON.parse(raw) : null;
}

async function invalidatePatientCache(uid) {
  await redis.del(`patient:${uid}`);
}

// ─── Phone → UID index ───

async function indexPhoneToUid(phone, uid) {
  // Normalize to digits only
  const digits = phone.replace(/\D/g, "");
  await redis.set(`phone:${digits}`, uid);
}

async function getUidByPhone(phone) {
  const digits = phone.replace(/\D/g, "");
  return redis.get(`phone:${digits}`);
}

// ─── Health check ───

async function healthCheck() {
  try {
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  redis,
  storeAuthToken, getAuthToken, deleteAuthToken,
  checkAuthRateLimit,
  blacklistSession, isSessionBlacklisted,
  cachePatientData, getCachedPatientData, invalidatePatientCache,
  indexPhoneToUid, getUidByPhone,
  healthCheck,
};
