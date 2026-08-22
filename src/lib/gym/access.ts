import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { GymError } from "./errors";

export const GYM_ACCESS_COOKIE = "pioneer_gym_access";
const TOKEN_VERSION = "v1";
const DEFAULT_ACCESS_TTL_MS = 15 * 60 * 1_000;

export interface AccessControllerOptions {
  accessCodeSha256?: string;
  cookieSecret?: string;
  now?: () => Date;
  nonce?: () => string;
  ttlMs?: number;
}

export interface AccessGrant {
  token: string;
  expiresAt: string;
  maxAgeSeconds: number;
}

export function hashAccessCode(accessCode: string): string {
  return createHash("sha256").update(accessCode, "utf8").digest("hex");
}

function constantTimeHexEqual(left: string, right: string): boolean {
  const safeLeft = /^[a-f0-9]{64}$/i.test(left)
    ? Buffer.from(left, "hex")
    : Buffer.alloc(32);
  const safeRight = /^[a-f0-9]{64}$/i.test(right)
    ? Buffer.from(right, "hex")
    : Buffer.alloc(32, 1);
  return timingSafeEqual(safeLeft, safeRight);
}

function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    try {
      cookies.set(name, decodeURIComponent(rawValue));
    } catch {
      // A malformed cookie is simply not an authenticated cookie.
    }
  }
  return cookies;
}

export class AccessController {
  private readonly accessCodeSha256: string;
  private readonly cookieSecret: string;
  private readonly now: () => Date;
  private readonly nonce: () => string;
  private readonly ttlMs: number;

  constructor(options: AccessControllerOptions = {}) {
    this.accessCodeSha256 = options.accessCodeSha256?.toLowerCase() ?? "";
    this.cookieSecret = options.cookieSecret ?? "";
    this.now = options.now ?? (() => new Date());
    this.nonce = options.nonce ?? (() => randomBytes(18).toString("base64url"));
    this.ttlMs = options.ttlMs ?? DEFAULT_ACCESS_TTL_MS;
  }

  isReady(): boolean {
    return (
      /^[a-f0-9]{64}$/.test(this.accessCodeSha256) &&
      Buffer.byteLength(this.cookieSecret, "utf8") >= 32
    );
  }

  exchange(accessCode: string): AccessGrant {
    this.assertReady();
    const candidate = hashAccessCode(accessCode);
    if (!constantTimeHexEqual(candidate, this.accessCodeSha256)) {
      throw new GymError(401, "unauthorized", "The demo access code is invalid.");
    }

    const expiresAtMs = this.now().getTime() + this.ttlMs;
    const payload = `${TOKEN_VERSION}.${expiresAtMs}.${this.nonce()}`;
    const signature = this.sign(payload);
    return {
      token: `${payload}.${signature}`,
      expiresAt: new Date(expiresAtMs).toISOString(),
      maxAgeSeconds: Math.floor(this.ttlMs / 1_000),
    };
  }

  verifyRequest(request: Request): void {
    this.assertReady();
    const token = parseCookies(request.headers.get("cookie")).get(GYM_ACCESS_COOKIE);
    if (!token || !this.verifyToken(token)) {
      throw new GymError(
        401,
        "unauthorized",
        "Enter the shared demo access code before starting a session.",
      );
    }
  }

  serializeCookie(grant: AccessGrant): string {
    return [
      `${GYM_ACCESS_COOKIE}=${encodeURIComponent(grant.token)}`,
      "Path=/",
      `Max-Age=${grant.maxAgeSeconds}`,
      "HttpOnly",
      "Secure",
      "SameSite=Strict",
    ].join("; ");
  }

  serializeClearCookie(): string {
    return [
      `${GYM_ACCESS_COOKIE}=`,
      "Path=/",
      "Max-Age=0",
      "HttpOnly",
      "Secure",
      "SameSite=Strict",
    ].join("; ");
  }

  private verifyToken(token: string): boolean {
    const parts = token.split(".");
    if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) return false;
    const [version, rawExpiry, nonce, signature] = parts;
    if (!/^\d{10,16}$/.test(rawExpiry) || !/^[A-Za-z0-9_-]{8,80}$/.test(nonce)) {
      return false;
    }
    const expiresAtMs = Number(rawExpiry);
    if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= this.now().getTime()) {
      return false;
    }
    const payload = `${version}.${rawExpiry}.${nonce}`;
    const expected = this.sign(payload);
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.cookieSecret)
      .update(payload, "utf8")
      .digest("base64url");
  }

  private assertReady() {
    if (!this.isReady()) {
      throw new GymError(
        503,
        "service_unavailable",
        "Demo access control is not configured.",
      );
    }
  }
}

export function createAccessController(options: AccessControllerOptions = {}) {
  return new AccessController(options);
}
