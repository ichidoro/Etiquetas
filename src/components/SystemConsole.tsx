import React, { useState, useEffect, useRef, useCallback } from "react";
import { RefreshCw, Trash2, Filter, Download, ChevronDown } from "lucide-react";

interface LogEntry {
  id: number;
  timestamp: string;
  level: string;
  source: string;
  message: string;
  details: string | null;
}

const LEVEL_STYLES: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  info:    { bg: "bg-blue-50",    text: "text-blue-700",    dot: "bg-blue-400",    label: "INFO" },
  success: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-400", label: "OK" },
  warn:    { bg: "bg-amber-50",   text: "text-amber-700",   dot: "bg-amber-400",   label: "WARN" },
  error:   { bg: "bg-red-50",     text: "text-red-700",     dot: "bg-red-400",     label: "ERROR" },
};

const SOURCE_LABELS: Record<string, string> = {
  "server": "Servidor",
  "bridge": "Bridge",
  "print-usb": "Impresion USB",
  "print-queue": "Cola Impresion",
  "frontend": "Frontend",
};

export function SystemConsole() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filterLevel, setFilterLevel] = useState<string>("all");
  const [filterSource, setFilterSource] = useState<string>("all");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/logs?limit=200");
      if (!res.ok) return;
      const data = await res.json();
      setLogs(data);
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0; // Newest first, so scroll to top
    }
  }, [logs]);

  const clearLogs = async () => {
    try {
      await fetch("/api/logs", { method: "DELETE" });
      setLogs([]);
    } catch {}
  };

  const exportLogs = () => {
    const text = filteredLogs
      .map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] [${l.source}] ${l.message}${l.details ? ` | ${l.details}` : ""}`)
      .join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `zebra-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredLogs = logs.filter((l) => {
    if (filterLevel !== "all" && l.level !== filterLevel) return false;
    if (filterSource !== "all" && l.source !== filterSource) return false;
    return true;
  });

  const uniqueSources = Array.from(new Set(logs.map((l) => l.source)));

  // Count by level
  const counts = logs.reduce(
    (acc, l) => {
      acc[l.level] = (acc[l.level] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-bold text-slate-800">Consola de Diagnostico</h3>
            {/* Level counters */}
            <div className="flex gap-1.5">
              {counts.error && (
                <span className="px-1.5 py-0.5 text-[10px] font-bold bg-red-100 text-red-700 rounded">
                  {counts.error} errors
                </span>
              )}
              {counts.warn && (
                <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-700 rounded">
                  {counts.warn} warns
                </span>
              )}
              {counts.success && (
                <span className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-700 rounded">
                  {counts.success} ok
                </span>
              )}
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-600 rounded">
                {logs.length} total
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Filters */}
            <select
              id="console-filter-level"
              aria-label="Filtrar por nivel"
              value={filterLevel}
              onChange={(e) => setFilterLevel(e.target.value)}
              className="text-xs border border-slate-200 rounded px-2 py-1 bg-white text-slate-600"
            >
              <option value="all">Todos los niveles</option>
              <option value="error">Solo errores</option>
              <option value="warn">Solo warnings</option>
              <option value="success">Solo exitosos</option>
              <option value="info">Solo info</option>
            </select>
            <select
              id="console-filter-source"
              aria-label="Filtrar por origen"
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
              className="text-xs border border-slate-200 rounded px-2 py-1 bg-white text-slate-600"
            >
              <option value="all">Todas las fuentes</option>
              {uniqueSources.map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABELS[s] || s}
                </option>
              ))}
            </select>

            {/* Auto-refresh toggle */}
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`text-xs px-2 py-1 rounded border cursor-pointer transition-colors ${
                autoRefresh
                  ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                  : "bg-slate-50 border-slate-200 text-slate-500"
              }`}
            >
              {autoRefresh ? "Auto 5s" : "Pausado"}
            </button>

            {/* Actions */}
            <button
              onClick={fetchLogs}
              className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors cursor-pointer"
              title="Refrescar"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={exportLogs}
              className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors cursor-pointer"
              title="Exportar logs"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={clearLogs}
              className="p-1.5 text-slate-400 hover:text-red-500 transition-colors cursor-pointer"
              title="Limpiar logs"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Log entries */}
      <div
        ref={containerRef}
        className="max-h-[500px] overflow-y-auto bg-slate-900 font-mono text-xs"
      >
        {loading && logs.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-slate-500">
            <RefreshCw className="w-4 h-4 animate-spin mr-2" />
            Cargando logs...
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-500">
            <Filter className="w-6 h-6 mb-2" />
            <p>No hay logs{filterLevel !== "all" || filterSource !== "all" ? " con este filtro" : ""}</p>
            <p className="text-slate-600 mt-1">Los eventos apareceran aqui al imprimir o registrar bridges</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {filteredLogs.map((log) => {
              const style = LEVEL_STYLES[log.level] || LEVEL_STYLES.info;
              const isExpanded = expanded.has(log.id);
              const hasDetails = !!log.details;

              return (
                <div
                  key={log.id}
                  className={`px-3 py-1.5 hover:bg-slate-800/50 transition-colors ${
                    hasDetails ? "cursor-pointer" : ""
                  }`}
                  onClick={() => hasDetails && toggleExpand(log.id)}
                >
                  <div className="flex items-start gap-2">
                    {/* Timestamp */}
                    <span className="text-slate-500 whitespace-nowrap flex-shrink-0">
                      {new Date(log.timestamp + "Z").toLocaleTimeString("es", {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>

                    {/* Level badge */}
                    <span
                      className={`px-1.5 py-0 rounded text-[10px] font-bold flex-shrink-0 ${style.bg} ${style.text}`}
                    >
                      {style.label}
                    </span>

                    {/* Source */}
                    <span className="text-slate-400 flex-shrink-0">
                      [{SOURCE_LABELS[log.source] || log.source}]
                    </span>

                    {/* Message */}
                    <span className={`flex-1 ${log.level === "error" ? "text-red-300" : log.level === "success" ? "text-emerald-300" : log.level === "warn" ? "text-amber-300" : "text-slate-300"}`}>
                      {log.message}
                    </span>

                    {/* Expand indicator */}
                    {hasDetails && (
                      <ChevronDown
                        className={`w-3 h-3 text-slate-500 flex-shrink-0 transition-transform ${
                          isExpanded ? "rotate-180" : ""
                        }`}
                      />
                    )}
                  </div>

                  {/* Details (expandable) */}
                  {isExpanded && log.details && (
                    <div className="mt-1 ml-[72px] px-2 py-1 bg-slate-800 rounded text-slate-400 text-[11px] border-l-2 border-slate-600">
                      {log.details}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Footer with system info */}
      <div className="px-4 py-2 border-t border-slate-200 bg-slate-50 text-[10px] text-slate-400 flex items-center justify-between">
        <span>
          Mostrando {filteredLogs.length} de {logs.length} logs | Auto-limpieza: 24h
        </span>
        <span>
          {autoRefresh && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Actualizando cada 5s
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
