import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";

// ─── PATH RESOLVER (same 4-strategy logic as /api/image, with path-traversal guard)
function resolveImagePath(folderParam: string, imgPathParam: string): string | null {
  const normalised  = imgPathParam.replace(/\\/g, "/");
  const trustedRoot = folderParam ? path.resolve(folderParam) + path.sep : null;

  const safe = (c: string): boolean => {
    if (!fs.existsSync(c) || !fs.statSync(c).isFile()) return false;
    if (!trustedRoot) return true;
    return path.resolve(c).startsWith(trustedRoot);
  };

  if (path.isAbsolute(imgPathParam)) {
    const c = path.resolve(imgPathParam);
    if (safe(c)) return c;
  }

  if (folderParam) {
    const c = path.resolve(folderParam, normalised);
    if (safe(c)) return c;
  }

  if (folderParam) {
    const parts = normalised.split("/").filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      const c = path.resolve(folderParam, parts.slice(i).join("/"));
      if (safe(c)) return c;
    }
  }

  if (folderParam) {
    const filename = path.basename(normalised).toLowerCase();
    const queue = [path.resolve(folderParam)];
    while (queue.length) {
      const dir = queue.shift()!;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (e.isFile() && e.name.toLowerCase() === filename) {
          const c = path.join(dir, e.name);
          if (safe(c)) return c;
        }
        if (e.isDirectory() && !e.name.startsWith(".")) queue.push(path.join(dir, e.name));
      }
    }
  }

  return null;
}

// ─── TYPES ────────────────────────────────────────────────────────────────────
interface ExportItem {
  Image:        string;
  GT:           string;
  Pred:         string;
  Path:         string;
  OriginalFile: string;
}

interface ExportBody {
  folder:      string;               // absolute path to dataset folder — files saved here
  exportList:  Record<string, ExportItem>;
  corrections: Record<string, string>;
  fileName?:   string;               // optional base name, defaults to "flagged_errors"
}

// ─── POST /api/export ─────────────────────────────────────────────────────────
// Receives the full exportList + corrections, builds an xlsx with embedded images
// and a JSON summary, writes both to the dataset folder, and returns the xlsx as
// a download response so the browser can also save a local copy.
//
// Saved files:
//   <folder>/exports/flagged_errors_<timestamp>.xlsx
//   <folder>/exports/flagged_errors_<timestamp>.json
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ExportBody;
    const { folder, exportList, corrections, fileName = "flagged_errors" } = body;

    if (!folder) return NextResponse.json({ error: "Missing folder" }, { status: 400 });
    const keys = Object.keys(exportList ?? {});
    if (!keys.length) return NextResponse.json({ error: "No items to export" }, { status: 400 });

    // ── Ensure exports sub-folder exists ──────────────────────────────────────
    const exportsDir = path.join(path.resolve(folder), "exports");
    fs.mkdirSync(exportsDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const baseName  = `${fileName}_${timestamp}`;
    const xlsxPath  = path.join(exportsDir, `${baseName}.xlsx`);
    const jsonPath  = path.join(exportsDir, `${baseName}.json`);

    // ── Build XLSX ─────────────────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook();
    wb.creator  = "OCR Validator";
    wb.created  = new Date();
    const ws = wb.addWorksheet("Flagged Errors");

    ws.columns = [
      { header: "Image Preview", key: "preview",   width: 22 },
      { header: "Image Name",    key: "name",       width: 22 },
      { header: "GT",            key: "gt",         width: 18 },
      { header: "Pred",          key: "pred",       width: 18 },
      { header: "Corrected",     key: "corrected",  width: 22 },
      { header: "Image Path",    key: "path",       width: 45 },
      { header: "Source File",   key: "source",     width: 22 },
    ];

    // Style header row
    ws.getRow(1).font      = { bold: true, size: 11 };
    ws.getRow(1).fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
    ws.getRow(1).alignment = { vertical: "middle" };
    ws.getRow(1).height    = 20;

    const ROW_HEIGHT = 72; // pixels ~ 54pt
    let rowIdx = 2;

    for (const id of keys) {
      const item      = exportList[id];
      const corrected = corrections[id] ?? "";

      ws.addRow({
        name:      item.Image,
        gt:        item.GT,
        pred:      item.Pred,
        corrected,
        path:      item.Path,
        source:    item.OriginalFile,
      });

      const row = ws.getRow(rowIdx);
      row.height    = ROW_HEIGHT;
      row.alignment = { vertical: "middle", wrapText: true };

      // Embed image from disk
      const imgPath = resolveImagePath(folder, item.Path);
      if (imgPath) {
        try {
          const buf = fs.readFileSync(imgPath);
          const ext = path.extname(imgPath).toLowerCase().slice(1);
          const excelExt =
            ext === "jpg" ? "jpeg" :
            ["jpeg", "png", "gif"].includes(ext) ? (ext as "jpeg" | "png" | "gif") :
            "png";

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const imgId = wb.addImage({ buffer: buf as any, extension: excelExt });
          // Cast position to any — ExcelJS's Anchor type requires internal nativeCol/Row
          // fields that are only needed at runtime, not at the call site.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (ws.addImage as any)(imgId, {
            tl:  { col: 0,   row: rowIdx - 1 },
            br:  { col: 0.9, row: rowIdx },     // fill column A of this row
          });
        } catch { /* skip image embed on read error */ }
      }

      rowIdx++;
    }

    // Auto-filter on header row
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 7 } };

    // Write xlsx to disk
    await wb.xlsx.writeFile(xlsxPath);

    // ── Build JSON ─────────────────────────────────────────────────────────────
    const jsonData = {
      exportedAt:  new Date().toISOString(),
      sourceFolder: folder,
      totalItems:  keys.length,
      items: keys.map((id) => ({
        id,
        imageName:   exportList[id].Image,
        imagePath:   exportList[id].Path,
        gt:          exportList[id].GT,
        pred:        exportList[id].Pred,
        corrected:   corrections[id] ?? "",
        sourceFile:  exportList[id].OriginalFile,
      })),
    };
    fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), "utf-8");

    console.log(`[/api/export] Saved:\n  ${xlsxPath}\n  ${jsonPath}`);

    // ── Return xlsx as download response ──────────────────────────────────────
    // The browser receives the file for immediate download while the server copy
    // is also persisted in <folder>/exports/.
    const xlsxBuffer = fs.readFileSync(xlsxPath);
    return new NextResponse(xlsxBuffer, {
      headers: {
        "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${baseName}.xlsx"`,
        "Content-Length":      String(xlsxBuffer.byteLength),
        "X-Saved-Xlsx":        xlsxPath,
        "X-Saved-Json":        jsonPath,
      },
    });
  } catch (err) {
    console.error("[/api/export] Error:", err);
    return NextResponse.json({ error: "Export failed: " + (err as Error).message }, { status: 500 });
  }
}
