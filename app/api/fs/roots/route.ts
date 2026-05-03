import { NextResponse } from "next/server";
import fs from "fs";
import os from "os";

// Returns the available filesystem roots on the host machine.
// On Windows: lists available drive letters (C:\, D:\, etc.)
// On Linux/Mac: returns ["/"]
export async function GET() {
  try {
    const platform = os.platform();
    let roots: { path: string; label: string }[] = [];

    if (platform === "win32") {
      // Probe A-Z drive letters
      const driveLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
      for (const letter of driveLetters) {
        const drivePath = `${letter}:\\`;
        try {
          fs.accessSync(drivePath, fs.constants.R_OK);
          roots.push({ path: drivePath, label: `${letter}:` });
        } catch {
          // Drive not available, skip
        }
      }
    } else {
      // Unix-like: start from filesystem root
      roots = [{ path: "/", label: "/" }];
      // Also include home directory as a convenience shortcut
      const home = os.homedir();
      if (home && home !== "/") {
        roots.push({ path: home, label: `Home (${home})` });
      }
    }

    return NextResponse.json({ roots });
  } catch (err) {
    console.error("[/api/fs/roots] Error:", err);
    return NextResponse.json({ error: "Failed to list roots" }, { status: 500 });
  }
}
