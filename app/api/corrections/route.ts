import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { broadcast } from "../events/route";

function getCorrectionsPath(folderPath: string): string {
  return path.join(path.resolve(folderPath), "corrections_state.json");
}

interface CorrectionsState {
  corrections: Record<string, string>;
  exportList:  Record<string, {
    Image: string; GT: string; Pred: string; Path: string; OriginalFile: string;
  }>;
  lastUpdated: string;
}

function readState(filePath: string): CorrectionsState {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch { /* corrupt — return empty */ }
  return { corrections: {}, exportList: {}, lastUpdated: new Date().toISOString() };
}

function atomicWrite(filePath: string, data: object): void {
  const tmp = `${filePath}.tmp_${process.pid}_${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

// ─── VALIDATION ───────────────────────────────────────────────────────────────
const MAX_VALUE_LEN = 10_000;
function sanitiseStringMap(raw: unknown): Record<string, string> | null {
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
  } catch { /* non-critical */ }
}

// ─── AUTO-BACKUP ─────────────────────────────────────────────────────────────
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
    const backupsRoot = path.join(path.resolve(folderPath), "backups");
    const dirs = fs.readdirSync(backupsRoot)
      .filter((d) => !d.startsWith("."))
      .map((d) => path.join(backupsRoot, d))
      .filter((d) => fs.statSync(d).isDirectory())
      .sort();
    while (dirs.length > MAX_BACKUPS) {
      fs.rmSync(dirs.shift()!, { recursive: true, force: true });
    }
  } catch { /* non-critical */ }
}

// GET /api/corrections?folder=<path>
export async function GET(req: NextRequest) {
  try {
    const folder = req.nextUrl.searchParams.get("folder");
    if (!folder) return NextResponse.json({ error: "Missing ?folder=" }, { status: 400 });
    return NextResponse.json(readState(getCorrectionsPath(folder)));
  } catch (err) {
    console.error("[/api/corrections GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/corrections
// Body: { folder, corrections?, exportList?, removeFlagId?, editor? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      folder:        string;
      corrections?:  Record<string, string>;
      exportList?:   Record<string, object>;
      removeFlagId?: string;
      editor?:       string;
    };

    const { folder, exportList, removeFlagId, editor = "unknown" } = body;
    if (!folder || typeof folder !== "string") {
      return NextResponse.json({ error: "Missing folder" }, { status: 400 });
    }

    // Validate corrections map if provided
    let corrections: Record<string, string> | null = null;
    if (body.corrections !== undefined) {
      corrections = sanitiseStringMap(body.corrections);
      if (!corrections) {
        return NextResponse.json(
          { error: "Invalid corrections: must be { [id: string]: string }, max 10KB per value" },
          { status: 400 }
        );
      }
    }

    const filePath = getCorrectionsPath(folder);
    const current  = readState(filePath);
    const auditEntries: AuditEntry[] = [];

    if (corrections) {
      for (const [id, val] of Object.entries(corrections)) {
        auditEntries.push({
          timestamp: new Date().toISOString(), editor,
          itemId: id, field: "correction",
          oldValue: current.corrections[id] ?? "", newValue: val,
        });
        current.corrections[id] = val;
        broadcast({ type: "correction_update", id, correction: val, editor });
      }
    }

    if (exportList && typeof exportList === "object") {
      Object.assign(current.exportList, exportList);
      for (const id of Object.keys(exportList)) {
        broadcast({ type: "flag_update", id, flagged: true, editor });
      }
    }

    if (removeFlagId && typeof removeFlagId === "string") {
      delete current.exportList[removeFlagId];
      broadcast({ type: "flag_update", id: removeFlagId, flagged: false, editor });
    }

    current.lastUpdated = new Date().toISOString();
    maybeBackup(folder, filePath);
    atomicWrite(filePath, current);
    appendAuditLog(folder, auditEntries);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/corrections POST]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
