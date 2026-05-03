import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";

// ─── SSE CLIENT REGISTRY ──────────────────────────────────────────────────────
export interface SSEClient {
  id:         string;
  controller: ReadableStreamDefaultController;
}

export const sseClients = new Set<SSEClient>();

// ─── BROADCAST ────────────────────────────────────────────────────────────────
export function broadcast(payload: Record<string, unknown>): void {
  const message = `data: ${JSON.stringify(payload)}\n\n`;
  const encoded = new TextEncoder().encode(message);
  for (const client of sseClients) {
    try {
      client.controller.enqueue(encoded);
    } catch {
      sseClients.delete(client);
    }
  }
}

// ─── READ ACTIVE SESSION ──────────────────────────────────────────────────────
// Reads the same active_session.json that /api/admin/session manages.
// Returns null if no session is active.
function readActiveSession(): Record<string, unknown> | null {
  try {
    const sessionFile = path.join(process.cwd(), "active_session.json");
    if (!fs.existsSync(sessionFile)) return null;
    return JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
  } catch {
    return null;
  }
}

// ─── SSE ROUTE HANDLER ────────────────────────────────────────────────────────
// GET /api/events
// On connect: sends a "connected" handshake that INCLUDES the current active
// session (if any). This means late-joining clients immediately know which
// dataset is loaded without needing a separate REST poll that could race.
export async function GET(req: NextRequest) {
  const clientId = crypto.randomUUID();

  const stream = new ReadableStream({
    start(controller) {
      const client: SSEClient = { id: clientId, controller };
      sseClients.add(client);

      // Read current session at connect time so late-joiners get it immediately
      const activeSession = readActiveSession();

      // Send handshake — includes session so client can load dataset right away
      const handshake = `data: ${JSON.stringify({
        type:          "connected",
        clientId,
        activeClients: sseClients.size,
        session:       activeSession,   // null if nothing loaded, object if dataset active
      })}\n\n`;
      controller.enqueue(new TextEncoder().encode(handshake));

      // Notify all OTHER clients of updated count
      broadcast({ type: "client_count", count: sseClients.size });

      // Heartbeat every 25s — keeps connection alive through proxies
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 25_000);

      // Cleanup on disconnect
      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        sseClients.delete(client);
        broadcast({ type: "client_count", count: sseClients.size });
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":                "text/event-stream",
      "Cache-Control":               "no-cache, no-transform",
      "Connection":                  "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "X-Accel-Buffering":           "no",
    },
  });
}
