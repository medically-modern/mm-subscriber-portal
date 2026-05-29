const { SDK: RingCentral } = require("@ringcentral/sdk");

let platform = null;
let rcInstance = null;

async function initRingCentral() {
  if (!rcInstance) {
    rcInstance = new RingCentral({
      server: process.env.RC_SERVER_URL,
      clientId: process.env.RC_CLIENT_ID,
      clientSecret: process.env.RC_CLIENT_SECRET,
    });
    platform = rcInstance.platform();
  }

  // Check if logged in; re-authenticate with JWT if not
  const loggedIn = await platform.loggedIn();
  if (!loggedIn) {
    console.log("[sms] RingCentral token expired or missing — re-authenticating with JWT");
    await platform.login({ jwt: process.env.RC_JWT });
    console.log("[sms] RingCentral re-authenticated");
  }

  return platform;
}

// Force clear cached auth so next call re-authenticates
function clearRingCentral() {
  platform = null;
  rcInstance = null;
}

async function sendSMS(to, body) {
  // Normalize phone to E.164
  let digits = to.replace(/\D/g, "");
  if (digits.length === 10) digits = "1" + digits;
  const e164 = `+${digits}`;

  // Timeout after 15 seconds
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("SMS send timed out after 15s")), 15000)
  );

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const p = await initRingCentral();

      const send = p.post("/restapi/v1.0/account/~/extension/~/sms", {
        from: { phoneNumber: process.env.RC_FROM_NUMBER },
        to: [{ phoneNumber: e164 }],
        text: body,
      });

      const resp = await Promise.race([send, timeout]);
      const data = await resp.json();
      console.log(`[sms] Sent to ${e164}: ${data.messageStatus}`);
      return data;
    } catch (err) {
      const isAuthError = /refresh token|unauthorized|token.*expired|not authenticated/i.test(err.message);
      if (isAuthError && attempt === 0) {
        console.warn(`[sms] Auth error on attempt 1, clearing platform and retrying: ${err.message}`);
        clearRingCentral();
        continue;
      }
      throw err;
    }
  }
}

module.exports = { sendSMS, initRingCentral };
