const { SDK: RingCentral } = require("@ringcentral/sdk");

let platform = null;

async function initRingCentral() {
  if (platform) return platform;

  const rc = new RingCentral({
    server: process.env.RC_SERVER_URL,
    clientId: process.env.RC_CLIENT_ID,
    clientSecret: process.env.RC_CLIENT_SECRET,
  });

  platform = rc.platform();
  await platform.login({ jwt: process.env.RC_JWT });
  console.log("[sms] RingCentral authenticated");
  return platform;
}

async function sendSMS(to, body) {
  const p = await initRingCentral();

  // Normalize phone to E.164
  let digits = to.replace(/\D/g, "");
  if (digits.length === 10) digits = "1" + digits;
  const e164 = `+${digits}`;

  // Timeout after 15 seconds
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("SMS send timed out after 15s")), 15000)
  );

  const send = p.post("/restapi/v1.0/account/~/extension/~/sms", {
    from: { phoneNumber: process.env.RC_FROM_NUMBER },
    to: [{ phoneNumber: e164 }],
    text: body,
  });

  const resp = await Promise.race([send, timeout]);
  const data = await resp.json();
  console.log(`[sms] Sent to ${e164}: ${data.messageStatus}`);
  return data;
}

module.exports = { sendSMS, initRingCentral };
