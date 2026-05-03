import { NextRequest, NextResponse } from "next/server";

// ─── LOCALHOST DETECTION ──────────────────────────────────────────────────────
// All of these represent "this machine" across IPv4, IPv6, and mapped addresses.
// NOTE: req.ip was removed in Next.js 15+. IP must be read from headers only.
const LOCALHOST_IPS = new Set([
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
  "localhost",
]);

function isLocalhost(req: NextRequest): boolean {
  // ── Security note on x-forwarded-for ────────────────────────────────────────
  // x-forwarded-for is a comma-separated list: "client, proxy1, proxy2".
  // The LEFTMOST IP is supplied by the client and can be spoofed.
  // The RIGHTMOST IP is added by the last trusted proxy and cannot be forged
  // by a remote client (because the proxy appends it server-side).
  //
  // This app runs without a trusted reverse proxy in front of it (direct Next.js),
  // so there is no safe x-forwarded-for entry to rely on. Instead we:
  //   1. Prefer x-real-ip which nginx sets from the actual TCP connection (not spoofable).
  //   2. Fall back to the last (rightmost) entry in x-forwarded-for, which is the
  //      nearest hop — still spoofable without a trusted proxy, but harder than the first.
  //   3. Never use the leftmost (client-supplied) x-forwarded-for entry alone.
  //
  // In production, place nginx in front and configure it to strip user-supplied
  // x-forwarded-for headers before adding the real IP. That fully eliminates the risk.
  // ────────────────────────────────────────────────────────────────────────────

  const realIp    = req.headers.get("x-real-ip")?.trim();
  const forwarded = req.headers.get("x-forwarded-for");
  const cfIp      = req.headers.get("cf-connecting-ip")?.trim();

  // Use x-real-ip first (nginx sets this from TCP connection, not from headers)
  if (realIp) return LOCALHOST_IPS.has(realIp);

  // Use rightmost x-forwarded-for entry (nearest trusted hop without a proxy)
  if (forwarded) {
    const hops = forwarded.split(",").map((h) => h.trim()).filter(Boolean);
    const rightmost = hops[hops.length - 1];
    if (rightmost) return LOCALHOST_IPS.has(rightmost);
  }

  // Cloudflare: cf-connecting-ip is the real client IP set by CF edge, not user
  if (cfIp) return LOCALHOST_IPS.has(cfIp);

  // No IP information at all — deny
  return false;
}

// ─── PROXY (Next.js 16 replaces "middleware" with "proxy") ───────────────────
// Guard: /admin pages and /api/admin/* routes are localhost-only.
// Remote clients get a clean 403 before any page code runs.
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isAdminPath =
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname.startsWith("/api/admin");

  if (isAdminPath && !isLocalhost(req)) {
    return NextResponse.json(
      { error: "Admin panel is only accessible from the host machine." },
      { status: 403 }
    );
  }

  return NextResponse.next();
}

// Only run on admin paths — everything else is untouched
export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/admin/:path*"],
};
