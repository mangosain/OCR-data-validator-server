import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const SOURCE_EXTS = [".tsv", ".csv", ".txt", ".json"];

// GET /api/dataset?folder=<absolute-path>
// Scans the given folder for a recognised dataset source file and returns its content.
// Also accepts ?file=<absolute-path-to-specific-file> to load a specific file directly.
export async function GET(req: NextRequest) {
  try {
    const specificFile = req.nextUrl.searchParams.get("file");
    const folderPath = req.nextUrl.searchParams.get("folder");

    let targetFile: string | null = null;
    let targetFolder: string;

    if (specificFile) {
      // Direct file path specified
      const resolved = path.resolve(specificFile);
      const ext = path.extname(resolved).toLowerCase();
      if (!SOURCE_EXTS.includes(ext)) {
        return NextResponse.json({ error: "File must be .tsv, .csv, .txt, or .json" }, { status: 400 });
      }
      if (!fs.existsSync(resolved)) {
        return NextResponse.json({ error: `File not found: ${resolved}` }, { status: 404 });
      }
      targetFile = resolved;
      targetFolder = path.dirname(resolved);
    } else if (folderPath) {
      // Scan folder for first matching source file
      const resolved = path.resolve(folderPath);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        return NextResponse.json({ error: `Folder not found: ${resolved}` }, { status: 404 });
      }
      targetFolder = resolved;

      // BFS to find source file (depth-limited to 2 levels to avoid huge scans)
      const dirsToSearch: { dir: string; depth: number }[] = [{ dir: resolved, depth: 0 }];
      outer: while (dirsToSearch.length > 0) {
        const { dir, depth } = dirsToSearch.shift()!;
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const entry of entries) {
          if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (SOURCE_EXTS.includes(ext)) {
              targetFile = path.join(dir, entry.name);
              break outer;
            }
          } else if (entry.isDirectory() && depth < 2 && !entry.name.startsWith(".")) {
            dirsToSearch.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
          }
        }
      }

      if (!targetFile) {
        return NextResponse.json(
          { error: "No dataset file (.tsv, .csv, .txt, .json) found in the selected folder." },
          { status: 404 }
        );
      }
    } else {
      return NextResponse.json({ error: "Provide ?folder= or ?file= parameter" }, { status: 400 });
    }

    const content = fs.readFileSync(targetFile!, "utf-8");
    const fileName = path.basename(targetFile!);

    return NextResponse.json({
      content,
      fileName,
      filePath: targetFile,
      folderPath: targetFolder!,
    });
  } catch (err) {
    console.error("[/api/dataset] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
