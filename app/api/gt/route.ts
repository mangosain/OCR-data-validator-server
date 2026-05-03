import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { broadcast } from "../events/route";

function getGtStatePath(folderPath: string): string {
  return path.join(path.resolve(folderPath), "gt_state.json");
}

// ─── AUDIT LOG ────────────────────────────────────────────────────────────────
interface AuditEntry {
  timestamp: string; editor: string;
  itemId: string; field: string;
  oldValue: string; newValue: string;
}
function appendAuditLog(folderPath: string, entries: AuditEntry[]): void {
  if (!entries.length) return;
  try {
    const logPath = path.join(path.resolve(folderPath), "edit_history.ndjson");
    const lines   = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
    fs.appendFileSync(logPath, lines, "utf-8");
  } catch { /* non-critical — don't fail the write */ }
}

// ─── AUTO-BACKUP ─────────────────────────────────────────────────────────────
// Keeps up to 10 rolling backups of gt_state.json, written at most once per 5 min.
const BACKUP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_BACKUPS        = 10;
const lastBackupTime     = new Map<string, number>();

function maybeBackup(folderPath: string, filePath: string): void {
  const now  = Date.now();
  const last = lastBackupTime.get(filePath) ?? 0;
  if (now - last < BACKUP_INTERVAL_MS) return;
  try {
    if (!fs.existsSync(filePath)) return;
    const backupDir = path.join(path.resolve(folderPath), "backups",
      new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
    fs.mkdirSync(backupDir, { recursive: true });
    fs.copyFileSync(filePath, path.join(backupDir, path.basename(filePath)));
    lastBackupTime.set(filePath, now);
    // Prune old backups — keep newest MAX_BACKUPS
    const backupsRoot = path.join(path.resolve(folderPath), "backups");
    const dirs = fs.readdirSync(backupsRoot)
      .filter((d) => !d.startsWith("."))
      .map((d) => path.join(backupsRoot, d))
      .filter((d) => fs.statSync(d).isDirectory())
      .sort(); // ISO timestamps sort chronologically
    while (dirs.length > MAX_BACKUPS) {
      fs.rmSync(dirs.shift()!, { recursive: true, force: true });
    }
  } catch { /* non-critical */ }
}

function readGtState(gtPath: string): Record<string, string> {
  try {
    if (fs.existsSync(gtPath)) return JSON.parse(fs.readFileSync(gtPath, "utf-8"));
  } catch { /* corrupt — treat as empty */ }
  return {};
}

// Atomic write: temp file → rename — safe under concurrent saves
function atomicWrite(filePath: string, data: object): void {
  const tmp = `${filePath}.tmp_${process.pid}_${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

// GET /api/gt?folder=<path>  →  { state: { [itemId]: gtString } }
export async function GET(req: NextRequest) {
  try {
    const folder = req.nextUrl.searchParams.get("folder");
    if (!folder) return NextResponse.json({ error: "Missing ?folder=" }, { status: 400 });
    const state = readGtState(getGtStatePath(folder));
    return NextResponse.json({ state });
  } catch (err) {
    console.error("[/api/gt GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── VALIDATION HELPERS ───────────────────────────────────────────────────────
const MAX_VALUE_LEN = 10_000; // 10 KB per field — prevents file bloat

function sanitiseUpdates(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== "string" || k.length === 0 || k.length > 1024) return null;
    if (typeof v !== "string") return null;
    if (v.length > MAX_VALUE_LEN) return null;
    out[k] = v;
  }
  return out;
}

// POST /api/gt  →  body: { folder, updates: { [itemId]: string }, editor? }
// Merges updates atomically, then broadcasts each change over SSE so all
// connected clients update that specific card immediately (no polling delay).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      folder:   string;
      updates:  Record<string, string>;
      editor?:  string;
    };
    const { folder, editor = "unknown" } = body;

    if (!folder || typeof folder !== "string") {
      return NextResponse.json({ error: "Invalid body. Expected { folder, updates }" }, { status: 400 });
    }

    const updates = sanitiseUpdates(body.updates);
    if (!updates) {
      return NextResponse.json({ error: "Invalid updates: must be { [id: string]: string }, max 10KB per value" }, { status: 400 });
    }

    const gtPath = getGtStatePath(folder);
    const current = readGtState(gtPath);

    // Build audit entries before overwriting so we capture oldValue
    const auditEntries = Object.entries(updates).map(([id, newVal]) => ({
      timestamp: new Date().toISOString(), editor,
      itemId: id, field: "gt",
      oldValue: current[id] ?? "", newValue: newVal,
    }));

    const merged  = { ...current, ...updates };
    maybeBackup(folder, gtPath);
    atomicWrite(gtPath, merged);
    appendAuditLog(folder, auditEntries);

    // Broadcast each updated GT to all SSE clients so only the changed card re-renders
    for (const [id, gt] of Object.entries(updates)) {
      broadcast({ type: "gt_update", id, gt, editor });
    }

    return NextResponse.json({ ok: true, written: Object.keys(updates).length });
  } catch (err) {
    console.error("[/api/gt POST]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
