"use client";

import React, {
  useState, useEffect, useMemo, useRef, useCallback,
} from "react";
import {
  Download, ChevronLeft, ChevronRight, Trash2, CheckSquare, Square,
  AlertCircle, FileSpreadsheet, Menu, X, Loader2, RotateCcw,
  Image as ImageIcon, Hourglass, Search, ZoomIn, Keyboard,
} from "lucide-react";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const IMAGE_BATCH_SIZE = 1000;
const IMG_CONCURRENCY  = 6;
const GT_DEBOUNCE_MS   = 800;
const CORR_DEBOUNCE_MS = 800;

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const buildImageUrl = (folder, imgPath) =>
  `/api/image?${new URLSearchParams({ folder, path: imgPath })}`;

const probeImage = (url) =>
  new Promise((resolve) => {
    const img = new window.Image();
    img.onload  = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });

const runWithConcurrency = async (tasks, limit) => {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (i < tasks.length) { const idx = i++; await tasks[idx](); }
  });
  await Promise.all(workers);
};

// ─── TOAST SYSTEM ─────────────────────────────────────────────────────────────
let toastId = 0;
const toastListeners = new Set();
const toastQueue = [];

function fireToast(msg, type = "success", duration = 2500) {
  const id = ++toastId;
  const toast = { id, msg, type };
  toastQueue.push(toast);
  toastListeners.forEach((fn) => fn([...toastQueue]));
  if (duration > 0) setTimeout(() => dismissToast(id), duration);
  return id;
}
function dismissToast(id) {
  const idx = toastQueue.findIndex((t) => t.id === id);
  if (idx > -1) {
    toastQueue.splice(idx, 1);
    toastListeners.forEach((fn) => fn([...toastQueue]));
  }
}

function ToastContainer() {
  const [toasts, setToasts] = useState([]);
  useEffect(() => {
    toastListeners.add(setToasts);
    return () => toastListeners.delete(setToasts);
  }, []);
  const colors = {
    success: "bg-green-600 text-white",
    error:   "bg-red-600 text-white",
    info:    "bg-blue-600 text-white",
    saving:  "bg-slate-700 text-white",
  };
  return (
    <div className="fixed bottom-5 right-5 z-[200] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className={`flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium pointer-events-auto ${colors[t.type] || colors.info}`}>
          {t.type === "saving" && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
          {t.type === "error"  && <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
          <span>{t.msg}</span>
          <button onClick={() => dismissToast(t.id)} className="ml-1 opacity-70 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
        </div>
      ))}
    </div>
  );
}

// ─── IMAGE ZOOM MODAL ─────────────────────────────────────────────────────────
function ZoomModal({ item, folder, gt, correction, onClose }) {
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0">
          <p className="text-sm font-bold text-slate-700 truncate">{item.originalPath.split(/[\\/]/).pop()}</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-auto p-6 flex items-center justify-center bg-slate-50 min-h-0">
          <img src={buildImageUrl(folder, item.originalPath)} alt={item.originalPath} className="max-w-full max-h-full object-contain drop-shadow-lg" />
        </div>
        <div className="px-5 py-3 border-t border-slate-200 grid grid-cols-3 gap-3 shrink-0">
          {[
            { label: "GT",         value: gt,         color: "text-green-800 bg-green-50" },
            { label: "Prediction", value: item.pred,  color: "text-red-800 bg-red-50" },
            { label: "Correction", value: correction, color: "text-violet-800 bg-violet-50" },
          ].map(({ label, value, color }) => (
            <div key={label} className={`rounded-lg px-3 py-2 ${color}`}>
              <p className="text-[10px] font-bold uppercase opacity-60 mb-0.5">{label}</p>
              <p className="text-xs font-medium break-all">{value || "—"}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── USER NAME MODAL ──────────────────────────────────────────────────────────
function NameModal({ onSave }) {
  const [name, setName] = useState("");
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const submit = () => { const t = name.trim(); if (t) onSave(t); };
  return (
    <div className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Welcome to OCR Validator</h2>
          <p className="text-sm text-slate-500 mt-1">Enter your name so your edits can be attributed in the audit log.</p>
        </div>
        <input ref={ref} type="text" value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="Your name…"
          className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
        <button onClick={submit} disabled={!name.trim()}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold rounded-xl transition-colors text-sm">
          Start Annotating
        </button>
      </div>
    </div>
  );
}

// ─── EXPORT FILTER MODAL ──────────────────────────────────────────────────────
const EXPORT_FILTERS = [
  { id: "all",         label: "All flagged items",           desc: "Export everything in the flag list" },
  { id: "corrected",   label: "Flagged + has correction",    desc: "Only flagged items where a correction was typed" },
  { id: "gt_edited",   label: "Flagged + GT was edited",     desc: "Only flagged items where GT differs from original" },
  { id: "uncorrected", label: "Flagged + no correction yet", desc: "Items still needing a correction" },
];

function ExportFilterModal({ exportList, corrections, dataset, gtState, onExport, onClose }) {
  const [filter, setFilter] = useState("all");
  const counts = useMemo(() => {
    const keys = Object.keys(exportList);
    const dm   = Object.fromEntries(dataset.map((d) => [d.id, d]));
    return {
      all:         keys.length,
      corrected:   keys.filter((k) => corrections[k]?.trim()).length,
      gt_edited:   keys.filter((k) => (gtState[k] ?? dm[k]?.gt ?? "") !== (dm[k]?.gt ?? "")).length,
      uncorrected: keys.filter((k) => !corrections[k]?.trim()).length,
    };
  }, [exportList, corrections, dataset, gtState]);

  const handleExport = () => {
    let f = { ...exportList };
    const dm = Object.fromEntries(dataset.map((d) => [d.id, d]));
    if      (filter === "corrected")   f = Object.fromEntries(Object.entries(f).filter(([k]) => corrections[k]?.trim()));
    else if (filter === "gt_edited")   f = Object.fromEntries(Object.entries(f).filter(([k]) => (gtState[k] ?? dm[k]?.gt ?? "") !== (dm[k]?.gt ?? "")));
    else if (filter === "uncorrected") f = Object.fromEntries(Object.entries(f).filter(([k]) => !corrections[k]?.trim()));
    onExport(f);
  };

  return (
    <div className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-800">Export Options</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-2">
          {EXPORT_FILTERS.map(({ id, label, desc }) => (
            <label key={id} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${filter === id ? "border-blue-400 bg-blue-50" : "border-slate-200 hover:bg-slate-50"}`}>
              <input type="radio" name="ef" value={id} checked={filter === id} onChange={() => setFilter(id)} className="mt-0.5 accent-blue-600" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800">{label}</p>
                <p className="text-[11px] text-slate-500">{desc}</p>
              </div>
              <span className="shrink-0 text-xs font-bold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-lg">{counts[id]}</span>
            </label>
          ))}
        </div>
        <button onClick={handleExport} disabled={counts[filter] === 0}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold rounded-xl transition-colors text-sm flex items-center justify-center gap-2">
          <Download className="w-4 h-4" />
          Export {counts[filter]} item{counts[filter] !== 1 ? "s" : ""}
        </button>
      </div>
    </div>
  );
}

// ─── WAITING SCREEN ───────────────────────────────────────────────────────────
function WaitingScreen() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="relative">
        <div className="w-20 h-20 rounded-full bg-blue-50 border-2 border-blue-100 flex items-center justify-center">
          <Hourglass className="w-9 h-9 text-blue-400" />
        </div>
        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-400 border-2 border-white animate-pulse" />
      </div>
      <div>
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Waiting for Admin</h2>
        <p className="text-slate-500 text-sm leading-relaxed max-w-xs">
          The host has not loaded a dataset yet. This screen will update automatically when one is selected.
        </p>
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        Connected · waiting for dataset
      </div>
    </div>
  );
}

// ─── KEYBOARD SHORTCUTS OVERLAY ───────────────────────────────────────────────
function ShortcutsOverlay({ onClose }) {
  return (
    <div className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-slate-500" /> Keyboard Shortcuts
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-2 text-sm">
          {[
            ["← / →",  "Previous / Next page"],
            ["J / K",   "Previous / Next page"],
            ["Ctrl+Z",  "Undo last edit"],
            ["Esc",     "Close modal"],
            ["?",       "Show this help"],
          ].map(([key, desc]) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <code className="px-2 py-0.5 bg-slate-100 border border-slate-300 rounded-md text-xs font-mono text-slate-700">{key}</code>
              <span className="text-slate-600 text-right">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── MAIN USER PANEL ──────────────────────────────────────────────────────────
export default function UserPanel() {

  // Session / Dataset
  const [session,          setSession]          = useState(undefined);
  const [dataset,          setDataset]          = useState([]);
  const [datasetFolder,    setDatasetFolder]    = useState(null);
  const [originalFileName, setOriginalFileName] = useState("");
  const [isLoadingDataset, setIsLoadingDataset] = useState(false);

  // Image Loading
  const [loadedUpTo,     setLoadedUpTo]     = useState(0);
  const [isBatchLoading, setIsBatchLoading] = useState(false);
  const [batchProgress,  setBatchProgress]  = useState({ done: 0, total: 0 });
  const [imageStatus,    setImageStatus]    = useState({});

  // Shared Annotation State
  const [gtState,     setGtState]     = useState({});
  const [corrections, setCorrections] = useState({});
  const [exportList,  setExportList]  = useState({});

  // Local-only
  const [activelyEditingId, setActivelyEditingId] = useState(null);
  const [localGtEdits,      setLocalGtEdits]      = useState({});
  const [undoStack,         setUndoStack]          = useState([]);
  const pendingGtSave    = useRef({});
  const pendingCorrSave  = useRef({});
  const gtSaveTimer      = useRef(null);
  const corrSaveTimer    = useRef(null);
  const currentSession   = useRef(null);
  const paginatedDataRef = useRef([]);

  // User Identity
  const [userName, setUserName] = useState(null);

  // UI State
  const [viewMode,        setViewMode]        = useState("Word Level");
  const [groupByFolder,   setGroupByFolder]   = useState(false);
  const [autoFill,        setAutoFill]        = useState(false); // false | "pred" | "gt"
  const [currentPage,     setCurrentPage]     = useState(0);
  const [isSidebarOpen,   setIsSidebarOpen]   = useState(true);
  const [connectedUsers,  setConnectedUsers]  = useState(0);
  const [searchQuery,     setSearchQuery]     = useState("");
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);
  const [zoomItem,        setZoomItem]        = useState(null);
  const [showShortcuts,   setShowShortcuts]   = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [reconnectBanner, setReconnectBanner] = useState(false);
  const [isExporting,         setIsExporting]         = useState(false);
  const [isImporting,         setIsImporting]         = useState(false);
  const [showExportDropdown,  setShowExportDropdown]  = useState(false);
  const exportDropdownRef = useRef(null);

  // Position persistence
  const savePosition = (fp, page, mode, grouped) => {
    try { localStorage.setItem(`ocr_pos_${fp}`, JSON.stringify({ page, mode, grouped })); } catch {}
  };
  const loadPosition = (fp) => {
    try { const r = localStorage.getItem(`ocr_pos_${fp}`); return r ? JSON.parse(r) : null; } catch { return null; }
  };

  // Load user identity
  useEffect(() => {
    try {
      const saved = localStorage.getItem("ocr_user_name");
      if (saved) setUserName(saved);
      else       setUserName("");
    } catch { setUserName("Anonymous"); }
  }, []);

  // Responsive sidebar
  useEffect(() => {
    const h = () => setIsSidebarOpen(window.innerWidth >= 1024);
    h(); window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  // Load SheetJS
  useEffect(() => {
    if (!document.getElementById("xlsx-script")) {
      const s = document.createElement("script");
      s.id = "xlsx-script"; s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"; s.async = true;
      document.head.appendChild(s);
    }
  }, []);

  // Close export dropdown on outside click
  useEffect(() => {
    const h = (e) => {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(e.target))
        setShowExportDropdown(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // ─── DATASET LOADER ───────────────────────────────────────────────────────
  const loadDatasetFromSession = useCallback(async (sess, isReconnect = false) => {
    if (!sess) return;
    if (!isReconnect) setIsLoadingDataset(true);
    try {
      const res  = await fetch(`/api/dataset?file=${encodeURIComponent(sess.filePath)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load dataset");
      const { content, fileName, folderPath } = data;
      setDatasetFolder(folderPath);
      setOriginalFileName(fileName);

      if (!isReconnect) {
        setDataset([]); setGtState({}); setCorrections({}); setExportList({});
        setLocalGtEdits({}); setImageStatus({}); setLoadedUpTo(0);
        pendingGtSave.current = {}; pendingCorrSave.current = {};
        setUndoStack([]);
        const saved = loadPosition(sess.filePath);
        if (saved) { setCurrentPage(saved.page ?? 0); setViewMode(saved.mode ?? "Word Level"); setGroupByFolder(saved.grouped ?? false); }
        else        { setCurrentPage(0); }
      }

      const getFolderId = (p) => {
        if (p.includes("/") || p.includes("\\")) {
          const pts = p.replace(/\\/g, "/").split("/");
          return pts.length > 1 ? pts[pts.length - 2] : "Root";
        }
        return "Root";
      };

      const parsedData = [];
      if (fileName.toLowerCase().endsWith(".json")) {
        const parsed = JSON.parse(content);
        let rawData = [];
        if (Array.isArray(parsed)) { rawData = parsed; }
        else if (parsed && typeof parsed === "object") {
          const keys   = ["data","annotations","items","records","images","dataset","results"];
          const found  = keys.find((k) => Array.isArray(parsed[k]));
          rawData = found ? parsed[found]
            : (Object.keys(parsed).find((k) => Array.isArray(parsed[k]))
                ? parsed[Object.keys(parsed).find((k) => Array.isArray(parsed[k]))]
                : [parsed]);
        }
        rawData.forEach((item) => {
          if (!item || typeof item !== "object") return;
          const rawPath = item.image_path || item.image || item.filename || item.file || item.Path || item.Image;
          const imgPath = rawPath?.toString().trim();
          const gt      = (item.gt || item.ground_truth || item.label || item.text || item.GT || "").toString().trim();
          const pred    = (item.pred || item.prediction || item.predicted || item.Pred || "").toString().trim();
          if (imgPath) parsedData.push({ originalPath: imgPath, gt, pred, folderId: getFolderId(imgPath), id: imgPath });
        });
      } else {
        const isCsv = fileName.toLowerCase().endsWith(".csv");
        const delim = isCsv ? "," : "\t";
        const parseRow = (str, d) => {
          const arr = []; let quote = false, col = "", c;
          for (let i = 0; i < str.length; i++) {
            c = str[i];
            if (!quote && c === '"')           { quote = true; continue; }
            if (c === '"' && str[i+1] === '"') { col += '"'; i++; continue; }
            if (quote && c === '"')            { quote = false; continue; }
            if (!quote && c === d)             { arr.push(col); col = ""; continue; }
            col += c;
          }
          arr.push(col); return arr;
        };
        let firstRow = true;
        for (const line of content.split(/\r?\n/)) {
          if (!line.trim()) continue;
          const parts = parseRow(line, delim);
          if (firstRow) {
            firstRow = false;
            const fc = parts[0]?.trim() || "";
            if (fc && !fc.includes("/") && !fc.includes("\\") && !/\.(png|jpg|jpeg|gif|bmp|webp|tiff?|txt|json|tsv|csv)$/i.test(fc)) continue;
          }
          const imgPath = parts[0]?.trim();
          if (imgPath) parsedData.push({ originalPath: imgPath, gt: parts[1]?.trim() || "", pred: parts[2]?.trim() || "", folderId: getFolderId(imgPath), id: imgPath });
        }
      }

      if (!isReconnect) setDataset(parsedData);

      try {
        const [gR, cR] = await Promise.all([
          fetch(`/api/gt?folder=${encodeURIComponent(folderPath)}`),
          fetch(`/api/corrections?folder=${encodeURIComponent(folderPath)}`),
        ]);
        if (gR.ok) { const d = await gR.json(); setGtState(d.state || {}); }
        if (cR.ok) { const d = await cR.json(); setCorrections(d.corrections || {}); setExportList(d.exportList || {}); }
      } catch {}

      if (!isReconnect) { const fb = parsedData.slice(0, IMAGE_BATCH_SIZE); setLoadedUpTo(fb.length); loadImageBatch(fb, folderPath); }
      if (isReconnect)  { setReconnectBanner(false); fireToast("Reconnected — state synced", "success"); }
    } catch (err) {
      console.error("Dataset load error:", err);
      if (isReconnect) fireToast("Reconnect sync failed", "error", 0);
    } finally {
      if (!isReconnect) setIsLoadingDataset(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── IMAGE BATCH LOADER ───────────────────────────────────────────────────
  const loadImageBatch = useCallback(async (items, folder) => {
    if (!items.length || !folder) return;
    setIsBatchLoading(true); setBatchProgress({ done: 0, total: items.length });
    let done = 0;
    const tasks = items.map((item) => async () => {
      const ok = await probeImage(buildImageUrl(folder, item.originalPath));
      setBatchProgress({ done: ++done, total: items.length });
      setImageStatus((prev) => ({ ...prev, [item.id]: ok ? "ok" : "error" }));
    });
    await runWithConcurrency(tasks, IMG_CONCURRENCY);
    setIsBatchLoading(false);
  }, []);

  const retryFailedImages = useCallback(() => {
    if (!datasetFolder) return;
    const failed = dataset.filter((i) => imageStatus[i.id] === "error");
    if (!failed.length) return;
    fireToast(`Retrying ${failed.length} failed image${failed.length !== 1 ? "s" : ""}…`, "info");
    setImageStatus((prev) => { const n = { ...prev }; failed.forEach((i) => delete n[i.id]); return n; });
    loadImageBatch(failed, datasetFolder);
  }, [dataset, datasetFolder, imageStatus, loadImageBatch]);

  useEffect(() => {
    if (!datasetFolder || isBatchLoading || !dataset.length) return;
    const ps  = viewMode === "Word Level" ? 30 : 10;
    const lv  = Math.min((currentPage + 1) * ps, dataset.length) - 1;
    if (lv >= loadedUpTo - ps * 2 && loadedUpTo < dataset.length) {
      const next = dataset.slice(loadedUpTo, loadedUpTo + IMAGE_BATCH_SIZE);
      setLoadedUpTo((p) => p + next.length);
      loadImageBatch(next, datasetFolder);
    }
  }, [currentPage, loadedUpTo, dataset, datasetFolder, isBatchLoading, viewMode, loadImageBatch]);

  useEffect(() => {
    if (currentSession.current?.filePath)
      savePosition(currentSession.current.filePath, currentPage, viewMode, groupByFolder);
  }, [currentPage, viewMode, groupByFolder]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── SSE CONNECTION ───────────────────────────────────────────────────────
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onmessage = (e) => {
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      switch (msg.type) {
        case "connected":
          setConnectedUsers(msg.activeClients);
          if (msg.session) {
            const isReconnect = !!currentSession.current;
            setSession(msg.session); currentSession.current = msg.session;
            if (isReconnect) { setReconnectBanner(true); loadDatasetFromSession(msg.session, true); }
            else              { loadDatasetFromSession(msg.session, false); }
          } else { setSession(null); currentSession.current = null; }
          break;
        case "client_count":  setConnectedUsers(msg.count); break;
        case "dataset_loaded":
          setSession(msg.session); currentSession.current = msg.session;
          loadDatasetFromSession(msg.session, false); break;
        case "dataset_unloaded":
          setSession(null); currentSession.current = null;
          setDataset([]); setDatasetFolder(null); setGtState({}); setCorrections({}); setExportList({});
          setImageStatus({}); setLoadedUpTo(0); setCurrentPage(0); setSearchQuery(""); setShowFlaggedOnly(false);
          break;
        case "gt_update":
          setGtState((prev) => ({ ...prev, [msg.id]: msg.gt }));
          setLocalGtEdits((prev) => {
            if (prev[msg.id] === undefined || activelyEditingId === msg.id) return prev;
            const n = { ...prev }; delete n[msg.id]; return n;
          });
          break;
        case "correction_update":
          setCorrections((prev) => {
            if (activelyEditingId === msg.id) return prev;
            return { ...prev, [msg.id]: msg.correction };
          });
          break;
        case "flag_update":
          if (msg.flagged) {
            if (currentSession.current?.folderPath)
              fetch(`/api/corrections?folder=${encodeURIComponent(currentSession.current.folderPath)}`)
                .then((r) => r.json()).then((d) => setExportList(d.exportList || {})).catch(() => {});
          } else {
            setExportList((prev) => { const n = { ...prev }; delete n[msg.id]; return n; });
          }
          break;
      }
    };
    es.onerror = () => {};
    return () => es.close();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { /* keep ref in sync */ }, [activelyEditingId]);

  // ─── GT SAVE ─────────────────────────────────────────────────────────────
  const saveGtToServer = useCallback((folder, id, value) => {
    pendingGtSave.current[id] = value;
    if (gtSaveTimer.current) clearTimeout(gtSaveTimer.current);
    const tid = fireToast("Saving GT…", "saving", 0);
    gtSaveTimer.current = setTimeout(async () => {
      const batch = { ...pendingGtSave.current }; pendingGtSave.current = {};
      try {
        const res = await fetch("/api/gt", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder, updates: batch, editor: userName || "unknown" }) });
        dismissToast(tid);
        if (!res.ok) throw new Error();
        setGtState((prev) => ({ ...prev, ...batch }));
        fireToast("GT saved ✓", "success");
      } catch { dismissToast(tid); fireToast("GT save failed", "error", 0); }
    }, GT_DEBOUNCE_MS);
  }, [userName]);

  const resolveGt = useCallback((item) => {
    if (localGtEdits[item.id] !== undefined) return localGtEdits[item.id];
    if (gtState[item.id]      !== undefined) return gtState[item.id];
    return item.gt;
  }, [localGtEdits, gtState]);

  const updateGt = useCallback((item, value) => {
    const prev = localGtEdits[item.id] ?? gtState[item.id] ?? item.gt;
    setLocalGtEdits((p) => ({ ...p, [item.id]: value }));
    setUndoStack((s) => [...s.slice(-49), { id: item.id, field: "gt", prev }]);
    saveGtToServer(datasetFolder, item.id, value);
  }, [localGtEdits, gtState, datasetFolder, saveGtToServer]);

  // ─── CORRECTION SAVE ──────────────────────────────────────────────────────
  const saveCorrToServer = useCallback((folder, id, value) => {
    pendingCorrSave.current[id] = value;
    if (corrSaveTimer.current) clearTimeout(corrSaveTimer.current);
    corrSaveTimer.current = setTimeout(async () => {
      const batch = { ...pendingCorrSave.current }; pendingCorrSave.current = {};
      try {
        const res = await fetch("/api/corrections", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder, corrections: batch, editor: userName || "unknown" }) });
        if (!res.ok) throw new Error();
      } catch { fireToast("Correction save failed", "error", 0); }
    }, CORR_DEBOUNCE_MS);
  }, [userName]);

  const updateCorrection = useCallback((id, val) => {
    setCorrections((prev) => ({ ...prev, [id]: val }));
    setUndoStack((s) => [...s.slice(-49), { id, field: "correction", prev: corrections[id] ?? "" }]);
    if (datasetFolder) saveCorrToServer(datasetFolder, id, val);
  }, [corrections, datasetFolder, saveCorrToServer]);

  // ─── UNDO ─────────────────────────────────────────────────────────────────
  const handleUndo = useCallback(() => {
    if (!undoStack.length) return;
    const last = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    if (last.field === "gt") {
      setLocalGtEdits((p) => ({ ...p, [last.id]: last.prev }));
      if (datasetFolder)
        fetch("/api/gt", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder: datasetFolder, updates: { [last.id]: last.prev }, editor: userName || "unknown" }) })
          .then(() => setGtState((p) => ({ ...p, [last.id]: last.prev })))
          .catch(() => fireToast("Undo failed", "error", 0));
    } else if (last.field === "correction") {
      setCorrections((p) => ({ ...p, [last.id]: last.prev }));
      if (datasetFolder) saveCorrToServer(datasetFolder, last.id, last.prev);
    }
    fireToast("Undone ✓", "info");
  }, [undoStack, datasetFolder, userName, saveCorrToServer]);

  // ─── FLAG TOGGLE ──────────────────────────────────────────────────────────
  const toggleFlag = useCallback(async (item) => {
    const isFlagged = !!exportList[item.id];
    if (isFlagged) {
      setExportList((prev) => { const n = { ...prev }; delete n[item.id]; return n; });
      if (datasetFolder)
        await fetch("/api/corrections", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder: datasetFolder, removeFlagId: item.id, editor: userName || "unknown" }) })
          .catch(() => fireToast("Unflag failed", "error", 0));
    } else {
      const entry = { Image: item.originalPath.split("/").pop(), GT: resolveGt(item), Pred: item.pred, Path: item.originalPath, OriginalFile: originalFileName };
      setExportList((prev) => ({ ...prev, [item.id]: entry }));
      if (datasetFolder)
        await fetch("/api/corrections", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder: datasetFolder, exportList: { [item.id]: entry }, editor: userName || "unknown" }) })
          .catch(() => fireToast("Flag save failed", "error", 0));
    }
  }, [exportList, datasetFolder, userName, originalFileName, resolveGt]);

  // ─── AUTO-FILL ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!autoFill || !paginatedDataRef.current.length) return;
    const updates = {};
    paginatedDataRef.current.forEach((item) => {
      if (corrections[item.id] !== undefined && corrections[item.id] !== "") return;
      const value = autoFill === "gt" ? resolveGt(item) : item.pred;
      if (value) updates[item.id] = value;
    });
    if (!Object.keys(updates).length) return;
    setCorrections((prev) => ({ ...prev, ...updates }));
    if (datasetFolder)
      fetch("/api/corrections", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: datasetFolder, corrections: updates, editor: userName || "unknown" }) })
        .catch(console.error);
  }, [autoFill]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── CLEAR DATA ───────────────────────────────────────────────────────────
  const handleClearData = useCallback(() => {
    if (!window.confirm("Clear all corrections and flags? This resets server state too.")) return;
    setCorrections({}); setExportList({}); setGtState({}); setLocalGtEdits({}); setUndoStack([]);
    if (datasetFolder)
      Promise.all([
        fetch("/api/gt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folder: datasetFolder, updates: {}, editor: userName || "unknown" }) }),
        fetch("/api/corrections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folder: datasetFolder, corrections: {}, exportList: {}, editor: userName || "unknown" }) }),
      ]).catch(console.error);
    fireToast("Storage cleared", "info");
  }, [datasetFolder, userName]);

  // ─── KEYBOARD ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const h = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") {
        if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); handleUndo(); }
        return;
      }
      if      (e.key === "ArrowLeft"  || e.key === "j" || e.key === "J") setCurrentPage((p) => Math.max(0, p - 1));
      else if (e.key === "ArrowRight" || e.key === "k" || e.key === "K") setCurrentPage((p) => p + 1);
      else if (e.key === "?" || e.key === "/") setShowShortcuts((v) => !v);
      else if (e.key === "Escape") setZoomItem(null);
      else if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); handleUndo(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [handleUndo]);

  // ─── PAGINATION ───────────────────────────────────────────────────────────
  const uniqueFolders = useMemo(() => [...new Set(dataset.map((i) => i.folderId))].sort(), [dataset]);

  const filteredDataset = useMemo(() => {
    let d = dataset;
    if (showFlaggedOnly) d = d.filter((i) => !!exportList[i.id]);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      d = d.filter((i) =>
        i.originalPath.toLowerCase().includes(q) ||
        (resolveGt(i) || "").toLowerCase().includes(q) ||
        (i.pred || "").toLowerCase().includes(q) ||
        (corrections[i.id] || "").toLowerCase().includes(q)
      );
    }
    return d;
  }, [dataset, showFlaggedOnly, searchQuery, exportList, corrections, gtState, localGtEdits]); // eslint-disable-line react-hooks/exhaustive-deps

  const { paginatedData, totalPages, navTitle, navSubtext } = useMemo(() => {
    if (!filteredDataset.length) return { paginatedData: [], totalPages: 1, navTitle: "", navSubtext: "" };
    if (groupByFolder && uniqueFolders.length) {
      const folder = uniqueFolders[currentPage] || uniqueFolders[0];
      const batch  = filteredDataset.filter((i) => i.folderId === folder);
      return { paginatedData: batch, totalPages: uniqueFolders.length, navTitle: `Directory: ${folder}`, navSubtext: `${batch.length} items · ${filteredDataset.length} shown` };
    }
    const ps     = viewMode === "Word Level" ? 30 : 10;
    const tPages = Math.max(1, Math.ceil(filteredDataset.length / ps));
    const safe   = Math.min(currentPage, tPages - 1);
    const start  = safe * ps;
    const batch  = filteredDataset.slice(start, start + ps);
    const title  = searchQuery || showFlaggedOnly ? `Results ${safe + 1}/${tPages}` : `Segment ${safe + 1} of ${tPages}`;
    const sub    = `Items ${start + 1}–${start + batch.length} of ${filteredDataset.length}` +
      (filteredDataset.length !== dataset.length ? ` (${dataset.length} total)` : "");
    return { paginatedData: batch, totalPages: tPages, navTitle: title, navSubtext: sub };
  }, [filteredDataset, currentPage, groupByFolder, viewMode, uniqueFolders, searchQuery, showFlaggedOnly, dataset.length]);

  paginatedDataRef.current = paginatedData;
  useEffect(() => { setCurrentPage(0); }, [searchQuery, showFlaggedOnly]);

  // ─── EXPORT ───────────────────────────────────────────────────────────────
  const doExport = useCallback(async (fel) => {
    const keys = Object.keys(fel);
    if (!keys.length) { fireToast("No items to export", "error", 3000); return; }
    if (!datasetFolder) { fireToast("No dataset loaded", "error", 3000); return; }
    setIsExporting(true); setShowExportModal(false);
    const tid = fireToast("Exporting…", "saving", 0);
    try {
      const res = await fetch("/api/export", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: datasetFolder, exportList: fel, corrections, fileName: originalFileName.replace(/\.[^.]+$/, "") || "flagged_errors" }) });
      dismissToast(tid);
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Server ${res.status}`); }
      const buf  = await res.arrayBuffer();
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement("a"), { href: url });
      const cd   = res.headers.get("Content-Disposition") || "";
      const m    = cd.match(/filename="([^"]+)"/);
      a.setAttribute("download", m ? m[1] : "flagged_errors.xlsx");
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      fireToast(`Exported ${keys.length} items ✓`, "success");
    } catch (e) { dismissToast(tid); fireToast("Export failed: " + e.message, "error", 0); }
    finally { setIsExporting(false); }
  }, [datasetFolder, corrections, originalFileName]);

  const exportToExcel = useCallback(() => {
    if (!Object.keys(exportList).length) { fireToast("No items selected", "error", 3000); return; }
    setShowExportModal(true);
  }, [exportList]);

  // Export CSV: path,corrected — no headers
  const exportCsv = useCallback(() => {
    const keys = Object.keys(exportList);
    if (!keys.length) { fireToast("No items selected", "error", 3000); return; }
    const rows = keys.map((id) => {
      const raw  = id.replace(/"/g, '""');
      const corr = (corrections[id] ?? "").replace(/"/g, '""');
      const qPath = raw.includes(",")  || raw.includes('"')  || raw.includes("\n")  ? `"${raw}"`  : raw;
      const qCorr = corr.includes(",") || corr.includes('"') || corr.includes("\n") ? `"${corr}"` : corr;
      return `${qPath},${qCorr}`;
    });
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement("a"), { href: url });
    a.setAttribute("download", `${originalFileName.replace(/\.[^.]+$/, "") || "flagged_errors"}_corrections.csv`);
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    fireToast(`Exported ${keys.length} rows as CSV ✓`, "success");
  }, [exportList, corrections, originalFileName]);

  const handleExcelImport = useCallback(async (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (!window.XLSX) { fireToast("Import library still loading…", "info"); return; }
    setIsImporting(true);
    try {
      const buf  = await file.arrayBuffer();
      const wb   = window.XLSX.read(buf, { type: "array" });
      const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      let n = 0; const nE = { ...exportList }, nC = { ...corrections };
      rows.forEach((row) => {
        const p = row["Image Path"]; if (!p) return;
        nE[p] = { Image: row["Image Name"] || p.split("/").pop(), GT: row["GT"] || "", Pred: row["Pred"] || "", Path: p, OriginalFile: row["Source File"] || "" };
        if (row["Corrected"]) nC[p] = row["Corrected"];
        n++;
      });
      setExportList(nE); setCorrections(nC);
      if (datasetFolder)
        await fetch("/api/corrections", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder: datasetFolder, corrections: nC, exportList: nE, editor: userName || "unknown" }) });
      fireToast(`Restored ${n} records ✓`, "success");
    } catch { fireToast("Failed to read Excel file", "error", 0); }
    finally { setIsImporting(false); e.target.value = null; }
  }, [exportList, corrections, datasetFolder, userName]);

  // ─── DERIVED ──────────────────────────────────────────────────────────────
  const colsClass    = viewMode === "Word Level" ? "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5" : "grid-cols-1 md:grid-cols-2";
  const imgBoxHeight = viewMode === "Word Level" ? "h-24" : "h-32";
  const batchPct     = batchProgress.total > 0 ? Math.round((batchProgress.done / batchProgress.total) * 100) : 0;
  const datasetLoaded = session !== undefined && session !== null && dataset.length > 0;
  const failedCount   = Object.values(imageStatus).filter((s) => s === "error").length;

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-slate-50 text-slate-800 font-sans overflow-hidden">

      {userName === "" && (
        <NameModal onSave={(n) => { setUserName(n); try { localStorage.setItem("ocr_user_name", n); } catch {} }} />
      )}
      {zoomItem && (
        <ZoomModal item={zoomItem} folder={datasetFolder} gt={resolveGt(zoomItem)} correction={corrections[zoomItem.id] ?? ""} onClose={() => setZoomItem(null)} />
      )}
      {showShortcuts && <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />}
      {showExportModal && (
        <ExportFilterModal exportList={exportList} corrections={corrections} dataset={dataset} gtState={gtState} onExport={doExport} onClose={() => setShowExportModal(false)} />
      )}
      <ToastContainer />

      {reconnectBanner && (
        <div className="fixed top-0 inset-x-0 z-50 bg-amber-500 text-white text-xs font-semibold py-1.5 text-center flex items-center justify-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" /> Reconnected — syncing state…
        </div>
      )}

      {isSidebarOpen && (
        <div className="fixed inset-0 bg-slate-900/50 z-40 lg:hidden backdrop-blur-sm" onClick={() => setIsSidebarOpen(false)} />
      )}

      {/* ── SIDEBAR ──────────────────────────────────────────────────────── */}
      <div className={`fixed lg:static inset-y-0 left-0 bg-white border-slate-200 shadow-xl lg:shadow-sm flex flex-col z-50 shrink-0 transition-all duration-300 ease-in-out overflow-hidden ${isSidebarOpen ? "w-72 border-r" : "w-0 border-r-0"}`}>
        <div className="w-72 h-full flex flex-col overflow-hidden">

          <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex justify-between items-start shrink-0">
            <div>
              <h1 className="text-lg font-bold text-slate-800">OCR Validator</h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                <span className="text-[10px] font-medium text-slate-500">{connectedUsers} user{connectedUsers !== 1 ? "s" : ""} connected</span>
              </div>
              {userName && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className="text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full">{userName}</span>
                  <button onClick={() => { setUserName(""); try { localStorage.removeItem("ocr_user_name"); } catch {} }} className="text-[10px] text-slate-400 hover:text-slate-600">change</button>
                </div>
              )}
            </div>
            <button onClick={() => setIsSidebarOpen(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-md transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">

            {/* Dataset info */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Dataset</p>
              {session ? (
                <div className="px-3 py-2.5 bg-green-50 border border-green-200 rounded-xl">
                  <p className="text-xs font-bold text-green-800 truncate">{session.fileName}</p>
                  <p className="text-[10px] text-green-600 mt-0.5">{dataset.length} items loaded</p>
                </div>
              ) : session === null ? (
                <div className="px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
                  <p className="text-xs font-semibold text-amber-700">Waiting for Admin…</p>
                </div>
              ) : (
                <div className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin text-slate-400" />
                  <p className="text-xs text-slate-500">Connecting…</p>
                </div>
              )}
            </div>

            {/* Search */}
            {datasetLoaded && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Search</p>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Image name, GT, pred…"
                    className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <label className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors">
                  <input type="checkbox" checked={showFlaggedOnly} onChange={(e) => setShowFlaggedOnly(e.target.checked)} className="w-3.5 h-3.5 accent-blue-600" />
                  <span className="text-xs font-medium text-slate-700">Flagged only</span>
                  <span className="ml-auto text-[10px] font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">{Object.keys(exportList).length}</span>
                </label>
              </div>
            )}

            {/* Image progress */}
            {datasetLoaded && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Images</span>
                  <span className="text-[10px] text-slate-500">{Math.min(loadedUpTo, dataset.length)} / {dataset.length}</span>
                </div>
                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${dataset.length ? (loadedUpTo / dataset.length) * 100 : 0}%` }} />
                </div>
                {isBatchLoading && (
                  <p className="text-[10px] text-blue-500 flex items-center gap-1">
                    <Loader2 className="w-2.5 h-2.5 animate-spin" /> Loading batch… {batchPct}%
                  </p>
                )}
                {failedCount > 0 && !isBatchLoading && (
                  <button onClick={retryFailedImages} className="text-[10px] text-red-600 flex items-center gap-1 hover:text-red-800 transition-colors">
                    <RotateCcw className="w-2.5 h-2.5" /> {failedCount} failed — Retry All
                  </button>
                )}
              </div>
            )}

            {/* Display config */}
            {datasetLoaded && (
              <div className="space-y-3">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Display</p>

                <div className="bg-slate-50 p-1 rounded-lg flex border border-slate-200">
                  {["Word Level", "Line Level"].map((mode) => (
                    <button key={mode} onClick={() => setViewMode(mode)}
                      className={`flex-1 text-xs py-2 px-2 rounded-md font-medium transition-colors ${viewMode === mode ? "bg-white shadow-sm text-blue-600 border border-slate-200" : "text-slate-500 hover:text-slate-700"}`}>
                      {mode}
                    </button>
                  ))}
                </div>

                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">Auto-fill Corrected</p>
                  {[
                    { value: "pred", label: "Copy Prediction → Corrected" },
                    { value: "gt",   label: "Copy GT → Corrected" },
                  ].map(({ value, label }) => (
                    <label key={value} className="flex items-center gap-3 p-3 border border-slate-200 rounded-xl hover:bg-slate-50 cursor-pointer transition-colors">
                      <input type="checkbox" checked={autoFill === value}
                        onChange={(e) => setAutoFill(e.target.checked ? value : false)}
                        className="w-4 h-4 accent-blue-600" />
                      <span className="text-xs font-medium text-slate-700">{label}</span>
                    </label>
                  ))}
                </div>

                {uniqueFolders.length > 1 && (
                  <div className="space-y-2">
                    <label className="flex items-center gap-3 p-3 border border-slate-200 rounded-xl hover:bg-slate-50 cursor-pointer transition-colors">
                      <input type="checkbox" checked={groupByFolder}
                        onChange={(e) => { setGroupByFolder(e.target.checked); setCurrentPage(0); }}
                        className="w-4 h-4 accent-blue-600" />
                      <span className="text-xs font-medium text-slate-700">Group by Directory</span>
                    </label>
                    {groupByFolder && (
                      <select value={uniqueFolders[currentPage] || ""}
                        onChange={(e) => { const i = uniqueFolders.indexOf(e.target.value); if (i > -1) setCurrentPage(i); }}
                        className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-700">
                        {uniqueFolders.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                    )}
                  </div>
                )}
              </div>
            )}

            {datasetLoaded && <div className="w-full h-px bg-slate-100" />}

            {/* Export section */}
            {datasetLoaded && (
              <div className="space-y-3">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Export</p>
                <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold text-blue-800">Pending Exports</p>
                    <p className="text-2xl font-black text-blue-900 leading-none mt-1">{Object.keys(exportList).length}</p>
                  </div>
                  <Download className="w-7 h-7 text-blue-200" />
                </div>
                <div className="space-y-2">
                  <label className={`w-full bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 font-medium py-2 px-3 rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 ${isImporting ? "opacity-70 cursor-not-allowed" : "cursor-pointer"}`}>
                    {isImporting ? <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
                    <span className="text-xs">{isImporting ? "Reading…" : "Restore from Excel"}</span>
                    <input type="file" accept=".xlsx" onChange={handleExcelImport} className="hidden" disabled={isImporting} />
                  </label>
                  <button onClick={handleClearData} className="w-full bg-white border border-red-200 hover:bg-red-50 text-red-600 font-medium py-2 px-3 rounded-xl transition-all flex items-center justify-center gap-2">
                    <Trash2 className="w-3.5 h-3.5" />
                    <span className="text-xs">Clear Storage</span>
                  </button>
                </div>
              </div>
            )}

            <button onClick={() => setShowShortcuts(true)} className="flex items-center gap-2 text-[10px] text-slate-400 hover:text-slate-600 transition-colors mt-auto pt-2">
              <Keyboard className="w-3 h-3" /> Keyboard shortcuts
            </button>

            {undoStack.length > 0 && (
              <button onClick={handleUndo} className="flex items-center gap-2 text-[10px] text-slate-500 hover:text-slate-700 transition-colors">
                <RotateCcw className="w-3 h-3" /> Undo last edit ({undoStack.length})
              </button>
            )}

          </div>
        </div>
      </div>

      {/* ── MAIN CONTENT ──────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col h-full bg-slate-50/50 relative overflow-hidden">

        {!isSidebarOpen && (
          <button onClick={() => setIsSidebarOpen(true)} className="absolute top-4 left-4 z-40 bg-white border border-slate-200 shadow-sm p-2 rounded-lg text-slate-600 hover:text-blue-600 transition-colors">
            <Menu className="w-5 h-5" />
          </button>
        )}

        {session === undefined && (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin" />
              <span className="text-sm">Connecting to server…</span>
            </div>
          </div>
        )}

        {session === null && <WaitingScreen />}

        {session !== null && session !== undefined && isLoadingDataset && (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
              <span className="text-sm font-medium">Loading dataset…</span>
            </div>
          </div>
        )}

        {datasetLoaded && !isLoadingDataset && (
          <>
            <div className={`bg-white/80 backdrop-blur-md border-b border-slate-200 p-3 sm:p-4 flex flex-col sticky top-0 z-20 ${!isSidebarOpen ? "pl-16" : ""}`}>
              {isBatchLoading && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-100">
                  <div className="h-full bg-blue-400 transition-all duration-200" style={{ width: `${batchPct}%` }} />
                </div>
              )}
              <div className="flex items-center justify-between">
                <button onClick={() => setCurrentPage((p) => Math.max(0, p - 1))} disabled={currentPage === 0}
                  className="flex items-center gap-1 sm:gap-2 px-3 py-2 sm:px-4 rounded-lg font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition-colors">
                  <ChevronLeft className="w-5 h-5" />
                  <span className="hidden sm:inline">Previous</span>
                </button>
                <div className="text-center truncate px-2">
                  <h3 className="font-bold text-slate-800 text-sm sm:text-base truncate">{navTitle}</h3>
                  <p className="text-[10px] sm:text-xs text-slate-500 mt-0.5 truncate">{navSubtext}</p>
                </div>
                <div className="flex items-center gap-2">
                  {/* Export split-button dropdown */}
                  <div className="relative" ref={exportDropdownRef}>
                    <div className="flex rounded-lg overflow-visible border border-blue-600 shadow-sm">
                      <button
                        onClick={exportToExcel}
                        disabled={isExporting}
                        className={`flex items-center gap-2 px-3 sm:px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-medium text-sm transition-all ${isExporting ? "cursor-not-allowed" : ""}`}
                      >
                        {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        <span className="hidden sm:inline">{isExporting ? "Exporting…" : "Export"}</span>
                      </button>
                      <button
                        onClick={() => setShowExportDropdown((v) => !v)}
                        disabled={isExporting}
                        className="px-2 py-2 bg-blue-700 hover:bg-blue-800 disabled:bg-slate-200 disabled:text-slate-400 text-white border-l border-blue-500 transition-colors"
                        aria-label="More export options"
                      >
                        <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showExportDropdown ? "rotate-90" : ""}`} />
                      </button>
                    </div>
                    {showExportDropdown && (
                      <div className="absolute top-full mt-1 right-0 w-52 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden z-50">
                        <button
                          onClick={() => { setShowExportDropdown(false); exportToExcel(); }}
                          disabled={isExporting}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs hover:bg-slate-50 disabled:opacity-40 transition-colors"
                        >
                          <Download className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                          <div className="text-left">
                            <p className="font-semibold text-slate-800">Export XLSX</p>
                            <p className="text-[10px] text-slate-400">Full spreadsheet with images</p>
                          </div>
                        </button>
                        <div className="h-px bg-slate-100" />
                        <button
                          onClick={() => { setShowExportDropdown(false); exportCsv(); }}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs hover:bg-slate-50 transition-colors"
                        >
                          <Download className="w-3.5 h-3.5 text-green-600 shrink-0" />
                          <div className="text-left">
                            <p className="font-semibold text-slate-800">Export CSV</p>
                            <p className="text-[10px] text-slate-400">Path + Corrected, no headers</p>
                          </div>
                        </button>
                      </div>
                    )}
                  </div>
                  <button onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))} disabled={currentPage >= totalPages - 1}
                    className="flex items-center gap-1 sm:gap-2 px-3 py-2 sm:px-4 rounded-lg font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition-colors">
                    <span className="hidden sm:inline">Next</span>
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>

            {paginatedData.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
                <Search className="w-8 h-8 text-slate-200" />
                <p className="text-sm font-medium">No items match your filter</p>
                <button onClick={() => { setSearchQuery(""); setShowFlaggedOnly(false); }} className="text-xs text-blue-600 hover:text-blue-800">Clear filters</button>
              </div>
            )}

            {paginatedData.length > 0 && (
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8">
                <div className={`grid gap-4 sm:gap-6 ${colsClass}`}>
                  {paginatedData.map((item) => {
                    const isFlagged = !!exportList[item.id];
                    const displayGt = resolveGt(item);
                    const imgUrl    = datasetFolder ? buildImageUrl(datasetFolder, item.originalPath) : null;
                    const imgSt     = imageStatus[item.id];
                    return (
                      <div key={item.id} className={`bg-white rounded-xl sm:rounded-2xl border transition-all duration-200 overflow-hidden flex flex-col ${isFlagged ? "border-blue-400 ring-2 sm:ring-4 ring-blue-50 shadow-md" : "border-slate-200 hover:border-slate-300 hover:shadow-md"}`}>

                        <div className={`px-3 py-2 sm:px-4 sm:py-3 border-b border-slate-100 flex items-center justify-between ${isFlagged ? "bg-blue-50" : "bg-white"}`}>
                          <button onClick={() => toggleFlag(item)} className="flex items-center gap-2 group/btn focus:outline-none">
                            {isFlagged
                              ? <CheckSquare className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                              : <Square className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 group-hover/btn:text-slate-600 transition-colors" />}
                            <span className={`text-xs sm:text-sm font-semibold ${isFlagged ? "text-blue-700" : "text-slate-500 group-hover/btn:text-slate-700"}`}>
                              {isFlagged ? "Flagged" : "Select"}
                            </span>
                          </button>
                          <span className="text-[10px] font-medium text-slate-400 truncate max-w-[45%]" title={item.originalPath.split("/").pop()}>
                            {item.originalPath.split("/").pop()}
                          </span>
                        </div>

                        <button className={`w-full bg-slate-50 border-b border-slate-100 p-3 sm:p-4 flex items-center justify-center ${imgBoxHeight} group relative`}
                          onClick={() => imgSt !== "error" && setZoomItem(item)}>
                          {imgSt === "error" ? (
                            <div className="flex flex-col items-center text-slate-300 gap-1">
                              <AlertCircle className="w-5 h-5 opacity-60" />
                              <span className="text-[10px] font-medium">Not Found</span>
                              <button onClick={(e) => { e.stopPropagation(); setImageStatus((p) => { const n = {...p}; delete n[item.id]; return n; }); loadImageBatch([item], datasetFolder); }}
                                className="text-[10px] text-blue-500 hover:text-blue-700 flex items-center gap-0.5 mt-0.5">
                                <RotateCcw className="w-2.5 h-2.5" /> Retry
                              </button>
                            </div>
                          ) : imgUrl ? (
                            <>
                              <img src={imgUrl} alt={item.originalPath} loading="lazy"
                                className="max-w-full max-h-full object-contain drop-shadow-sm mix-blend-multiply"
                                onError={() => setImageStatus((prev) => ({ ...prev, [item.id]: "error" }))} />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                <ZoomIn className="w-6 h-6 text-white drop-shadow-lg" />
                              </div>
                            </>
                          ) : (
                            <ImageIcon className="w-6 h-6 text-slate-200" />
                          )}
                        </button>

                        <div className="p-3 sm:p-4 flex-1 flex flex-col gap-3">
                          <div className="space-y-1.5 flex-1">
                            <div className="flex bg-green-50/50 rounded-lg border border-green-100/50 px-2.5 py-1.5 items-center gap-2">
                              <span className="text-[10px] font-bold text-green-700 w-8 shrink-0 uppercase">GT</span>
                              <input type="text" value={displayGt}
                                onChange={(e) => updateGt(item, e.target.value)}
                                onFocus={() => setActivelyEditingId(item.id)}
                                onBlur={() => setActivelyEditingId(null)}
                                className="flex-1 text-xs font-medium text-green-900 bg-transparent border-none outline-none focus:ring-1 focus:ring-green-300 rounded px-1 min-w-0"
                                placeholder="Enter GT…" />
                            </div>
                            <div className="flex bg-red-50/50 rounded-lg border border-red-100/50 px-2.5 py-1.5">
                              <span className="text-[10px] font-bold text-red-700 w-8 shrink-0 uppercase">Pred</span>
                              <span className="text-xs font-medium text-red-900 break-all">{item.pred || "—"}</span>
                            </div>
                          </div>
                          <input type="text" placeholder="Type correction here…"
                            value={corrections[item.id] ?? ""}
                            onChange={(e) => updateCorrection(item.id, e.target.value)}
                            onFocus={() => setActivelyEditingId(item.id)}
                            onBlur={() => setActivelyEditingId(null)}
                            className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition-all placeholder:text-slate-400" />
                        </div>

                      </div>
                    );
                  })}
                </div>
                <div className="h-12 sm:h-16" />
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
}
