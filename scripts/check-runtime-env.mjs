import { createPrivateKey } from "node:crypto";

const env = process.env;
const checks = [];
function check(name, value, valid = (text) => Boolean(text)) {
  const status = !value ? "missing" : valid(value) ? "configured" : "invalid";
  checks.push({ name, status });
}
function httpsOrigin(value) {
  try { const url = new URL(value); return url.protocol === "https:" && url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash; }
  catch { return false; }
}
check("NEXT_PUBLIC_APP_URL (HTTPS required for admin cookies)", env.NEXT_PUBLIC_APP_URL, httpsOrigin);
check("Supabase URL", env.NEXT_PUBLIC_SUPABASE_URL, httpsOrigin);
check("Supabase publishable key", env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY);
check("SUPABASE_AUTH_PROVIDER", env.SUPABASE_AUTH_PROVIDER, (value) => /^[a-z][a-z0-9_-]{0,63}$/.test(value));
check("SESSION_SIGNING_SECRET", env.SESSION_SIGNING_SECRET, (value) => value.length >= 32);
check("CUSTOMER_DB_JWT_PRIVATE_KEY (PEM)", env.CUSTOMER_DB_JWT_PRIVATE_KEY, (value) => {
  try {
    const key = createPrivateKey(value.replace(/\\n/g, "\n"));
    return key.asymmetricKeyType === "rsa" || key.asymmetricKeyType === "ed25519"
      || (key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails.namedCurve === "prime256v1");
  }
  catch { return false; }
});
for (const name of ["CUSTOMER_DB_JWT_KEY_ID", "CUSTOMER_DB_JWT_ISSUER", "CUSTOMER_DB_JWT_AUDIENCE", "LINE_CHANNEL_ID", "LINE_CHANNEL_SECRET", "NEXT_PUBLIC_LINE_LIFF_ID"]) check(name, env[name]);
check("CRON_SECRET", env.CRON_SECRET, (value) => value.length >= 32);
if (env.LINE_NOTIFICATIONS_ENABLED === "true") {
  check("LINE_CHANNEL_ACCESS_TOKEN", env.LINE_CHANNEL_ACCESS_TOKEN);
  check("LINE_NOTIFICATION_POLICY_JSON", env.LINE_NOTIFICATION_POLICY_JSON, (value) => {
    try { const policy = JSON.parse(value); return typeof policy.approvalReference === "string" && policy.approvalReference.trim().length > 0 && policy.events && Object.keys(policy.events).length > 0; }
    catch { return false; }
  });
}
console.table(checks);
console.log("Only configuration presence/shape was checked. Provider authentication, trusted signing keys, DB settings, scanner, approval and deployment still require their acceptance evidence.");
process.exitCode = checks.some((item) => item.status !== "configured") ? 1 : 0;
