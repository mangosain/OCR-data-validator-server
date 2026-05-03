import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// GET /api/audit?folder=<path>&limit=<n>
// Returns the last N audit entries from edit_history.ndjson.
// Each line is a JSON object: { timestamp, editor, itemId, field, oldValue, newValue }
export async function GET(req: NextRequest) {
  try {
    const folder = req.nextUrl.searchParams.get("folder");
    const limit  = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10), 500);

    if (!folder || typeof folder !== "string") {
      return NextResponse.json({ error: "Missing ?folder=" }, { status: 400 });
    }

    const logPath = path.join(path.resolve(folder), "edit_history.ndjson");

    if (!fs.existsSync(logPath)) {
      return NextResponse.json({ entries: [], total: 0 });
    }

    const raw     = fs.readFileSync(logPath, "utf-8");
    const lines   = raw.split("\n").filter(Boolean);
    const entries = lines
      .slice(-limit)                          // last N lines
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean)
      .reverse();                             // newest first

    return NextResponse.json({ entries, total: lines.length });
  } catch (err) {
    console.error("[/api/audit GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
