import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const SOURCE_EXTS = [".tsv", ".csv", ".txt", ".json"];
const FILTER_LIST = SOURCE_EXTS.map((e) => e.slice(1).toUpperCase()).join(", ");

// GET /api/fs/pick
// Opens the native Windows OpenFileDialog (via PowerShell) and returns the selected file path.
// Admin-only endpoint — only works when the server runs on the same machine as the browser.
export async function GET() {
  try {
    const filterExts = SOURCE_EXTS.map((e) => `*${e}`).join(";");

    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = "Select Dataset File"
$dialog.Filter = "Dataset files (${FILTER_LIST})|${filterExts}|All files (*.*)|*.*"
$dialog.Multiselect = $false
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dialog.FileName
} else {
  Write-Output ""
}
`.trim();

    const { stdout, stderr } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", psScript],
      { timeout: 60000, windowsHide: false }
    );

    if (stderr && stderr.trim()) {
      console.error("[/api/fs/pick] PowerShell stderr:", stderr);
    }

    const selected = stdout.trim();
    if (!selected) {
      // User cancelled
      return NextResponse.json({ cancelled: true, path: null });
    }

    return NextResponse.json({ cancelled: false, path: selected, name: selected.split("\\").pop() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/fs/pick] Error:", msg);
    return NextResponse.json({ error: "Failed to open file picker: " + msg }, { status: 500 });
  }
}
