"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  FolderSearch, FolderOpen, X, Loader2, HardDrive, Folder,
  FileText, ArrowUp, ChevronRight, Users, CheckSquare, Square,
  AlertCircle, RefreshCw, Power, Database, Activity,
  Image as ImageIcon, ChevronLeft, Menu, Download, Search,
  ZoomIn, RotateCcw, Keyboard, Clock,
} from "lucide-react";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const IMAGE_BATCH_SIZE = 1000;
const IMG_CONCURRENCY  = 6;
const GT_DEBOUNCE_MS   = 800;
const CORR_DEBOUNCE_MS = 800;
const EDITOR_NAME      = "Admin";

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
  toastQueue.push({ id, msg, type });
  toastListeners.forEach((fn) => fn([...toastQueue]));
  if (duration > 0) setTimeout(() => dismissToast(id), duration);
  return id;
}
function dismissToast(id) {
  const idx = toastQueue.findIndex((t) => t.id === id);
  if (idx > -1) { toastQueue.splice(idx, 1); toastListeners.forEach((fn) => fn([...toastQueue])); }
}
function ToastContainer() {
  const [toasts, setToasts] = useState([]);
  useEffect(() => { toastListeners.add(setToasts); return () => toastListeners.delete(setToasts); }, []);
  const colors = { success: "bg-green-600 text-white", error: "bg-red-600 text-white", info: "bg-blue-600 text-white", saving: "bg-slate-700 text-white" };
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
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
            { label: "GT", value: gt, color: "text-green-800 bg-green-50" },
            { label: "Prediction", value: item.pred, color: "text-red-800 bg-red-50" },
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

// ─── EXPORT FILTER MODAL ──────────────────────────────────────────────────────
const EXPORT_FILTERS = [
  { id: "all",         label: "All flagged items",           desc: "Export everything in the flag list" },
  { id: "corrected",   label: "Flagged + has correction",    desc: "Only flagged items where a correction was typed" },
  { id: "gt_edited",   label: "Flagged + GT was edited",     desc: "Only flagged items where GT differs from original" },
  { id: "uncorrected", label: "Flagged + no correction yet", desc: "Items still needing a correction — for QA review" },
];
function ExportFilterModal({ exportList, corrections, dataset, gtState, onExport, onClose }) {
  const [filter, setFilter] = useState("all");
  const counts = useMemo(() => {
    const keys = Object.keys(exportList);
    const dataMap = Object.fromEntries(dataset.map((d) => [d.id, d]));
    return {
      all:         keys.length,
      corrected:   keys.filter((k) => corrections[k]?.trim()).length,
      gt_edited:   keys.filter((k) => { const orig = dataMap[k]?.gt ?? ""; const cur = gtState[k] ?? orig; return cur !== orig; }).length,
      uncorrected: keys.filter((k) => !corrections[k]?.trim()).length,
    };
  }, [exportList, corrections, dataset, gtState]);
  const handleExport = () => {
    let filtered = { ...exportList };
    const dataMap = Object.fromEntries(dataset.map((d) => [d.id, d]));
    if (filter === "corrected")   filtered = Object.fromEntries(Object.entries(filtered).filter(([k]) => corrections[k]?.trim()));
    else if (filter === "gt_edited") filtered = Object.fromEntries(Object.entries(filtered).filter(([k]) => { const orig = dataMap[k]?.gt ?? ""; const cur = gtState[k] ?? orig; return cur !== orig; }));
    else if (filter === "uncorrected") filtered = Object.fromEntries(Object.entries(filtered).filter(([k]) => !corrections[k]?.trim()));
    onExport(filtered);
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
              <input type="radio" name="export-filter" value={id} checked={filter === id} onChange={() => setFilter(id)} className="mt-0.5 accent-blue-600" />
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
          <Download className="w-4 h-4" /> Export {counts[filter]} item{counts[filter] !== 1 ? "s" : ""}
        </button>
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
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2"><Keyboard className="w-4 h-4 text-slate-500" /> Keyboard Shortcuts</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-2 text-sm">
          {[["← / →", "Previous / Next page"], ["J / K", "Previous / Next page"], ["Ctrl+Z", "Undo last edit"], ["Esc", "Close modal"], ["?", "Show this help"]].map(([key, desc]) => (
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

// ─── FILE BROWSER ─────────────────────────────────────────────────────────────
function FileBrowser({ onFileSelected, onClose }) {
  const [roots,   setRoots]   = useState([]);
  const [browsing,setBrowsing]= useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    fetch("/api/fs/roots").then((r) => r.json()).then((d) => setRoots(d.roots || [])).catch(() => setError("Cannot reach filesystem API."));
  }, []);

  const browseDir = async (p) => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`/api/fs/browse?path=${encodeURIComponent(p)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Browse failed");
      setBrowsing(data);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const extColor = { ".json":"text-purple-600",".tsv":"text-blue-600",".csv":"text-green-600",".txt":"text-slate-600" };
  const extBg   = { ".json":"bg-purple-50 border-purple-200",".tsv":"bg-blue-50 border-blue-200",".csv":"bg-green-50 border-green-200",".txt":"bg-slate-50 border-slate-200" };

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50 shrink-0">
        <div className="flex items-center gap-2">
          <FolderSearch className="w-4 h-4 text-blue-600" />
          <span className="text-sm font-bold text-slate-700">Select Dataset File</span>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded"><X className="w-4 h-4" /></button>
      </div>
      {browsing && (
        <div className="px-3 py-2 bg-blue-50 border-b border-blue-100 flex items-center gap-2 shrink-0">
          <span className="text-[11px] font-mono text-blue-700 truncate flex-1">{browsing.currentPath}</span>
          {browsing.parentPath && (
            <button onClick={() => browseDir(browsing.parentPath)} disabled={loading} className="shrink-0 text-blue-600 hover:text-blue-800 disabled:opacity-40 p-1 rounded">
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
      {error && <div className="mx-3 mt-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 shrink-0">⚠ {error}</div>}
      {!browsing && !error && <p className="text-[11px] text-slate-400 px-4 pt-3 pb-1 shrink-0">Navigate to your dataset folder, then click the exact file to load.</p>}
      <div className="flex-1 overflow-y-auto">
        {!browsing && (
          <div className="p-3 space-y-1">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1 mb-2">Available Drives</p>
            {roots.length === 0 && !error && <div className="flex items-center gap-2 text-slate-400 text-xs py-3 px-1"><Loader2 className="w-3 h-3 animate-spin" /> Detecting drives…</div>}
            {roots.map((root) => (
              <button key={root.path} onClick={() => browseDir(root.path)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-100 text-left transition-colors">
                <HardDrive className="w-4 h-4 text-slate-500 shrink-0" />
                <span className="text-sm font-medium text-slate-700">{root.label}</span>
              </button>
            ))}
          </div>
        )}
        {browsing && (
          <div className="p-2">
            {loading && <div className="flex items-center gap-2 text-slate-400 text-xs px-3 py-3"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</div>}
            {browsing.sourceFiles?.length > 0 && (
              <div className="mb-3">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-2 py-2">Dataset Files — Click to Load</p>
                <div className="space-y-1.5">
                  {browsing.sourceFiles.map((file) => (
                    <button key={file.path} onClick={() => onFileSelected(file)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all hover:brightness-95 ${extBg[file.ext] || "bg-slate-50 border-slate-200"}`}>
                      <FileText className={`w-4 h-4 ${extColor[file.ext] || "text-slate-600"} shrink-0`} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-bold truncate ${extColor[file.ext] || "text-slate-600"}`}>{file.name}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5 truncate">{file.path}</p>
                      </div>
                      <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-md ${extColor[file.ext] || "text-slate-600"} bg-white border border-current opacity-60`}>SELECT</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!loading && browsing.sourceFiles?.length === 0 && browsing.directories?.length > 0 && (
              <p className="text-[11px] text-slate-400 px-3 pb-2">No dataset files here. Browse into a subfolder.</p>
            )}
            {browsing.directories?.length > 0 && (
              <div>
                {browsing.sourceFiles?.length > 0 && <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 pt-1 pb-1.5">Subfolders</p>}
                <div className="space-y-0.5">
                  {browsing.directories.map((dir) => (
                    <button key={dir.path} onClick={() => browseDir(dir.path)} disabled={loading}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-100 disabled:opacity-40 text-left transition-colors">
                      <Folder className="w-4 h-4 text-amber-500 shrink-0" />
                      <span className="text-sm text-slate-700 truncate flex-1">{dir.name}</span>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!loading && browsing.directories?.length === 0 && browsing.sourceFiles?.length === 0 && (
              <p className="text-xs text-slate-400 px-3 py-6 text-center">Empty folder or no supported files.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ADMIN PANEL ──────────────────────────────────────────────────────────────
export default function AdminPanel() {
  // ── Control state ──
  const [session,        setSession]        = useState(null);
  const [showBrowser,    setShowBrowser]    = useState(false);
  const [selectedFile,   setSelectedFile]   = useState(null);
  const [loading,        setLoading]        = useState(false);
  const [unloading,      setUnloading]      = useState(false);
  const [error,          setError]          = useState(null);
  const [connectedUsers, setConnectedUsers] = useState(0);
  const [stats,          setStats]          = useState({ corrections: 0, flags: 0 });
  const [statsLoading,   setStatsLoading]   = useState(false);
  const [isSidebarOpen,  setIsSidebarOpen]  = useState(true);
  const [recentActivity, setRecentActivity] = useState([]);

  // ── Dataset viewer state ──
  const [dataset,          setDataset]          = useState([]);
  const [datasetFolder,    setDatasetFolder]    = useState(null);
  const [originalFileName, setOriginalFileName] = useState("");
  const [isLoadingDataset, setIsLoadingDataset] = useState(false);
  const [gtState,          setGtState]          = useState({});
  const [corrections,      setCorrections]      = useState({});
  const [exportList,       setExportList]       = useState({});
  const [localGtEdits,     setLocalGtEdits]     = useState({});
  const [activelyEditingId,setActivelyEditingId]= useState(null);
  const [imageStatus,      setImageStatus]      = useState({});
  const [loadedUpTo,       setLoadedUpTo]       = useState(0);
  const [isBatchLoading,   setIsBatchLoading]   = useState(false);
  const [batchProgress,    setBatchProgress]    = useState({ done: 0, total: 0 });
  const [currentPage,      setCurrentPage]      = useState(0);
  const [viewMode,         setViewMode]         = useState("Word Level");
  const [searchQuery,      setSearchQuery]      = useState("");
  const [showFlaggedOnly,  setShowFlaggedOnly]  = useState(false);
  const [zoomItem,         setZoomItem]         = useState(null);
  const [showShortcuts,    setShowShortcuts]    = useState(false);
  const [showExportModal,  setShowExportModal]  = useState(false);
  const [undoStack,        setUndoStack]        = useState([]);
  const [autoFill,         setAutoFill]         = useState(false); // false | "pred" | "gt"
  const [reconnectBanner,  setReconnectBanner]  = useState(false);

  const pendingGtSave   = useRef({});
  const pendingCorrSave = useRef({});
  const gtSaveTimer     = useRef(null);
  const corrSaveTimer   = useRef(null);
  const currentSession  = useRef(null);

  // ── Position persistence ──
  const savePosition = (filePath, page, mode) => {
    try { localStorage.setItem(`ocr_pos_${filePath}`, JSON.stringify({ page, mode })); } catch {}
  };
  const loadPosition = (filePath) => {
    try { const r = localStorage.getItem(`ocr_pos_${filePath}`); return r ? JSON.parse(r) : null; } catch { return null; }
  };

  // ── Responsive sidebar ──
  useEffect(() => {
    const onResize = () => setIsSidebarOpen(window.innerWidth >= 1024);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ── Fetch audit activity ──
  const fetchActivity = useCallback(async (folder) => {
    if (!folder) return;
    try {
      const res  = await fetch(`/api/audit?folder=${encodeURIComponent(folder)}&limit=8`);
      const data = await res.json();
      setRecentActivity(data.entries || []);
    } catch {}
  }, []);

  // ── SSE ──
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "client_count") setConnectedUsers(msg.count);
        if (msg.type === "connected") {
          setConnectedUsers(msg.activeClients);
          if (msg.session) {
            const isReconnect = !!currentSession.current;
            setSession(msg.session);
            if (isReconnect) {
              setReconnectBanner(true);
              loadDatasetFromSession(msg.session, true);
            } else {
              loadDatasetFromSession(msg.session, false);
            }
          } else { setSession(null); }
        }
        if (msg.type === "gt_update") {
          setGtState((prev) => ({ ...prev, [msg.id]: msg.gt }));
          setLocalGtEdits((prev) => {
            if (prev[msg.id] === undefined) return prev;
            const next = { ...prev }; delete next[msg.id]; return next;
          });
        }
        if (msg.type === "correction_update") {
          setCorrections((prev) => ({ ...prev, [msg.id]: msg.correction }));
        }
        if (msg.type === "flag_update") {
          if (msg.flagged) {
            setSession((s) => {
              if (s?.folderPath) {
                fetch(`/api/corrections?folder=${encodeURIComponent(s.folderPath)}`)
                  .then((r) => r.json()).then((d) => setExportList(d.exportList || {})).catch(() => {});
              }
              return s;
            });
          } else { setExportList((prev) => { const n = { ...prev }; delete n[msg.id]; return n; }); }
          setSession((s) => { if (s?.folderPath) fetchStats(s.folderPath); return s; });
        }
        if (msg.type === "dataset_loaded") {
          setSession(msg.session);
          loadDatasetFromSession(msg.session, false);
        }
        if (msg.type === "dataset_unloaded") {
          setSession(null);
          setDataset([]); setDatasetFolder(null); setGtState({});
          setCorrections({}); setExportList({}); setImageStatus({});
          setLoadedUpTo(0); setCurrentPage(0);
          setSearchQuery(""); setShowFlaggedOnly(false);
        }
      } catch {}
    };
    es.onerror = () => {};
    return () => es.close();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Dataset loader ──
  const loadDatasetFromSession = useCallback(async (sess, isReconnect = false) => {
    if (!sess) return;
    if (!isReconnect) setIsLoadingDataset(true);
    try {
      const res  = await fetch(`/api/dataset?file=${encodeURIComponent(sess.filePath)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load dataset");

      const { content, fileName, folderPath } = data;
      currentSession.current = sess;
      setDatasetFolder(folderPath);
      setOriginalFileName(fileName);

      if (!isReconnect) {
        setDataset([]); setGtState({}); setCorrections({}); setExportList({});
        setLocalGtEdits({}); setImageStatus({}); setLoadedUpTo(0);
        pendingGtSave.current = {}; pendingCorrSave.current = {};
        setUndoStack([]);
        const saved = loadPosition(sess.filePath);
        if (saved) { setCurrentPage(saved.page ?? 0); setViewMode(saved.mode ?? "Word Level"); }
        else        setCurrentPage(0);
      }

      const getFolderId = (imgPath) => {
        if (imgPath.includes("/") || imgPath.includes("\\")) {
          const parts = imgPath.replace(/\\/g, "/").split("/");
          return parts.length > 1 ? parts[parts.length - 2] : "Root";
        }
        return "Root";
      };

      const parsedData = [];
      if (fileName.toLowerCase().endsWith(".json")) {
        const parsed = JSON.parse(content);
        let rawData = [];
        if (Array.isArray(parsed)) rawData = parsed;
        else if (parsed && typeof parsed === "object") {
          const wrapperKeys = ["data","annotations","items","records","images","dataset","results"];
          const found = wrapperKeys.find((k) => Array.isArray(parsed[k]));
          rawData = found ? parsed[found] : (Object.keys(parsed).find((k) => Array.isArray(parsed[k])) ? parsed[Object.keys(parsed).find((k) => Array.isArray(parsed[k]))] : [parsed]);
        }
        rawData.forEach((item) => {
          if (!item || typeof item !== "object") return;
          const rawPath = item.image_path || item.image || item.filename || item.file || item.Path || item.Image;
          const imgPath = rawPath?.toString().trim();
          const gtText  = item.gt || item.ground_truth || item.label || item.text || item.GT || "";
          const predText= item.pred || item.prediction || item.predicted || item.Pred || "";
          if (imgPath) parsedData.push({ originalPath: imgPath, gt: gtText.toString().trim(), pred: predText.toString().trim(), folderId: getFolderId(imgPath), id: imgPath });
        });
      } else {
        const isCsv = fileName.toLowerCase().endsWith(".csv");
        const delim  = isCsv ? "," : "\t";
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
        let isFirstRow = true;
        for (const line of content.split(/\r?\n/)) {
          if (!line.trim()) continue;
          const parts = parseRow(line, delim);
          if (isFirstRow) {
            isFirstRow = false;
            const fc = parts[0]?.trim() || "";
            const looksLikeHeader = fc && !fc.includes("/") && !fc.includes("\\") &&
              !/\.(png|jpg|jpeg|gif|bmp|webp|tiff?|txt|json|tsv|csv)$/i.test(fc);
            if (looksLikeHeader) continue;
          }
          const imgPath = parts[0]?.trim();
          if (imgPath) parsedData.push({ originalPath: imgPath, gt: parts[1]?.trim() || "", pred: parts[2]?.trim() || "", folderId: getFolderId(imgPath), id: imgPath });
        }
      }

      if (!isReconnect) setDataset(parsedData);

      try {
        const [gtRes, corrRes] = await Promise.all([
          fetch(`/api/gt?folder=${encodeURIComponent(folderPath)}`),
          fetch(`/api/corrections?folder=${encodeURIComponent(folderPath)}`),
        ]);
        if (gtRes.ok)   { const d = await gtRes.json();   setGtState(d.state || {}); }
        if (corrRes.ok) { const d = await corrRes.json(); setCorrections(d.corrections || {}); setExportList(d.exportList || {}); }
      } catch {}

      if (!isReconnect) {
        const firstBatch = parsedData.slice(0, IMAGE_BATCH_SIZE);
        setLoadedUpTo(firstBatch.length);
        loadImageBatch(firstBatch, folderPath);
      }

      fetchActivity(folderPath);

      if (isReconnect) {
        setReconnectBanner(false);
        fireToast("Reconnected — state synced", "success");
      }
    } catch (err) {
      console.error("Dataset load error:", err);
      if (!isReconnect) setError(`Failed to load dataset: ${err.message}`);
      else fireToast("Reconnect sync failed", "error", 0);
    } finally {
      if (!isReconnect) setIsLoadingDataset(false);
    }
  }, [fetchActivity]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Image batch loader ──
  const loadImageBatch = useCallback(async (items, folder) => {
    if (!items.length || !folder) return;
    setIsBatchLoading(true);
    setBatchProgress({ done: 0, total: items.length });
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
    const failed = dataset.filter((item) => imageStatus[item.id] === "error");
    if (!failed.length) return;
    fireToast(`Retrying ${failed.length} failed image${failed.length !== 1 ? "s" : ""}…`, "info");
    setImageStatus((prev) => { const next = { ...prev }; failed.forEach((item) => { delete next[item.id]; }); return next; });
    loadImageBatch(failed, datasetFolder);
  }, [dataset, datasetFolder, imageStatus, loadImageBatch]);

  // ── Next batch on scroll ──
  useEffect(() => {
    if (!datasetFolder || isBatchLoading || !dataset.length) return;
    const pageSize = viewMode === "Word Level" ? 30 : 10;
    const lastVisible = Math.min((currentPage + 1) * pageSize, dataset.length) - 1;
    if (lastVisible >= loadedUpTo - pageSize * 2 && loadedUpTo < dataset.length) {
      const next = dataset.slice(loadedUpTo, loadedUpTo + IMAGE_BATCH_SIZE);
      setLoadedUpTo((p) => p + next.length);
      loadImageBatch(next, datasetFolder);
    }
  }, [currentPage, loadedUpTo, dataset, datasetFolder, isBatchLoading, viewMode, loadImageBatch]);

  // ── GT save (debounced) ──
  const saveGtToServer = useCallback((folder, id, value) => {
    pendingGtSave.current[id] = value;
    if (gtSaveTimer.current) clearTimeout(gtSaveTimer.current);
    const savingId = fireToast("Saving GT…", "saving", 0);
    gtSaveTimer.current = setTimeout(async () => {
      const updates = Object.fromEntries(Object.entries(pendingGtSave.current));
      pendingGtSave.current = {};
      try {
        const res = await fetch("/api/gt", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder, updates, editor: EDITOR_NAME }) });
        dismissToast(savingId);
        if (!res.ok) throw new Error();
        setGtState((prev) => ({ ...prev, ...updates }));
        fireToast("GT saved ✓", "success");
        fetchActivity(folder);
      } catch { dismissToast(savingId); fireToast("GT save failed", "error", 0); }
    }, GT_DEBOUNCE_MS);
  }, [fetchActivity]);

  const updateGt = (item, value) => {
    const prev = localGtEdits[item.id] ?? gtState[item.id] ?? item.gt;
    setLocalGtEdits((p) => ({ ...p, [item.id]: value }));
    setUndoStack((s) => [...s.slice(-49), { id: item.id, field: "gt", prev }]);
    saveGtToServer(datasetFolder, item.id, value);
  };

  const resolveGt = (item) => {
    if (localGtEdits[item.id] !== undefined) return localGtEdits[item.id];
    if (gtState[item.id]      !== undefined) return gtState[item.id];
    return item.gt;
  };

  // ── Correction handler (debounced) ──
  const saveCorrToServer = useCallback((folder, id, value) => {
    pendingCorrSave.current[id] = value;
    if (corrSaveTimer.current) clearTimeout(corrSaveTimer.current);
    corrSaveTimer.current = setTimeout(async () => {
      const batch = { ...pendingCorrSave.current };
      pendingCorrSave.current = {};
      try {
        const res = await fetch("/api/corrections", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder, corrections: batch, editor: EDITOR_NAME }) });
        if (!res.ok) throw new Error();
        fetchActivity(folder);
      } catch { fireToast("Correction save failed", "error", 0); }
    }, CORR_DEBOUNCE_MS);
  }, [fetchActivity]);

  const updateCorrection = (id, val) => {
    const prev = corrections[id] ?? "";
    setCorrections((prev) => ({ ...prev, [id]: val }));
    setUndoStack((s) => [...s.slice(-49), { id, field: "correction", prev }]);
    if (datasetFolder) saveCorrToServer(datasetFolder, id, val);
  };

  // ── Undo ──
  const handleUndo = useCallback(() => {
    if (!undoStack.length) return;
    const last = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    if (last.field === "gt") {
      setLocalGtEdits((p) => ({ ...p, [last.id]: last.prev }));
      if (datasetFolder) {
        fetch("/api/gt", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder: datasetFolder, updates: { [last.id]: last.prev }, editor: EDITOR_NAME }) })
          .then(() => { setGtState((p) => ({ ...p, [last.id]: last.prev })); fetchActivity(datasetFolder); })
          .catch(() => fireToast("Undo failed", "error", 0));
      }
    } else if (last.field === "correction") {
      setCorrections((p) => ({ ...p, [last.id]: last.prev }));
      if (datasetFolder) saveCorrToServer(datasetFolder, last.id, last.prev);
    }
    fireToast("Undone ✓", "info");
  }, [undoStack, datasetFolder, saveCorrToServer, fetchActivity]);

  // ── Flag toggle ──
  const toggleFlag = async (item) => {
    const isFlagged = !!exportList[item.id];
    if (isFlagged) {
      setExportList((prev) => { const n = { ...prev }; delete n[item.id]; return n; });
      if (datasetFolder) {
        try { await fetch("/api/corrections", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder: datasetFolder, removeFlagId: item.id, editor: EDITOR_NAME }) }); }
        catch { fireToast("Unflag failed", "error", 0); }
      }
    } else {
      const entry = { Image: item.originalPath.split("/").pop(), GT: resolveGt(item), Pred: item.pred, Path: item.originalPath, OriginalFile: originalFileName };
      setExportList((prev) => ({ ...prev, [item.id]: entry }));
      if (datasetFolder) {
        try { await fetch("/api/corrections", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder: datasetFolder, exportList: { [item.id]: entry }, editor: EDITOR_NAME }) }); }
        catch { fireToast("Flag save failed", "error", 0); }
      }
    }
  };

  // ── Stats ──
  const fetchStats = useCallback(async (folder) => {
    if (!folder) return;
    setStatsLoading(true);
    try {
      const res  = await fetch(`/api/corrections?folder=${encodeURIComponent(folder)}`);
      const data = await res.json();
      // "Edits" = unique item IDs that have either a non-empty correction OR are flagged (union, count once)
      const corrKeys  = Object.entries(data.corrections || {}).filter(([, v]) => v && v.trim()).map(([k]) => k);
      const flagKeys  = Object.keys(data.exportList || {});
      const editedIds = new Set([...corrKeys, ...flagKeys]);
      setStats({ corrections: editedIds.size, flags: Object.keys(data.exportList || {}).length });
    } catch {}
    finally { setStatsLoading(false); }
  }, []);

  useEffect(() => { if (session?.folderPath) { fetchStats(session.folderPath); fetchActivity(session.folderPath); } }, [session, fetchStats, fetchActivity]);

  // ── Export dropdown state ──
  const [isExporting,      setIsExporting]      = useState(false);
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const exportDropdownRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(e.target))
        setShowExportDropdown(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Export CSV: path,corrected — no headers
  const exportCsv = () => {
    const keys = Object.keys(exportList);
    if (!keys.length) { fireToast("No flagged items", "error", 3000); return; }
    setShowExportDropdown(false);
    const rows = keys.map((id) => {
      const corrected = (corrections[id] ?? "").replace(/"/g, '""');
      const path      = id.replace(/"/g, '""');
      // Quote fields that contain commas, quotes, or newlines
      const qPath = path.includes(",") || path.includes('"') || path.includes("\n") ? `"${path}"` : path;
      const qCorr = corrected.includes(",") || corrected.includes('"') || corrected.includes("\n") ? `"${corrected}"` : corrected;
      return `${qPath},${qCorr}`;
    });
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement("a"), { href: url });
    const base = originalFileName.replace(/\.[^.]+$/, "") || "flagged_errors";
    a.setAttribute("download", `${base}_corrections.csv`);
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    fireToast(`Exported ${keys.length} rows as CSV ✓`, "success");
  };

  const doExport = async (filteredExportList) => {
    const keys = Object.keys(filteredExportList);
    if (!keys.length)   { fireToast("No items to export", "error", 3000); return; }
    if (!datasetFolder) { fireToast("No dataset folder", "error", 3000);  return; }
    setIsExporting(true); setShowExportModal(false);
    const tid = fireToast("Exporting…", "saving", 0);
    try {
      const res = await fetch("/api/export", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: datasetFolder, exportList: filteredExportList, corrections,
          fileName: originalFileName.replace(/\.[^.]+$/, "") || "flagged_errors" }) });
      dismissToast(tid);
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Server ${res.status}`); }
      const savedXlsx = res.headers.get("X-Saved-Xlsx") || "";
      const savedJson = res.headers.get("X-Saved-Json") || "";
      const buf  = await res.arrayBuffer();
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement("a"), { href: url });
      const cd   = res.headers.get("Content-Disposition") || "";
      const match = cd.match(/filename="([^"]+)"/);
      a.setAttribute("download", match ? match[1] : "flagged_errors.xlsx");
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      fireToast(`Exported ${keys.length} items ✓`, "success");
      if (savedXlsx || savedJson) {
        setTimeout(() => fireToast(`Saved to server: ${savedXlsx.split(/[\\/]/).pop()}`, "info"), 500);
      }
    } catch (e) { dismissToast(tid); fireToast("Export failed: " + e.message, "error", 0); }
    finally { setIsExporting(false); }
  };

  const exportToServer = () => {
    if (!Object.keys(exportList).length) { fireToast("No flagged items", "error", 3000); return; }
    setShowExportModal(true);
  };

  // ── Load selected file ──
  const handleLoad = async () => {
    if (!selectedFile) return;
    setLoading(true); setError(null);
    try {
      const dsRes  = await fetch(`/api/dataset?file=${encodeURIComponent(selectedFile.path)}`);
      const dsData = await dsRes.json();
      if (!dsRes.ok) throw new Error(dsData.error || "Cannot read dataset file");
      const sesRes  = await fetch("/api/admin/session", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderPath: dsData.folderPath, filePath: dsData.filePath, fileName: dsData.fileName }) });
      const sesData = await sesRes.json();
      if (!sesRes.ok) throw new Error(sesData.error || "Failed to set session");
      setSession(sesData.session);
      loadDatasetFromSession(sesData.session, false);
      setSelectedFile(null); setShowBrowser(false);
      fireToast(`Loaded: ${dsData.fileName}`, "success");
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  // ── Unload ──
  const handleUnload = async () => {
    if (!window.confirm("Unload the current dataset? All users will see the waiting screen.")) return;
    setUnloading(true); setError(null);
    try {
      await fetch("/api/admin/session", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: true }) });
      setSession(null); setStats({ corrections: 0, flags: 0 });
      setDataset([]); setDatasetFolder(null); setGtState({});
      setCorrections({}); setExportList({}); setImageStatus({});
      setLoadedUpTo(0); setCurrentPage(0);
      setSearchQuery(""); setShowFlaggedOnly(false); setRecentActivity([]);
      fireToast("Dataset unloaded", "info");
    } catch (e) { setError(e.message); }
    finally { setUnloading(false); }
  };

  // ── Auto-fill Corrected field ──
  const paginatedDataRef = useRef([]);
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
    if (datasetFolder) {
      fetch("/api/corrections", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: datasetFolder, corrections: updates, editor: EDITOR_NAME }),
      }).catch(console.error);
    }
  }, [autoFill]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") {
        if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); handleUndo(); }
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "j" || e.key === "J") setCurrentPage((p) => Math.max(0, p - 1));
      else if (e.key === "ArrowRight" || e.key === "k" || e.key === "K") setCurrentPage((p) => p + 1);
      else if (e.key === "?" || e.key === "/") setShowShortcuts((v) => !v);
      else if (e.key === "Escape") setZoomItem(null);
      else if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); handleUndo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleUndo]);

  // ── Pagination ──
  const filteredDataset = useMemo(() => {
    let d = dataset;
    if (showFlaggedOnly) d = d.filter((item) => !!exportList[item.id]);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      d = d.filter((item) =>
        item.originalPath.toLowerCase().includes(q) ||
        (resolveGt(item) || "").toLowerCase().includes(q) ||
        (item.pred || "").toLowerCase().includes(q) ||
        (corrections[item.id] || "").toLowerCase().includes(q)
      );
    }
    return d;
  }, [dataset, showFlaggedOnly, searchQuery, exportList, corrections, gtState, localGtEdits]); // eslint-disable-line react-hooks/exhaustive-deps

  const { paginatedData, totalPages, navTitle, navSubtext } = useMemo(() => {
    if (!filteredDataset.length) return { paginatedData: [], totalPages: 1, navTitle: "", navSubtext: "" };
    const pageSize = viewMode === "Word Level" ? 30 : 10;
    const tPages = Math.max(1, Math.ceil(filteredDataset.length / pageSize));
    const safe   = Math.min(currentPage, tPages - 1);
    const start  = safe * pageSize;
    const batch  = filteredDataset.slice(start, start + pageSize);
    return {
      paginatedData: batch, totalPages: tPages,
      navTitle: searchQuery || showFlaggedOnly ? `Results ${safe + 1}/${tPages}` : `Segment ${safe + 1} of ${tPages}`,
      navSubtext: `Items ${start + 1}–${start + batch.length} of ${filteredDataset.length}${filteredDataset.length !== dataset.length ? ` (${dataset.length} total)` : ""}`,
    };
  }, [filteredDataset, currentPage, viewMode, searchQuery, showFlaggedOnly, dataset.length]);

  paginatedDataRef.current = paginatedData;

  useEffect(() => { setCurrentPage(0); }, [searchQuery, showFlaggedOnly]);

  useEffect(() => {
    if (currentSession.current?.filePath) savePosition(currentSession.current.filePath, currentPage, viewMode);
  }, [currentPage, viewMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const datasetLoaded = !!session && dataset.length > 0;
  const batchPct = batchProgress.total ? Math.round((batchProgress.done / batchProgress.total) * 100) : 0;
  const imgBoxHeight = viewMode === "Word Level" ? "h-24" : "h-48";
  const failedCount  = Object.values(imageStatus).filter((s) => s === "error").length;

  const fmtTime = (iso) => {
    try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
  };

  return (
    <div className="min-h-screen bg-slate-100 font-sans flex flex-col">

      {/* Modals */}
      {zoomItem && (
        <ZoomModal item={zoomItem} folder={datasetFolder} gt={resolveGt(zoomItem)}
          correction={corrections[zoomItem.id] ?? ""} onClose={() => setZoomItem(null)} />
      )}
      {showShortcuts && <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />}
      {showExportModal && (
        <ExportFilterModal exportList={exportList} corrections={corrections}
          dataset={dataset} gtState={gtState} onExport={doExport} onClose={() => setShowExportModal(false)} />
      )}

      <ToastContainer />

      {/* Reconnect banner */}
      {reconnectBanner && (
        <div className="fixed top-0 inset-x-0 z-50 bg-amber-500 text-white text-xs font-semibold py-1.5 text-center flex items-center justify-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" /> Reconnected — syncing state…
        </div>
      )}

      {/* ── TOP BAR ── */}
      <header className="bg-white border-b border-slate-200 shadow-sm shrink-0">
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setIsSidebarOpen((v) => !v)}
              className="text-slate-500 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
              <Menu className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-600" /> OCR Validator — Admin
              </h1>
              <p className="text-[10px] text-slate-400">Host control panel · localhost only</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowShortcuts(true)}
              className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
              <Keyboard className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl shrink-0">
              <Users className="w-3.5 h-3.5 text-blue-500" />
              <span className="text-sm font-semibold text-slate-700">{connectedUsers}</span>
              <span className="text-xs text-slate-400">connected</span>
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── SIDEBAR ── */}
        <div className={`bg-white border-r border-slate-200 flex flex-col shrink-0 overflow-hidden transition-all duration-300 ${isSidebarOpen ? "w-72" : "w-0"}`}>
          <div className="w-72 flex flex-col h-full overflow-y-auto p-4 gap-4">

            {error && (
              <div className="flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span className="flex-1">{error}</span>
                <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
              </div>
            )}

            {/* Session card */}
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Active Dataset</p>
              {session ? (
                <div className="p-3 bg-green-50 border border-green-200 rounded-xl space-y-2">
                  <div className="flex items-start gap-2">
                    <FolderOpen className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-green-800 truncate">{session.fileName}</p>
                      <p className="text-[10px] font-mono text-green-600 truncate">{session.folderPath}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 text-center">
                    {[
                      { label: "Users", value: connectedUsers,                             color: "text-blue-700 bg-blue-50" },
                      { label: "Edited", value: statsLoading ? "—" : stats.corrections,    color: "text-violet-700 bg-violet-50" },
                      { label: "Flags", value: statsLoading ? "—" : stats.flags,           color: "text-amber-700 bg-amber-50" },
                    ].map(({ label, value, color }) => (
                      <div key={label} className={`rounded-lg py-1.5 px-1 ${color}`}>
                        <p className="text-[9px] font-bold uppercase">{label}</p>
                        <p className="text-base font-black leading-tight">{value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => { setSelectedFile(null); setShowBrowser(true); }}
                      className="flex-1 text-xs py-1.5 px-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium rounded-lg flex items-center justify-center gap-1">
                      <FolderSearch className="w-3 h-3" /> Switch
                    </button>
                    <button onClick={handleUnload} disabled={unloading}
                      className="flex-1 text-xs py-1.5 px-2 bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 font-medium rounded-lg flex items-center justify-center gap-1 disabled:opacity-50">
                      {unloading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Power className="w-3 h-3" />} Unload
                    </button>
                    <button onClick={() => { fetchStats(session.folderPath); fetchActivity(session.folderPath); }} disabled={statsLoading}
                      className="text-xs p-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 rounded-lg disabled:opacity-50">
                      <RefreshCw className={`w-3 h-3 ${statsLoading ? "animate-spin" : ""}`} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-center space-y-2">
                  <p className="text-xs text-slate-500">No dataset loaded.</p>
                  <button onClick={() => { setSelectedFile(null); setShowBrowser(true); }}
                    className="w-full text-xs py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg flex items-center justify-center gap-1.5">
                    <FolderSearch className="w-3.5 h-3.5" /> Browse & Load
                  </button>
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
                  <div className="h-full bg-blue-500 rounded-full transition-all duration-300"
                    style={{ width: `${dataset.length ? (loadedUpTo / dataset.length) * 100 : 0}%` }} />
                </div>
                {isBatchLoading && (
                  <p className="text-[10px] text-blue-500 flex items-center gap-1">
                    <Loader2 className="w-2.5 h-2.5 animate-spin" /> Loading batch… {batchPct}%
                  </p>
                )}
                {failedCount > 0 && !isBatchLoading && (
                  <button onClick={retryFailedImages}
                    className="text-[10px] text-red-600 flex items-center gap-1 hover:text-red-800 transition-colors">
                    <RotateCcw className="w-2.5 h-2.5" /> {failedCount} failed — Retry All
                  </button>
                )}
              </div>
            )}

            {/* View mode */}
            {datasetLoaded && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">View Mode</p>
                <div className="bg-slate-50 p-1 rounded-lg flex border border-slate-200">
                  {["Word Level", "Line Level"].map((mode) => (
                    <button key={mode} onClick={() => setViewMode(mode)}
                      className={`flex-1 text-xs py-1.5 px-2 rounded-md font-medium transition-colors
                        ${viewMode === mode ? "bg-white shadow-sm text-blue-600 border border-slate-200" : "text-slate-500 hover:text-slate-700"}`}>
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Auto-fill Corrected */}
            {datasetLoaded && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Auto-fill Corrected</p>
                {[
                  { value: "pred", label: "Copy Prediction → Corrected" },
                  { value: "gt",   label: "Copy GT → Corrected" },
                ].map(({ value, label }) => (
                  <label key={value} className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={autoFill === value}
                      onChange={(e) => setAutoFill(e.target.checked ? value : false)}
                      className="w-3.5 h-3.5 accent-blue-600"
                    />
                    <span className="text-xs font-medium text-slate-700">{label}</span>
                  </label>
                ))}
              </div>
            )}

            {/* Undo */}
            {undoStack.length > 0 && (
              <button onClick={handleUndo}
                className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-700 px-3 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                <RotateCcw className="w-3 h-3" /> Undo last edit ({undoStack.length})
              </button>
            )}

            {/* Export */}
            {datasetLoaded && (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-0.5">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Export</p>
                  <span className="text-[10px] text-slate-500">{Object.keys(exportList).length} flagged</span>
                </div>
                <div className="relative" ref={exportDropdownRef}>
                  <div className="flex rounded-xl overflow-hidden border border-blue-600">
                    {/* Main export button */}
                    <button
                      onClick={exportToServer}
                      disabled={isExporting || Object.keys(exportList).length === 0}
                      className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:border-slate-200 text-white font-semibold transition-colors text-xs"
                    >
                      {isExporting
                        ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Exporting…</>
                        : <><Download className="w-3.5 h-3.5" /> Export XLSX</>}
                    </button>
                    {/* Dropdown toggle */}
                    <button
                      onClick={() => setShowExportDropdown((v) => !v)}
                      disabled={isExporting || Object.keys(exportList).length === 0}
                      className="px-2 py-2 bg-blue-700 hover:bg-blue-800 disabled:bg-slate-200 disabled:text-slate-400 text-white border-l border-blue-500 transition-colors"
                      aria-label="More export options"
                    >
                      <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showExportDropdown ? "rotate-90" : ""}`} />
                    </button>
                  </div>
                  {/* Dropdown menu */}
                  {showExportDropdown && (
                    <div className="absolute bottom-full mb-1 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-50">
                      <button
                        onClick={() => { setShowExportDropdown(false); exportToServer(); }}
                        disabled={isExporting || Object.keys(exportList).length === 0}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                        <div className="text-left">
                          <p className="font-semibold text-slate-800">Export XLSX</p>
                          <p className="text-[10px] text-slate-400">Full spreadsheet with images</p>
                        </div>
                      </button>
                      <div className="h-px bg-slate-100" />
                      <button
                        onClick={exportCsv}
                        disabled={Object.keys(exportList).length === 0}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
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
              </div>
            )}

            {/* Recent activity */}
            {recentActivity.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Recent Activity
                </p>
                <div className="space-y-1.5">
                  {recentActivity.slice(0, 5).map((entry, i) => (
                    <div key={i} className="flex items-start gap-2 text-[10px] text-slate-600">
                      <span className="shrink-0 font-semibold text-blue-600">{entry.editor}</span>
                      <span className="truncate flex-1">
                        {entry.field === "gt" ? "edited GT" : "corrected"}
                        {" "}<span className="font-mono text-slate-400 truncate">{entry.itemId.split(/[\\/]/).pop()}</span>
                      </span>
                      <span className="shrink-0 text-slate-400">{fmtTime(entry.timestamp)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>

        {/* ── MAIN CONTENT ── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {/* File browser overlay */}
          {showBrowser && (
            <div className="absolute inset-0 z-40 bg-black/30 flex items-center justify-center p-6">
              <div className="w-full max-w-2xl h-[560px] flex flex-col gap-3">
                <FileBrowser onFileSelected={(file) => setSelectedFile(file)} onClose={() => { setShowBrowser(false); setSelectedFile(null); }} />
                {selectedFile && (
                  <div className="flex items-center gap-3 p-4 bg-white border border-blue-200 rounded-2xl shadow-lg">
                    <FileText className="w-5 h-5 text-blue-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">{selectedFile.name}</p>
                      <p className="text-[11px] font-mono text-slate-400 truncate">{selectedFile.path}</p>
                    </div>
                    <button onClick={() => setSelectedFile(null)} className="text-slate-400 hover:text-slate-600 p-1 rounded"><X className="w-4 h-4" /></button>
                    <button onClick={handleLoad} disabled={loading}
                      className="flex items-center gap-2 py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold rounded-xl shadow-sm text-sm">
                      {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Loading…</> : <><Power className="w-4 h-4" /> Load for All</>}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {isLoadingDataset && (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin" />
                <p className="text-sm">Loading dataset…</p>
              </div>
            </div>
          )}

          {!session && !isLoadingDataset && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-400">
              <Database className="w-12 h-12 text-slate-200" />
              <p className="text-sm font-medium text-slate-500">No dataset loaded</p>
              <button onClick={() => { setSelectedFile(null); setShowBrowser(true); }}
                className="inline-flex items-center gap-2 py-2.5 px-5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-sm text-sm">
                <FolderSearch className="w-4 h-4" /> Browse & Load Dataset
              </button>
            </div>
          )}

          {datasetLoaded && !isLoadingDataset && (
            <>
              {/* Nav bar */}
              <div className="shrink-0 bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-3">
                <button onClick={() => setCurrentPage((p) => Math.max(0, p - 1))} disabled={currentPage === 0}
                  className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30 transition-colors">
                  <ChevronLeft className="w-4 h-4 text-slate-600" />
                </button>
                <div className="flex-1 text-center">
                  <p className="text-xs font-bold text-slate-700">{navTitle}</p>
                  <p className="text-[10px] text-slate-400">{navSubtext}</p>
                </div>
                <button onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))} disabled={currentPage >= totalPages - 1}
                  className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30 transition-colors">
                  <ChevronRight className="w-4 h-4 text-slate-600" />
                </button>
              </div>

              {/* No results */}
              {paginatedData.length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
                  <Search className="w-8 h-8 text-slate-200" />
                  <p className="text-sm font-medium">No items match your filter</p>
                  <button onClick={() => { setSearchQuery(""); setShowFlaggedOnly(false); }}
                    className="text-xs text-blue-600 hover:text-blue-800">Clear filters</button>
                </div>
              )}

              {/* Card grid */}
              {paginatedData.length > 0 && (
                <div className="flex-1 overflow-y-auto p-4">
                  <div className={`grid gap-4 ${viewMode === "Word Level" ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"}`}>
                    {paginatedData.map((item) => {
                      const isFlagged = !!exportList[item.id];
                      const displayGt = resolveGt(item);
                      const imgUrl    = datasetFolder ? buildImageUrl(datasetFolder, item.originalPath) : null;
                      const imgSt     = imageStatus[item.id];

                      return (
                        <div key={item.id}
                          className={`bg-white rounded-xl border transition-all duration-200 overflow-hidden flex flex-col
                            ${isFlagged ? "border-blue-400 ring-2 ring-blue-50 shadow-md" : "border-slate-200 hover:border-slate-300 hover:shadow-sm"}`}>

                          {/* Card header */}
                          <div className={`px-3 py-2 border-b border-slate-100 flex items-center justify-between ${isFlagged ? "bg-blue-50" : "bg-white"}`}>
                            <button onClick={() => toggleFlag(item)} className="flex items-center gap-1.5 group focus:outline-none">
                              {isFlagged
                                ? <CheckSquare className="w-4 h-4 text-blue-600" />
                                : <Square className="w-4 h-4 text-slate-400 group-hover:text-slate-600 transition-colors" />}
                              <span className={`text-[10px] font-semibold ${isFlagged ? "text-blue-700" : "text-slate-400 group-hover:text-slate-600"}`}>
                                {isFlagged ? "Flagged" : "Select"}
                              </span>
                            </button>
                            <span className="text-[9px] text-slate-400 truncate max-w-[50%]" title={item.originalPath}>
                              {item.originalPath.split(/[\\/]/).pop()}
                            </span>
                          </div>

                          {/* Image — click to zoom */}
                          <button
                            className={`w-full bg-slate-50 border-b border-slate-100 flex items-center justify-center ${imgBoxHeight} group relative`}
                            onClick={() => imgSt !== "error" && setZoomItem(item)}>
                            {imgSt === "error" ? (
                              <div className="flex flex-col items-center text-slate-300 gap-1">
                                <AlertCircle className="w-4 h-4 opacity-60" />
                                <span className="text-[9px]">Not Found</span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setImageStatus((p) => { const n = {...p}; delete n[item.id]; return n; }); loadImageBatch([item], datasetFolder); }}
                                  className="text-[9px] text-blue-500 hover:text-blue-700 flex items-center gap-0.5">
                                  <RotateCcw className="w-2 h-2" /> Retry
                                </button>
                              </div>
                            ) : imgUrl ? (
                              <>
                                <img src={imgUrl} alt={item.originalPath} loading="lazy"
                                  className="max-w-full max-h-full object-contain"
                                  onError={() => setImageStatus((prev) => ({ ...prev, [item.id]: "error" }))} />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                  <ZoomIn className="w-5 h-5 text-white drop-shadow-lg" />
                                </div>
                              </>
                            ) : (
                              <ImageIcon className="w-5 h-5 text-slate-200" />
                            )}
                          </button>

                          {/* GT + Correction */}
                          <div className="p-2 flex-1 flex flex-col gap-1.5">
                            <div className="flex bg-green-50 rounded border border-green-100 px-2 py-1 items-center gap-1.5">
                              <span className="text-[9px] font-bold text-green-700 w-6 shrink-0">GT</span>
                              <input type="text" value={displayGt}
                                onChange={(e) => updateGt(item, e.target.value)}
                                onFocus={() => setActivelyEditingId(item.id)}
                                onBlur={() => setActivelyEditingId(null)}
                                className="flex-1 text-[11px] font-medium text-green-900 bg-transparent border-none outline-none focus:ring-1 focus:ring-green-300 rounded px-0.5 min-w-0"
                                placeholder="GT…" />
                            </div>
                            {item.pred && (
                              <div className="flex bg-slate-50 rounded border border-slate-100 px-2 py-1 items-center gap-1.5">
                                <span className="text-[9px] font-bold text-slate-400 w-6 shrink-0">Pred</span>
                                <span className="text-[11px] text-slate-500 truncate">{item.pred}</span>
                              </div>
                            )}
                            <div className="flex bg-violet-50 rounded border border-violet-100 px-2 py-1 items-center gap-1.5">
                              <span className="text-[9px] font-bold text-violet-700 w-6 shrink-0">Cor</span>
                              <input type="text" value={corrections[item.id] ?? ""}
                                onChange={(e) => updateCorrection(item.id, e.target.value)}
                                onFocus={() => setActivelyEditingId(item.id)}
                                onBlur={() => setActivelyEditingId(null)}
                                className="flex-1 text-[11px] font-medium text-violet-900 bg-transparent border-none outline-none focus:ring-1 focus:ring-violet-300 rounded px-0.5 min-w-0"
                                placeholder="Correction…" />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
