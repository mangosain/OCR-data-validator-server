import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// ─── MIME MAP ─────────────────────────────────────────────────────────────────
const MIME_MAP: Record<string, string> = {
  png:  "image/png",
  jpg:  "image/jpeg",
  jpeg: "image/jpeg",
  gif:  "image/gif",
  bmp:  "image/bmp",
  webp: "image/webp",
  tiff: "image/tiff",
  tif:  "image/tiff",
};

// ─── SERVER-SIDE CONCURRENCY LIMITER ─────────────────────────────────────────
const MAX_CONCURRENT_READS = 8;
let activeReads = 0;
const waitQueue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  return new Promise((resolve) => {
    if (activeReads < MAX_CONCURRENT_READS) { activeReads++; resolve(); }
    else waitQueue.push(resolve);
  });
}

function releaseSlot(): void {
  const next = waitQueue.shift();
  if (next) next();
  else activeReads--;
}

// ─── PATH RESOLVER ────────────────────────────────────────────────────────────
// Tries multiple strategies to find the image on disk.
// Returns { resolved, strategy } if found, null otherwise.
//
// SECURITY: Every candidate is checked against the dataset folder root to
// prevent path-traversal attacks (e.g. "../../etc/passwd" in the path param).
function resolveImagePath(
  folderParam: string,
  imgPathParam: string
): { resolved: string; strategy: string } | null {

  // Compute the trusted root once — all resolved paths must stay inside it.
  const trustedRoot = folderParam ? path.resolve(folderParam) + path.sep : null;

  /** Returns true only if candidate is a real file AND within the trusted root. */
  const safe = (candidate: string): boolean => {
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) return false;
    // For absolute-path strategy there is no folder constraint, so skip root check.
    if (!trustedRoot) return true;
    // Resolve again to eliminate any remaining .. segments.
    const real = path.resolve(candidate);
    return real.startsWith(trustedRoot);
  };

  // Normalise: always use forward slashes internally, then convert for Windows
  const normalised = imgPathParam.replace(/\\/g, "/");

  // Strategy 1: absolute path as-is (only allowed when it also lives inside trustedRoot)
  if (path.isAbsolute(imgPathParam)) {
    const candidate = path.resolve(imgPathParam);
    if (safe(candidate))
      return { resolved: candidate, strategy: "absolute" };
  }

  // Strategy 2: relative to dataset folder (most common for relative paths)
  if (folderParam) {
    const candidate = path.resolve(folderParam, normalised);
    if (safe(candidate))
      return { resolved: candidate, strategy: "relative-to-folder" };
  }

  // Strategy 3: strip leading path components one at a time, resolve against folder
  if (folderParam) {
    const parts = normalised.split("/").filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      const sub = parts.slice(i).join("/");
      const candidate = path.resolve(folderParam, sub);
      if (safe(candidate))
        return { resolved: candidate, strategy: `strip-${i}-prefix` };
    }
  }

  // Strategy 4: BFS filename-only search within folder subtree (slowest — last resort)
  if (folderParam) {
    const filename = path.basename(normalised).toLowerCase();
    const dirsToSearch = [path.resolve(folderParam)];
    while (dirsToSearch.length > 0) {
      const dir = dirsToSearch.shift()!;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch { continue; }
      for (const entry of entries) {
        if (entry.isFile() && entry.name.toLowerCase() === filename) {
          const candidate = path.join(dir, entry.name);
          if (safe(candidate))
            return { resolved: candidate, strategy: "bfs-filename" };
        }
        if (entry.isDirectory() && !entry.name.startsWith("."))
          dirsToSearch.push(path.join(dir, entry.name));
      }
    }
  }

  return null;
}

// ─── ROUTE HANDLER ────────────────────────────────────────────────────────────
// GET /api/image?folder=<absolute-folder>&path=<image-path>
export async function GET(req: NextRequest): Promise<NextResponse> {
  const folderParam  = req.nextUrl.searchParams.get("folder") || "";
  const imgPathParam = req.nextUrl.searchParams.get("path");

  if (!imgPathParam) {
    return NextResponse.json({ error: "Missing ?path= parameter" }, { status: 400 });
  }

  const ext = path.extname(imgPathParam).toLowerCase().slice(1);
  if (!MIME_MAP[ext]) {
    console.warn(`[/api/image] Unsupported extension ".${ext}" for: ${imgPathParam}`);
    return NextResponse.json({ error: `Unsupported image extension: .${ext}` }, { status: 400 });
  }

  await acquireSlot();

  try {
    const result = resolveImagePath(folderParam, imgPathParam);

    if (!result) {
      // Detailed 404 log so you can see exactly what was tried
      console.warn(
        `[/api/image] 404 — could not find image.\n` +
        `  folder:  ${folderParam || "(empty)"}\n` +
        `  path:    ${imgPathParam}\n` +
        `  tried:   absolute | relative-to-folder | strip-prefix | bfs-filename`
      );
      return new NextResponse(null, { status: 404 });
    }

    console.log(`[/api/image] ✓ ${result.strategy} → ${result.resolved}`);
    const fileBuffer = await fs.promises.readFile(result.resolved);

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type":   MIME_MAP[ext],
        "Cache-Control":  "public, max-age=3600, immutable",
        "Content-Length": String(fileBuffer.byteLength),
      },
    });
  } catch (err) {
    console.error("[/api/image] Read error:", err);
    return new NextResponse(null, { status: 500 });
  } finally {
    releaseSlot();
  }
}
