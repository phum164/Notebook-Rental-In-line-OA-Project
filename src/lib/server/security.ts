import {
  createHash,
  createHmac,
  createPrivateKey,
  randomBytes,
  randomUUID,
  sign,
  timingSafeEqual,
} from "node:crypto";

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function opaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function adminCsrfToken(secret: string, adminId: string, accessToken: string): string {
  return createHmac("sha256", secret).update(`${adminId}:${sha256(accessToken)}`).digest("base64url");
}

export type JwtClaims = Record<string, unknown> & {
  iss: string;
  aud: string;
  role: string;
  sub: string;
  principal_type: string;
  iat: number;
  nbf: number;
  exp: number;
};

export function signJwt(claims: JwtClaims, privateKeyPem: string, keyId: string): string {
  const key = createPrivateKey(privateKeyPem.replace(/\\n/g, "\n"));
  const keyType = key.asymmetricKeyType;
  if (keyType === "ec" && key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("JWT signing requires a P-256 EC key");
  }
  if (keyType !== "rsa" && keyType !== "ec" && keyType !== "ed25519") {
    throw new Error("Unsupported JWT signing key type");
  }
  const algorithm = keyType === "ec" ? "ES256" : keyType === "ed25519" ? "EdDSA" : "RS256";
  const encodedHeader = Buffer.from(JSON.stringify({ alg: algorithm, kid: keyId, typ: "JWT" })).toString("base64url");
  const encodedClaims = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const payload = Buffer.from(`${encodedHeader}.${encodedClaims}`);
  const signature = algorithm === "EdDSA"
    ? sign(null, payload, key)
    : sign(algorithm === "ES256" ? "sha256" : "RSA-SHA256", payload, algorithm === "ES256" ? { key, dsaEncoding: "ieee-p1363" } : key);
  return `${payload.toString()}.${signature.toString("base64url")}`;
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split(".")[1];
    return payload ? JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export const secureRandomUuid = randomUUID;

export interface RateLimiter {
  consume(key: string, limit: number, windowMs: number, now: number): boolean;
}

export function createMemoryRateLimiter(): RateLimiter {
  const entries = new Map<string, { count: number; resetsAt: number }>();
  return {
    consume(key, limit, windowMs, now) {
      const existing = entries.get(key);
      if (!existing || existing.resetsAt <= now) {
        entries.set(key, { count: 1, resetsAt: now + windowMs });
        return true;
      }
      existing.count += 1;
      return existing.count <= limit;
    },
  };
}
