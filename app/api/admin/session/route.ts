import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { broadcast } from "../../events/route";

// active_session.json lives in the project root — it is global app state,
// not tied to any specific dataset folder.
const SESSION_FILE = path.join(process.cwd(), "active_session.json");

export interface ActiveSession {
  folderPath: string;
  filePath:   string;
  fileName:   string;
  loadedAt:   string;
}

function readSession(): ActiveSession | null {
  try {
    if (!fs.existsSync(SESSION_FILE)) return null;
    return JSON.parse(fs.readFileSync(SESSION_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function writeSession(session: ActiveSession | null): void {
  if (session === null) {
    try { fs.unlinkSync(SESSION_FILE); } catch { /* already gone */ }
  } else {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), "utf-8");
  }
}

// GET /api/admin/session
// Returns the currently active session, or { session: null } if nothing is loaded.
// Called by the user panel on mount to check if a dataset is already loaded.
export async function GET() {
  const session = readSession();
  return NextResponse.json({ session });
}

// POST /api/admin/session
// Body: ActiveSession object to set, or { clear: true } to unload.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (body.clear) {
      writeSession(null);
      broadcast({ type: "dataset_unloaded" });
      return NextResponse.json({ ok: true, action: "cleared" });
    }

    const { folderPath, filePath, fileName } = body as Partial<ActiveSession>;
    if (!folderPath || !filePath || !fileName) {
      return NextResponse.json(
        { error: "Missing required fields: folderPath, filePath, fileName" },
        { status: 400 }
      );
    }

    const session: ActiveSession = {
      folderPath,
      filePath,
      fileName,
      loadedAt: new Date().toISOString(),
    };

    writeSession(session);

    // Broadcast to all connected SSE clients — they will fetch the dataset immediately
    broadcast({ type: "dataset_loaded", session });

    return NextResponse.json({ ok: true, session });
  } catch (err) {
    console.error("[/api/admin/session POST]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
