import { NextResponse } from "next/server";
import { sseClients } from "../events/route";
import fs from "fs";
import path from "path";

const startTime = Date.now();

// GET /api/health
// Returns server liveness info. Safe to poll from monitoring tools.
export async function GET() {
  // Read active session if one exists
  let session: Record<string, unknown> | null = null;
  try {
    const sessionFile = path.join(process.cwd(), "active_session.json");
    if (fs.existsSync(sessionFile))
      session = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
  } catch { /* ignore */ }

  return NextResponse.json({
    status:           "ok",
    timestamp:        new Date().toISOString(),
    uptimeSeconds:    Math.floor((Date.now() - startTime) / 1000),
    connectedClients: sseClients.size,
    session:          session
      ? { fileName: session.fileName, loadedAt: session.loadedAt }
      : null,
  });
}
