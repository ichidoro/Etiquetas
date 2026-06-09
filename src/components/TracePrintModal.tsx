import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { X, Printer, Download, Copy, Check, Code, Minus, Plus, Calendar, Move, RotateCcw, Save } from "lucide-react";
import { Product, LabelFormat } from "../types";

// ─── localStorage helpers ───────────────────────────────────────────────────
const PRINTER_STORAGE_KEY = "zebra-default-printer";
const TRACE_LAYOUT_KEY = "zebra-trace-layout";

function loadDefaultPrinter(): string {
  try { return localStorage.getItem(PRINTER_STORAGE_KEY) || ""; } catch { return ""; }
}
function saveDefaultPrinter(name: string) {
  try { localStorage.setItem(PRINTER_STORAGE_KEY, name); } catch {}
}

interface TracePositions {
  elabY: number;  // mm from top
  vencY: number;
  nameY: number;
}

function loadTraceLayout(formatId: string): TracePositions | null {
  try {
    const raw = localStorage.getItem(`${TRACE_LAYOUT_KEY}-${formatId}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveTraceLayout(formatId: string, pos: TracePositions) {
  try { localStorage.setItem(`${TRACE_LAYOUT_KEY}-${formatId}`, JSON.stringify(pos)); } catch {}
}

// ─── Date helpers ───────────────────────────────────────────────────────────
function toInputDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function formatDDMMYYYY(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}
function addDays(d: Date, days: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + days); return r;
}

// ─── ZPL generation (multi-column aware) ────────────────────────────────────
function generateTraceZpl(
  format: LabelFormat,
  elabDate: Date,
  vencDate: Date,
  productName: string,
  dateFontMm: number,
  nameFontMm: number,
  copies: number,
  positions: TracePositions,
): string {
  const dpmm = format.dpi === 300 ? 12 : 8;
  const labelW = Math.round(format.width * dpmm);
  const labelH = Math.round(format.height * dpmm);
  const gapDots = Math.round(format.horizontalGap * dpmm);
  const marginL = Math.round(format.marginLeft * dpmm);
  const marginR = Math.round(format.marginRight * dpmm);
  const usableW = labelW - marginL - marginR;

  const cols = format.labelsPerRow || 1;
  const rows = format.labelsPerColumn || 1;
  const vGap = Math.round((format.verticalGap || 2) * dpmm);

  const totalPw = Math.max(labelW, labelW * cols + gapDots * Math.max(0, cols - 1) + marginL);

  const dateFontH = Math.round(dateFontMm * dpmm);
  const dateFontW = Math.round(dateFontH * 0.6);
  const nameFontH = Math.round(nameFontMm * dpmm);
  const nameFontW = Math.round(nameFontH * 0.6);

  const elabStr = formatDDMMYYYY(elabDate);
  const vencStr = formatDDMMYYYY(vencDate);

  let zpl = "^XA\n";
  zpl += `^PW${totalPw}\n`;
  zpl += `^LL${labelH}\n`;
  zpl += `~SD${format.darkness}\n`;
  zpl += `^PR${format.printSpeed}\n`;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const colOffsetX = marginL + col * (labelW + gapDots);
      const rowOffsetY = row * (labelH + vGap);

      const y1 = rowOffsetY + Math.round(positions.elabY * dpmm);
      const y2 = rowOffsetY + Math.round(positions.vencY * dpmm);
      const y3 = rowOffsetY + Math.round(positions.nameY * dpmm);

      zpl += `^FO${colOffsetX},${y1}^FB${usableW},1,0,C,0^A0N,${dateFontH},${dateFontW}^FDELAB: ${elabStr}^FS\n`;
      zpl += `^FO${colOffsetX},${y2}^FB${usableW},1,0,C,0^A0N,${dateFontH},${dateFontW}^FDVENC: ${vencStr}^FS\n`;
      zpl += `^FO${colOffsetX},${y3}^FB${usableW},1,0,C,0^A0N,${nameFontH},${nameFontW}^FD${productName.substring(0, 40)}^FS\n`;
    }
  }

  zpl += `^PQ${copies},0,1,Y\n`;
  zpl += "^XZ\n";
  return zpl;
}

// ─── Draggable Preview ──────────────────────────────────────────────────────
interface DragPreviewProps {
  format: LabelFormat;
  positions: TracePositions;
  onPositionsChange: (p: TracePositions) => void;
  dateFontMm: number;
  nameFontMm: number;
  elabText: string;
  vencText: string;
  productName: string;
}

function DraggableTracePreview({
  format, positions, onPositionsChange, dateFontMm, nameFontMm, elabText, vencText, productName,
}: DragPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const dragStartRef = useRef({ mouseY: 0, startY: 0 });

  // Scale: fit label into ~360px wide
  const scale = Math.min(360 / format.width, 280 / format.height);
  const pW = format.width * scale;
  const pH = format.height * scale;
  const pML = format.marginLeft * scale;
  const pMR = format.marginRight * scale;
  const pMT = format.marginTop * scale;
  const pMB = format.marginBottom * scale;
  const usableW = pW - pML - pMR;
  const usableH = pH - pMT - pMB;

  const handleMouseDown = useCallback((id: string, e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(id);
    const yMm = id === "elab" ? positions.elabY : id === "venc" ? positions.vencY : positions.nameY;
    dragStartRef.current = { mouseY: e.clientY, startY: yMm };
  }, [positions]);

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: MouseEvent) => {
      const dy = (e.clientY - dragStartRef.current.mouseY) / scale;
      const newY = Math.max(format.marginTop, Math.min(
        format.height - format.marginBottom - 2,
        dragStartRef.current.startY + dy,
      ));
      if (dragging === "elab") onPositionsChange({ ...positions, elabY: Math.round(newY * 10) / 10 });
      else if (dragging === "venc") onPositionsChange({ ...positions, vencY: Math.round(newY * 10) / 10 });
      else onPositionsChange({ ...positions, nameY: Math.round(newY * 10) / 10 });
    };
    const handleUp = () => setDragging(null);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => { window.removeEventListener("mousemove", handleMove); window.removeEventListener("mouseup", handleUp); };
  }, [dragging, positions, scale, format, onPositionsChange]);

  const elements = [
    { id: "elab", y: positions.elabY, fontSize: dateFontMm, text: elabText, color: "blue" },
    { id: "venc", y: positions.vencY, fontSize: dateFontMm, text: vencText, color: "red" },
    { id: "name", y: positions.nameY, fontSize: nameFontMm, text: productName, color: "amber" },
  ];

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative bg-white border-2 border-slate-300 rounded shadow-lg cursor-crosshair" ref={containerRef}
        style={{ width: pW, height: pH }}>
        {/* Grid dots */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-20">
          <defs>
            <pattern id="traceGrid" width={2 * scale} height={2 * scale} patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.5" fill="#94a3b8" />
            </pattern>
          </defs>
          <rect x={pML} y={pMT} width={usableW} height={usableH} fill="url(#traceGrid)" />
        </svg>
        {/* Margin box */}
        <div className="absolute border border-dashed border-blue-200 pointer-events-none"
          style={{ left: pML, top: pMT, width: usableW, height: usableH }} />

        {/* Draggable elements */}
        {elements.map((el) => {
          const fontPx = el.fontSize * scale;
          const yPx = el.y * scale;
          const isActive = dragging === el.id;
          const borderColor = el.color === "blue" ? "border-blue-400" : el.color === "red" ? "border-red-400" : "border-amber-400";
          const bgColor = isActive
            ? (el.color === "blue" ? "bg-blue-50" : el.color === "red" ? "bg-red-50" : "bg-amber-50")
            : "bg-transparent";

          return (
            <div
              key={el.id}
              onMouseDown={(e) => handleMouseDown(el.id, e)}
              className={`absolute text-center font-bold text-slate-800 truncate select-none transition-colors border border-transparent hover:${borderColor} ${isActive ? borderColor + " " + bgColor : ""}`}
              style={{
                left: pML,
                top: yPx,
                width: usableW,
                fontSize: Math.max(8, fontPx),
                lineHeight: `${Math.max(8, fontPx)}px`,
                cursor: "ns-resize",
              }}
              title={`Arrastra verticalmente: ${el.id.toUpperCase()}`}
            >
              {el.text}
            </div>
          );
        })}
      </div>
      <div className="text-[9px] text-slate-400 flex items-center gap-1">
        <Move className="w-3 h-3" />
        <span>Arrastra los textos para reposicionar</span>
      </div>
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────
interface TracePrintModalProps {
  product: Product;
  labelFormats: LabelFormat[];
  activeFormatId: string;
  onClose: () => void;
  onShowToast?: (message: string, type: "success" | "error") => void;
}

export function TracePrintModal({
  product, labelFormats, activeFormatId: initialFormatId, onClose, onShowToast,
}: TracePrintModalProps) {
  // ── Format selector
  const [activeFormatId, setActiveFormatId] = useState(initialFormatId);
  const currentFormat = labelFormats.find((f) => f.id === activeFormatId) || labelFormats[0];

  // ── Date state
  const [elabDate, setElabDate] = useState(() => new Date());
  const hasCaducidad = product.caducidad != null && product.caducidad > 0;
  const [manualDays, setManualDays] = useState(hasCaducidad ? product.caducidad! : 30);
  const expirationDays = hasCaducidad ? product.caducidad! : manualDays;
  const vencDate = useMemo(() => addDays(elabDate, expirationDays), [elabDate, expirationDays]);

  // ── Font sizes (mm)
  const [dateFontMm, setDateFontMm] = useState(4);
  const [nameFontMm, setNameFontMm] = useState(3);
  const [copies, setCopies] = useState(1);
  const clampFont = (v: number) => Math.max(1.5, Math.min(8, Math.round(v * 2) / 2));

  // ── Positions (mm from top)
  const calcDefaults = useCallback((fmt: LabelFormat): TracePositions => {
    const usableH = fmt.height - fmt.marginTop - fmt.marginBottom;
    const spacing = usableH / 4;
    return {
      elabY: fmt.marginTop + spacing - dateFontMm / 2,
      vencY: fmt.marginTop + spacing * 2 - dateFontMm / 2,
      nameY: fmt.marginTop + spacing * 3 - nameFontMm / 2,
    };
  }, [dateFontMm, nameFontMm]);

  const [positions, setPositions] = useState<TracePositions>(() => {
    const saved = loadTraceLayout(initialFormatId);
    return saved || calcDefaults(currentFormat);
  });
  const [layoutSaved, setLayoutSaved] = useState(false);

  // Load saved layout when format changes
  useEffect(() => {
    const saved = loadTraceLayout(activeFormatId);
    setPositions(saved || calcDefaults(currentFormat));
    setLayoutSaved(false);
  }, [activeFormatId, currentFormat, calcDefaults]);

  const handlePositionsChange = (p: TracePositions) => {
    setPositions(p);
    setLayoutSaved(false);
  };
  const handleSaveLayout = () => {
    saveTraceLayout(activeFormatId, positions);
    setLayoutSaved(true);
    onShowToast?.("Posiciones de trazabilidad guardadas", "success");
  };
  const handleResetPositions = () => {
    setPositions(calcDefaults(currentFormat));
    setLayoutSaved(false);
  };

  // ── Printer state
  const [systemPrinters, setSystemPrinters] = useState<{ Name: string; PortName: string; DriverName: string }[]>([]);
  const [selectedSystemPrinter, setSelectedSystemPrinter] = useState("");
  const [usbPrinting, setUsbPrinting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const savedPrinter = loadDefaultPrinter();
    fetch("/api/system-printers")
      .then((r) => r.json())
      .then((printers: any[]) => {
        setSystemPrinters(printers);
        if (savedPrinter && printers.some((p) => p.Name === savedPrinter)) {
          setSelectedSystemPrinter(savedPrinter);
        } else {
          const zebra = printers.find((p) => p.DriverName?.toLowerCase().includes("zebra") || p.Name?.toLowerCase().includes("zebra"));
          if (zebra) setSelectedSystemPrinter(zebra.Name);
          else if (printers.length > 0) setSelectedSystemPrinter(printers[0].Name);
        }
      })
      .catch(() => {});
  }, []);

  const handlePrinterChange = (name: string) => { setSelectedSystemPrinter(name); saveDefaultPrinter(name); };

  // ── ZPL
  const zplCode = useMemo(() =>
    generateTraceZpl(currentFormat, elabDate, vencDate, product.item_name, dateFontMm, nameFontMm, copies, positions),
    [currentFormat, elabDate, vencDate, product.item_name, dateFontMm, nameFontMm, copies, positions]
  );

  const handleCopyZpl = () => { navigator.clipboard.writeText(zplCode); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const handleDownloadZPL = () => {
    const blob = new Blob([zplCode], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `trazabilidad_${product.sku}.zpl`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const handlePrint = async () => {
    if (!selectedSystemPrinter) { onShowToast?.("Selecciona una impresora", "error"); return; }
    setUsbPrinting(true);
    try {
      const res = await fetch("/api/print/usb", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zpl: zplCode, printerName: selectedSystemPrinter }),
      });
      const data = await res.json();
      if (res.ok) onShowToast?.(`✅ ${data.message}`, "success");
      else onShowToast?.(data.error || "Error de impresión", "error");
    } catch (e: any) { onShowToast?.("Error: " + e.message, "error"); }
    finally { setUsbPrinting(false); }
  };

  const isCustom = JSON.stringify(positions) !== JSON.stringify(calcDefaults(currentFormat));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm print:hidden">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[92vh] mx-4">
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-200 flex justify-between items-center bg-gradient-to-r from-slate-800 to-slate-900">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
              <Calendar className="w-4 h-4 text-amber-400" />
              <span>Trazabilidad: {product.sku}</span>
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5 truncate">{product.item_name}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1 flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content: 3 columns */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[460px]">
            {/* Col 1: Data inputs */}
            <div className="lg:col-span-3 border-r border-slate-100 p-4 bg-slate-50/70 flex flex-col gap-4 overflow-y-auto">
              {/* Caducidad warning */}
              {!hasCaducidad && (
                <div className="flex items-start gap-2 px-2.5 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                  <span className="text-amber-500 text-sm leading-none mt-0.5">⚠️</span>
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold text-amber-700">Sin caducidad configurada</p>
                    <p className="text-[9px] text-amber-600 mt-0.5">Ingresa días manualmente.</p>
                  </div>
                </div>
              )}

              {/* Dates */}
              <div>
                <h3 className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-2">Fechas</h3>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 px-2.5 py-2 bg-white rounded-lg border border-slate-200">
                    <Calendar className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[8px] font-semibold text-slate-400 uppercase">Elaboración</div>
                      <input type="date" value={toInputDate(elabDate)}
                        onChange={(e) => setElabDate(new Date(e.target.value + "T12:00:00"))}
                        className="w-full text-xs font-semibold text-slate-800 bg-transparent outline-none cursor-pointer" />
                    </div>
                    <span className="text-[10px] font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">{formatDDMMYYYY(elabDate)}</span>
                  </div>
                  {!hasCaducidad && (
                    <div className="flex items-center gap-2 px-2.5 py-2 bg-white rounded-lg border border-amber-200">
                      <span className="text-amber-400 text-xs flex-shrink-0">📅</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[8px] font-semibold text-amber-500 uppercase">Días de vida útil</div>
                        <input type="number" min={1} max={9999} value={manualDays}
                          onChange={(e) => setManualDays(Math.max(1, Number(e.target.value)))}
                          className="w-full text-xs font-semibold text-slate-800 bg-transparent outline-none" />
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-2 px-2.5 py-2 bg-white rounded-lg border border-slate-200">
                    <Calendar className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[8px] font-semibold text-slate-400 uppercase">Vencimiento</div>
                      <div className="text-xs font-semibold text-slate-800 mt-0.5">{formatDDMMYYYY(vencDate)}</div>
                    </div>
                    <span className="text-[9px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{expirationDays}d</span>
                  </div>
                </div>
              </div>

              {/* Font sizes */}
              <div>
                <h3 className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-2">Fuente</h3>
                <div className="space-y-1.5">
                  {[
                    { label: "Fechas", val: dateFontMm, set: setDateFontMm },
                    { label: "Nombre", val: nameFontMm, set: setNameFontMm },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white rounded-lg border border-slate-200">
                      <span className="text-[9px] text-slate-500 font-medium uppercase flex-1">{item.label}</span>
                      <button onClick={() => item.set(clampFont(item.val - 0.5))}
                        className="w-5 h-5 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 text-slate-600">
                        <Minus className="w-2.5 h-2.5" />
                      </button>
                      <span className="text-[10px] font-bold text-slate-700 w-8 text-center tabular-nums">{item.val.toFixed(1)}</span>
                      <button onClick={() => item.set(clampFont(item.val + 0.5))}
                        className="w-5 h-5 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 text-slate-600">
                        <Plus className="w-2.5 h-2.5" />
                      </button>
                      <span className="text-[7px] text-slate-400">mm</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Copies */}
              <div>
                <h3 className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Copias</h3>
                <input type="number" min={1} max={999} value={copies}
                  onChange={(e) => setCopies(Math.max(1, Number(e.target.value)))}
                  className="w-full rounded-md border border-slate-200 bg-white shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm p-2 text-slate-800 outline-none font-semibold" />
              </div>

              {/* Save / Reset */}
              <div className="mt-auto pt-2 space-y-1.5">
                {isCustom && (
                  <div className="space-y-1.5">
                    <button onClick={handleSaveLayout}
                      className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-semibold rounded-lg transition-colors ${
                        layoutSaved ? 'text-emerald-600 bg-emerald-50 border border-emerald-200'
                        : 'text-white bg-blue-600 hover:bg-blue-500 border border-blue-500 shadow-sm'}`}>
                      <span className="flex items-center gap-1.5">
                        {layoutSaved
                          ? <><Check className="w-3 h-3" /><span>Guardado ✓</span></>
                          : <><Save className="w-3 h-3" /><span>Guardar posiciones</span></>}
                      </span>
                    </button>
                    <button onClick={handleResetPositions}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] font-medium text-slate-500 hover:text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors">
                      <RotateCcw className="w-3 h-3" /><span>Restablecer</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Col 2: Interactive Preview */}
            <div className="lg:col-span-5 p-4 flex flex-col bg-white border-r border-slate-100">
              <h3 className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-3">
                Vista previa interactiva
              </h3>
              <div className="flex-1 flex items-center justify-center">
                <DraggableTracePreview
                  format={currentFormat}
                  positions={positions}
                  onPositionsChange={handlePositionsChange}
                  dateFontMm={dateFontMm}
                  nameFontMm={nameFontMm}
                  elabText={`ELAB: ${formatDDMMYYYY(elabDate)}`}
                  vencText={`VENC: ${formatDDMMYYYY(vencDate)}`}
                  productName={product.item_name}
                />
              </div>
              {currentFormat.labelsPerRow > 1 && (
                <div className="mt-2 px-2 py-1.5 bg-blue-50 border border-blue-200 rounded-lg text-center">
                  <p className="text-[9px] text-blue-600 font-medium">
                    <span>Formato: {currentFormat.labelsPerRow} columnas × {currentFormat.labelsPerColumn || 1} filas — se replicará en todas</span>
                  </p>
                </div>
              )}
            </div>

            {/* Col 3: Print Console */}
            <div className="lg:col-span-4 bg-slate-800 p-4 flex flex-col text-white">
              <div className="flex items-center gap-2 mb-3">
                <Code className="w-3.5 h-3.5 text-blue-400" />
                <h3 className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Consola de Impresión</h3>
              </div>

              {/* Format selector */}
              <div className="mb-2.5">
                <label className="block text-[9px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Formato</label>
                <select className="w-full rounded-md border border-slate-600 bg-slate-700 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm p-2 text-white outline-none cursor-pointer"
                  value={activeFormatId} onChange={(e) => setActiveFormatId(e.target.value)}>
                  {labelFormats.map((f) => (<option key={f.id} value={f.id}>{f.name}</option>))}
                </select>
              </div>

              {/* Printer selector */}
              {systemPrinters.length > 0 && (
                <div className="mb-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[9px] font-semibold text-slate-500 uppercase tracking-wider">Impresora</label>
                    {selectedSystemPrinter === loadDefaultPrinter() && (
                      <span className="text-[8px] text-emerald-400 font-medium">★ predeterminada</span>
                    )}
                  </div>
                  <select className="w-full rounded-md border border-slate-600 bg-slate-700 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm p-2 text-white outline-none cursor-pointer"
                    value={selectedSystemPrinter} onChange={(e) => handlePrinterChange(e.target.value)}>
                    {systemPrinters.map((p) => (<option key={p.Name} value={p.Name}>{p.Name} ({p.PortName})</option>))}
                  </select>
                </div>
              )}

              {/* Print & Download */}
              <div className="space-y-2 mb-3">
                <button onClick={handlePrint} disabled={usbPrinting || !selectedSystemPrinter}
                  className="w-full flex items-center justify-center px-4 py-2.5 outline-none rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-colors border border-emerald-500 shadow-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                  <Printer className="w-4 h-4 mr-2" />
                  <span>{usbPrinting ? "Enviando..." : "🖨️ Imprimir Trazabilidad"}</span>
                </button>
                <button onClick={handleDownloadZPL}
                  className="w-full flex items-center justify-center px-3 py-1.5 outline-none rounded-md bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium text-[11px] transition-colors border border-slate-600 cursor-pointer">
                  <Download className="w-3 h-3 mr-1.5" /><span>Descargar .ZPL</span>
                </button>
              </div>

              {/* ZPL Code */}
              <div className="flex-1 bg-slate-950 border border-slate-900 rounded-md p-2 overflow-hidden relative group min-h-[80px]">
                <pre className="text-[8px] text-emerald-400 font-mono whitespace-pre-wrap break-all h-full overflow-y-auto custom-scrollbar leading-relaxed">
                  {zplCode}
                </pre>
                <button onClick={handleCopyZpl}
                  className="absolute top-1 right-1 p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                  title="Copiar ZPL">
                  {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
              {copied && <p className="text-[10px] text-green-400 mt-0.5 text-right font-medium">¡Copiado!</p>}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-slate-200 bg-slate-50 flex justify-between items-center">
          <div className="text-[10px] text-slate-400">
            <span>{currentFormat.width}×{currentFormat.height}mm · {currentFormat.dpi} DPI · {currentFormat.labelsPerRow}col</span>
          </div>
          <button onClick={onClose}
            className="px-4 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors shadow-sm cursor-pointer">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
