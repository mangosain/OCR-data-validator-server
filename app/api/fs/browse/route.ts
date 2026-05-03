import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// Source file extensions we recognise as dataset files
const SOURCE_EXTS = new Set([".tsv", ".csv", ".txt", ".json"]);
// Image extensions we care about (for display in the browser)
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".tiff", ".tif"]);

export async function GET(req: NextRequest) {
  try {
    const rawPath = req.nextUrl.searchParams.get("path");
    if (!rawPath) {
      return NextResponse.json({ error: "Missing ?path= parameter" }, { status: 400 });
    }

    // Resolve and normalise — prevents directory traversal
    const resolved = path.resolve(rawPath);

    // Stat the path first
    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved);
    } catch {
      return NextResponse.json({ error: `Path not found: ${resolved}` }, { status: 404 });
    }

    if (!stat.isDirectory()) {
      return NextResponse.json({ error: "Path is not a directory" }, { status: 400 });
    }

    // Read entries
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(resolved, { withFileTypes: true });
    } catch {
      return NextResponse.json({ error: "Cannot read directory (permission denied?)" }, { status: 403 });
    }

    const dirs: { name: string; path: string }[] = [];
    const sourceFiles: { name: string; path: string; ext: string }[] = [];
    let imageCount = 0;
    let hasSourceFile = false;

    for (const entry of entries) {
      // Skip hidden files/folders (dot-prefixed)
      if (entry.name.startsWith(".")) continue;

      const entryPath = path.join(resolved, entry.name);
      const ext = path.extname(entry.name).toLowerCase();

      if (entry.isDirectory()) {
        dirs.push({ name: entry.name, path: entryPath });
      } else if (entry.isFile()) {
        if (SOURCE_EXTS.has(ext)) {
          sourceFiles.push({ name: entry.name, path: entryPath, ext });
          hasSourceFile = true;
        } else if (IMAGE_EXTS.has(ext)) {
          imageCount++;
        }
      }
    }

    // Sort directories alphabetically
    dirs.sort((a, b) => a.name.localeCompare(b.name));
    sourceFiles.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      currentPath: resolved,
      // Parent path for "go up" navigation
      parentPath: path.dirname(resolved) !== resolved ? path.dirname(resolved) : null,
      directories: dirs,
      sourceFiles,
      imageCount,
      hasSourceFile,
    });
  } catch (err) {
    console.error("[/api/fs/browse] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
