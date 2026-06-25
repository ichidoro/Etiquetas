import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { X, Printer, Download, Copy, Check, Code, Minus, Plus, Calendar, Move, RotateCcw, Save, User, Settings2, Usb, Wifi, WifiOff } from "lucide-react";
import { Product, LabelFormat } from "../types";
import { isWebUSBSupported, getAlreadyPairedPrinters, requestUSBPrinter, sendZPLviaUSB, forgetUSBPrinter } from "../utils/webusb";
import { isRunningOnCloud, discoverBridgeUrl, fetchPrinters, sendPrintJob, recordPrint } from "../utils/printBridge";

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
  ispY: number;
  traceCodeY: number;
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

// ─── Traceability helpers ───────────────────────────────────────────────────
function getISOWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function getDayNumber(d: Date): string {
  const jsDay = d.getDay(); // 0=Sun, 1=Mon, ...
  // ISO: Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6, Sun=7
  return String(jsDay === 0 ? 7 : jsDay);
}

function buildTraceCode(elabDate: Date, operadorCodigo: string, lineaProceso: string): string {
  const week = String(getISOWeek(elabDate)).padStart(2, "0");
  const dayNum = getDayNumber(elabDate);
  const line = lineaProceso.trim() || "XX";
  return `S${week}-${dayNum}-${operadorCodigo}-${line}`;
}

// ─── ZPL generation (multi-column aware) ────────────────────────────────────
function generateTraceZpl(
  format: LabelFormat,
  elabDate: Date,
  vencDate: Date,
  productName: string,
  ispValue: string | undefined,
  traceCode: string,
  dateFontMm: number,
  nameFontMm: number,
  traceFontMm: number,
  copies: number,
  positions: TracePositions,
): string {
  const dpmm = format.dpi === 300 ? 12 : 8;
  const labelW = Math.round(format.width * dpmm);
  const labelH = Math.round(format.height * dpmm);
  const gapDots = Math.round(format.horizontalGap * dpmm);
  const marginL = Math.round(format.marginLeft * dpmm);
  const marginR = Math.round((format.marginRight || 0) * dpmm);

  const cols = format.labelsPerRow || 1;
  const rows = format.labelsPerColumn || 1;
  const vGap = Math.round((format.verticalGap || 2) * dpmm);

  // Total print width: left margin + labels + gaps + right margin
  const gridWidth = labelW * cols + gapDots * Math.max(0, cols - 1);
  const totalPw = marginL + gridWidth + marginR;

  const dateFontH = Math.round(dateFontMm * dpmm);
  const dateFontW = Math.round(dateFontH * 0.6);
  const nameFontH = Math.round(nameFontMm * dpmm);
  const nameFontW = Math.round(nameFontH * 0.6);
  const traceFontH = Math.round(traceFontMm * dpmm);
  const traceFontW = Math.round(traceFontH * 0.6);

  const elabStr = formatDDMMYYYY(elabDate);
  const vencStr = formatDDMMYYYY(vencDate);
  const hasIsp = ispValue && ispValue.trim().length > 0;

  let zpl = "^XA\n";
  zpl += `^PW${totalPw}\n`;
  // LL must account for multiple rows and margins
  const totalLL = Math.round((format.marginTop || 0) * dpmm) + rows * labelH + Math.max(0, rows - 1) * vGap + Math.round((format.marginBottom || 0) * dpmm);
  zpl += `^LL${totalLL}\n`;
  zpl += `~SD${format.darkness}\n`;
  zpl += `^PR${format.printSpeed}\n`;
  const shiftDots = Math.round(-(format.labelShift || 0) * dpmm);
  if (shiftDots !== 0) zpl += `^LS${shiftDots}\n`;
  // Label top (vertical offset correction)
  const topDots = Math.round((format.labelTop || 0) * dpmm);
  if (topDots !== 0) zpl += `^LT${topDots}\n`;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const colOffsetX = marginL + col * (labelW + gapDots);
      const rowOffsetY = row * (labelH + vGap);

      const y1 = rowOffsetY + Math.round(positions.elabY * dpmm);
      const y2 = rowOffsetY + Math.round(positions.vencY * dpmm);
      const y3 = rowOffsetY + Math.round(positions.nameY * dpmm);
      const y5 = rowOffsetY + Math.round(positions.traceCodeY * dpmm);

      const orientation = format.orientation || 'N';
      zpl += `^FO${colOffsetX},${y1}^FB${labelW},1,0,C,0^A0${orientation},${dateFontH},${dateFontW}^FDELAB: ${elabStr}^FS\n`;
      zpl += `^FO${colOffsetX},${y2}^FB${labelW},1,0,C,0^A0${orientation},${dateFontH},${dateFontW}^FDVENC: ${vencStr}^FS\n`;
      zpl += `^FO${colOffsetX},${y3}^FB${labelW},1,0,C,0^A0${orientation},${nameFontH},${nameFontW}^FD${productName.substring(0, 40)}^FS\n`;

      if (hasIsp) {
        const y4 = rowOffsetY + Math.round(positions.ispY * dpmm);
        zpl += `^FO${colOffsetX},${y4}^FB${labelW},1,0,C,0^A0${orientation},${nameFontH},${nameFontW}^FDISP: ${ispValue!.trim()}^FS\n`;
      }

      zpl += `^FO${colOffsetX},${y5}^FB${labelW},1,0,C,0^A0${orientation},${traceFontH},${traceFontW}^FD${traceCode}^FS\n`;
    }
  }

  zpl += `^PQ${copies}\n`;
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
  traceFontMm: number;
  elabText: string;
  vencText: string;
  productName: string;
  ispText: string | null;
  traceCode: string;
}

function DraggableTracePreview({
  format, positions, onPositionsChange, dateFontMm, nameFontMm, traceFontMm,
  elabText, vencText, productName, ispText, traceCode,
}: DragPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const dragStartRef = useRef({ mouseY: 0, startY: 0 });

  const cols = format.labelsPerRow || 1;
  const rows = format.labelsPerColumn || 1;
  const gapMm = format.horizontalGap || 2;
  const vGapMm = format.verticalGap || 2;

  const paperWidthMm =
    format.marginLeft +
    cols * format.width +
    Math.max(0, cols - 1) * gapMm +
    format.marginRight;

  const paperHeightMm =
    format.marginTop +
    rows * format.height +
    Math.max(0, rows - 1) * vGapMm +
    format.marginBottom;

  const [scale, setScale] = useState(6);

  useEffect(() => {
    if (!containerRef.current || paperWidthMm === 0) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      const h = entries[0].contentRect.height;
      const sx = (w - 40) / paperWidthMm;
      const sy = (h - 40) / (paperHeightMm || 1);
      setScale(Math.max(1.5, Math.min(sx, sy, 32)));
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [paperWidthMm, paperHeightMm]);

  const mmToPx = (mm: number) => mm * scale;

  const singleW = format.width * scale;
  const singleH = format.height * scale;

  const pML = format.marginLeft * scale;
  const pMR = format.marginRight * scale;
  const pMT = format.marginTop * scale;
  const pMB = format.marginBottom * scale;
  const usableW = singleW - pML - pMR;
  const usableH = singleH - pMT - pMB;

  const handleMouseDown = useCallback((id: string, e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(id);
    const yMm = id === "elab" ? positions.elabY
      : id === "venc" ? positions.vencY
      : id === "name" ? positions.nameY
      : id === "isp" ? positions.ispY
      : positions.traceCodeY;
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
      const rounded = Math.round(newY * 10) / 10;
      if (dragging === "elab") onPositionsChange({ ...positions, elabY: rounded });
      else if (dragging === "venc") onPositionsChange({ ...positions, vencY: rounded });
      else if (dragging === "name") onPositionsChange({ ...positions, nameY: rounded });
      else if (dragging === "isp") onPositionsChange({ ...positions, ispY: rounded });
      else onPositionsChange({ ...positions, traceCodeY: rounded });
    };
    const handleUp = () => setDragging(null);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragging, positions, scale, format, onPositionsChange]);

  const elements: { id: string; y: number; fontSize: number; text: string; color: string }[] = [
    { id: "elab", y: positions.elabY, fontSize: dateFontMm, text: elabText, color: "blue" },
    { id: "venc", y: positions.vencY, fontSize: dateFontMm, text: vencText, color: "red" },
    { id: "name", y: positions.nameY, fontSize: nameFontMm, text: productName, color: "amber" },
  ];
  if (ispText) {
    elements.push({ id: "isp", y: positions.ispY, fontSize: nameFontMm, text: ispText, color: "emerald" });
  }
  elements.push({ id: "trace", y: positions.traceCodeY, fontSize: traceFontMm, text: traceCode, color: "purple" });

  const zebraFontRatio = 0.70;

  const colorMap: Record<string, { border: string; bg: string }> = {
    blue: { border: "border-blue-400", bg: "bg-blue-50" },
    red: { border: "border-red-400", bg: "bg-red-50" },
    amber: { border: "border-amber-400", bg: "bg-amber-50" },
    emerald: { border: "border-emerald-400", bg: "bg-emerald-50" },
    purple: { border: "border-purple-400", bg: "bg-purple-50" },
  };

  return (
    <div className="w-full h-full flex flex-col">
      <div
        ref={containerRef}
        className="flex-1 bg-slate-500/5 border border-slate-500/10 rounded-lg flex items-center justify-center p-5 min-h-[220px] overflow-hidden"
      >
        <div className="relative" style={{ width: `${mmToPx(paperWidthMm) + 20}px`, height: `${mmToPx(paperHeightMm) + 20}px`, paddingTop: '20px', paddingLeft: '20px' }}>
          {/* Horizontal Ruler (Top) */}
          <div className="absolute top-0 left-[20px] h-[20px] overflow-visible" style={{ width: mmToPx(paperWidthMm) }}>
            <svg width={mmToPx(paperWidthMm)} height="20" className="overflow-visible select-none">
              {Array.from({ length: Math.ceil(paperWidthMm) + 1 }).map((_, mm) => {
                if (mm > paperWidthMm) return null;
                const x = mm * scale;
                let h = 3;
                let showLabel = false;
                if (mm % 5 === 0) { h = 8; showLabel = true; }
                return (
                  <g key={`h-tick-${mm}`}>
                    <line x1={x} y1={20} x2={x} y2={20 - h} stroke="#94a3b8" strokeWidth="1" />
                    {showLabel && (
                      <text x={x} y={9} textAnchor="middle" fontSize="7px" fill="#64748b" fontWeight="bold">{mm}</text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Vertical Ruler (Left) */}
          <div className="absolute top-[20px] left-0 w-[20px] overflow-visible" style={{ height: mmToPx(paperHeightMm) }}>
            <svg width="20" height={mmToPx(paperHeightMm)} className="overflow-visible select-none">
              {Array.from({ length: Math.ceil(paperHeightMm) + 1 }).map((_, mm) => {
                if (mm > paperHeightMm) return null;
                const y = mm * scale;
                let w = 3;
                let showLabel = false;
                if (mm % 5 === 0) { w = 8; showLabel = true; }
                return (
                  <g key={`v-tick-${mm}`}>
                    <line x1={20} y1={y} x2={20 - w} y2={y} stroke="#94a3b8" strokeWidth="1" />
                    {showLabel && (
                      <text x={9} y={y + 3} textAnchor="end" fontSize="7px" fill="#64748b" fontWeight="bold">{mm}</text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Backing paper */}
          <div
            className="bg-[#e0e0e0] absolute shadow-inner border border-slate-300 overflow-visible rounded-sm"
            style={{
              left: '20px',
              top: '20px',
              width: `${mmToPx(paperWidthMm)}px`,
              height: `${mmToPx(paperHeightMm)}px`,
            }}
          >
            {Array.from({ length: rows }).map((_, row) =>
              Array.from({ length: cols }).map((_, col) => {
                const labelLeftPx = mmToPx(format.marginLeft + col * (format.width + gapMm));
                const labelTopPx = mmToPx(format.marginTop + row * (format.height + vGapMm));
                const isFirstLabel = row === 0 && col === 0;

                return (
                  <div key={`${row}-${col}`}
                    className={`absolute bg-white border ${isFirstLabel ? 'border-blue-300 shadow-md ring-1 ring-blue-100' : 'border-slate-200'} rounded-sm overflow-hidden`}
                    style={{ left: `${labelLeftPx}px`, top: `${labelTopPx}px`, width: singleW, height: singleH }}>
                    {isFirstLabel && (
                      <div className="absolute border border-dashed border-blue-200/50 pointer-events-none"
                        style={{ left: pML, top: pMT, width: usableW, height: usableH }} />
                    )}

                    {elements.map((el) => {
                      const fontPx = el.fontSize * scale * zebraFontRatio;
                      const yPx = el.y * scale;
                      const isActive = dragging === el.id;
                      const colors = colorMap[el.color] || colorMap.blue;

                      return (
                        <div key={el.id}
                          onMouseDown={isFirstLabel ? (e) => handleMouseDown(el.id, e) : undefined}
                          className={`absolute text-center font-bold text-slate-800 truncate select-none ${
                            isFirstLabel ? `cursor-ns-resize border border-transparent hover:${colors.border} ${isActive ? colors.border + ' ' + colors.bg : ''}` : ''
                          }`}
                          style={{
                            left: 0, top: yPx - pMT, width: singleW,
                            fontSize: Math.max(6, fontPx),
                            lineHeight: `${Math.max(6, fontPx)}px`,
                          }}
                          title={isFirstLabel ? `Arrastra: ${el.id.toUpperCase()}` : undefined}
                        >
                          {el.text}
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
      <div className="text-[9px] text-slate-400 flex items-center gap-1">
        <Move className="w-3 h-3" />
        <span>Arrastra los textos en la 1ª etiqueta — se replica en todas</span>
      </div>
    </div>
  );
}

// ─── Empleado type ──────────────────────────────────────────────────────────
interface Empleado {
  id: number;
  codigo: string;
  nombre: string;
  linea_proceso: string | null;
  labor: string | null;
}

// ─── Component ──────────────────────────────────────────────────────────────
interface TracePrintModalProps {
  product: Product;
  labelFormats: LabelFormat[];
  activeFormatId: string;
  theme: 'dark' | 'light' | 'glass';
  onChangeTheme: (theme: 'dark' | 'light' | 'glass') => void;
  onClose: () => void;
  onShowToast?: (message: string, type: "success" | "error") => void;
}

export function TracePrintModal({
  product, labelFormats, activeFormatId: initialFormatId, theme, onChangeTheme, onClose, onShowToast,
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
  const [traceFontMm, setTraceFontMm] = useState(3);
  const [copies, setCopies] = useState(1);
  const clampFont = (v: number) => Math.max(1.5, Math.min(8, Math.round(v * 2) / 2));

  // ── Operador state
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [selectedOperadorId, setSelectedOperadorId] = useState<number | null>(null);
  const [lineaProceso, setLineaProceso] = useState("");
  const [useCustomLine, setUseCustomLine] = useState(false);

  const selectedOperador = empleados.find((e) => e.id === selectedOperadorId) || null;

  // Fetch empleados
  useEffect(() => {
    fetch("/api/empleados")
      .then((r) => r.json())
      .then((data: Empleado[]) => setEmpleados(data))
      .catch(() => {});
  }, []);

  // Auto-fill line when operator changes
  useEffect(() => {
    if (selectedOperador) {
      if (!useCustomLine) {
        setLineaProceso(selectedOperador.linea_proceso || "");
      }
      // If operator has no line, force custom mode
      if (!selectedOperador.linea_proceso) {
        setUseCustomLine(true);
      }
    }
  }, [selectedOperadorId, selectedOperador, useCustomLine]);

  // Build trace code
  const traceCode = useMemo(() => {
    if (!selectedOperador) return "---";
    return buildTraceCode(elabDate, selectedOperador.codigo, lineaProceso);
  }, [elabDate, selectedOperador, lineaProceso]);

  // ISP
  const hasIsp = product.isp && product.isp.trim().length > 0;
  const ispText = hasIsp ? `ISP: ${product.isp!.trim()}` : null;

  // ── Positions (mm from top)
  const calcDefaults = useCallback((fmt: LabelFormat): TracePositions => {
    const usableH = fmt.height - fmt.marginTop - fmt.marginBottom;
    const lines = hasIsp ? 5 : 4;
    const spacing = usableH / (lines + 1);
    return {
      elabY: fmt.marginTop + spacing - dateFontMm / 2,
      vencY: fmt.marginTop + spacing * 2 - dateFontMm / 2,
      nameY: fmt.marginTop + spacing * 3 - nameFontMm / 2,
      ispY: hasIsp ? fmt.marginTop + spacing * 4 - nameFontMm / 2 : fmt.marginTop + spacing * 3.5,
      traceCodeY: fmt.marginTop + spacing * (hasIsp ? 5 : 4) - traceFontMm / 2,
    };
  }, [dateFontMm, nameFontMm, traceFontMm, hasIsp]);

  const [positions, setPositions] = useState<TracePositions>(() => {
    const saved = loadTraceLayout(initialFormatId);
    // If saved layout doesn't have new fields, recalculate
    if (saved && saved.ispY !== undefined && saved.traceCodeY !== undefined) return saved;
    return calcDefaults(currentFormat);
  });
  const [layoutSaved, setLayoutSaved] = useState(false);

  // Load saved layout when format changes
  useEffect(() => {
    const saved = loadTraceLayout(activeFormatId);
    if (saved && saved.ispY !== undefined && saved.traceCodeY !== undefined) {
      setPositions(saved);
    } else {
      setPositions(calcDefaults(currentFormat));
    }
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

  // Theme state

  const themeBg = 
    theme === 'dark' ? 'bg-slate-900 text-slate-100 border border-slate-800 shadow-2xl' :
    theme === 'glass' ? 'bg-slate-950/75 backdrop-blur-md text-slate-100 border border-white/10 shadow-[0_8px_32px_0_rgba(0,0,0,0.37)]' :
    'bg-slate-50 text-slate-800 border border-slate-200 shadow-2xl';

  const col1Bg = 
    theme === 'dark' ? 'bg-slate-950/40 border-r border-slate-800' :
    theme === 'glass' ? 'bg-white/5 border-r border-white/5' :
    'bg-slate-100/70 border-r border-slate-200';

  const col2Bg = 
    theme === 'dark' ? 'bg-slate-900/60' :
    theme === 'glass' ? 'bg-white/10' :
    'bg-white';

  const col3Bg = 
    theme === 'dark' ? 'bg-slate-950 border-t border-slate-900' :
    theme === 'glass' ? 'bg-black/40 border-t border-white/5' :
    'bg-slate-850 border-t border-slate-200 text-white';

  const inputClass = theme === 'light'
    ? "w-full rounded-md border border-slate-350 bg-white shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm p-2 text-slate-800 outline-none cursor-pointer"
    : "w-full rounded-md border border-slate-700 bg-slate-800 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm p-2 text-white outline-none cursor-pointer";

  const subCardClass = theme === 'light'
    ? 'bg-white border-slate-200 text-slate-800 border'
    : 'bg-slate-800/40 border-slate-800 text-slate-200 border';

  // ── Printer state
  const [systemPrinters, setSystemPrinters] = useState<{ Name: string; PortName: string; DriverName: string }[]>([]);
  const [selectedSystemPrinter, setSelectedSystemPrinter] = useState("");
  const [usbPrinting, setUsbPrinting] = useState(false);
  const [copied, setCopied] = useState(false);

  // Print Bridge state
  const [localBridgeAvailable, setLocalBridgeAvailable] = useState(false);
  const [bridgeUrl, setBridgeUrl] = useState<string | null>(null);
  const [onCloud] = useState(isRunningOnCloud());
  const [bridgeChecked, setBridgeChecked] = useState(false);

  // WebUSB state (last resort fallback)
  const [webUsbDevice, setWebUsbDevice] = useState<USBDevice | null>(null);
  const [webUsbSupported] = useState(isWebUSBSupported());
  const [useWebUsb, setUseWebUsb] = useState(false);

  useEffect(() => {
    const savedPrinter = loadDefaultPrinter();

    const loadPrinters = async () => {
      // Step 1: If on Cloud, discover bridge URL
      let discoveredUrl: string | null = null;
      if (onCloud) {
        discoveredUrl = await discoverBridgeUrl();
        setBridgeUrl(discoveredUrl);
        setLocalBridgeAvailable(!!discoveredUrl);
      }
      setBridgeChecked(true);

      // Step 2: Fetch printers (from discovered bridge or same-server)
      const printers = await fetchPrinters(!!discoveredUrl, discoveredUrl);
      setSystemPrinters(printers);

      if (printers.length > 0) {
        // Found printers — select one
        if (savedPrinter && printers.some((p) => p.Name === savedPrinter)) {
          setSelectedSystemPrinter(savedPrinter);
        } else {
          const zebra = printers.find((p) => p.DriverName?.toLowerCase().includes("zebra") || p.Name?.toLowerCase().includes("zebra"));
          if (zebra) setSelectedSystemPrinter(zebra.Name);
          else setSelectedSystemPrinter(printers[0].Name);
        }
      } else if (onCloud && !discoveredUrl) {
        // On Cloud, no local server → try WebUSB as last resort
        if (webUsbSupported) {
          setUseWebUsb(true);
          const paired = await getAlreadyPairedPrinters();
          if (paired.length > 0) setWebUsbDevice(paired[0]);
        }
      }
    };

    loadPrinters();
  }, []);

  const handlePrinterChange = (name: string) => { setSelectedSystemPrinter(name); saveDefaultPrinter(name); };

  const cols = currentFormat.labelsPerRow || 1;
  const calculatedRows = Math.ceil(copies / cols);
  const totalPhysicalLabels = calculatedRows * cols;
  const isExactMultiple = copies % cols === 0;

  // ── ZPL
  const zplCode = useMemo(() =>
    generateTraceZpl(currentFormat, elabDate, vencDate, product.item_name, product.isp, traceCode, dateFontMm, nameFontMm, traceFontMm, calculatedRows, positions),
    [currentFormat, elabDate, vencDate, product.item_name, product.isp, traceCode, dateFontMm, nameFontMm, traceFontMm, calculatedRows, positions]
  );

  const handleCopyZpl = () => { navigator.clipboard.writeText(zplCode); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const handleDownloadZPL = () => {
    const blob = new Blob([zplCode], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `trazabilidad_${product.sku}.zpl`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const handlePrint = async () => {
    if (!selectedOperador) { onShowToast?.("Selecciona un operador", "error"); return; }
    if (!lineaProceso.trim()) { onShowToast?.("Ingresa la línea de proceso", "error"); return; }

    if (useWebUsb) {
      // WebUSB fallback
      if (!webUsbDevice) { onShowToast?.("Conecta una impresora USB primero", "error"); return; }
      setUsbPrinting(true);
      try {
        await sendZPLviaUSB(webUsbDevice, zplCode);
        onShowToast?.(`✅ ZPL enviado a ${webUsbDevice.productName || "impresora USB"} vía WebUSB`, "success");
      } catch (e: any) {
        onShowToast?.(e.message || "Error WebUSB", "error");
        setWebUsbDevice(null);
      } finally { setUsbPrinting(false); }
    } else {
      // Server-side or Bridge printing
      if (!selectedSystemPrinter) { onShowToast?.("Selecciona una impresora", "error"); return; }
      setUsbPrinting(true);
      const result = await sendPrintJob(zplCode, selectedSystemPrinter, localBridgeAvailable, bridgeUrl);
      recordPrint({
        productName: product.item_name,
        productSku: product.sku,
        printerName: selectedSystemPrinter,
        mode: isRunningOnCloud() ? 'cloud' : 'local',
        copies: 1,
        status: result.ok ? 'success' : 'error',
        details: result.ok ? undefined : result.message,
      });
      if (result.ok) onShowToast?.(`✅ ${result.message}`, "success");
      else onShowToast?.(result.message, "error");
      setUsbPrinting(false);
    }
  };

  const handleConnectWebUsb = async () => {
    try {
      const device = await requestUSBPrinter();
      if (device) {
        setWebUsbDevice(device);
        onShowToast?.(`✅ Conectada: ${device.productName || "Impresora USB"}`, "success");
      }
    } catch (e: any) {
      onShowToast?.(e.message || "Error al conectar", "error");
    }
  };

  const handleDisconnectWebUsb = async () => {
    await forgetUSBPrinter();
    setWebUsbDevice(null);
  };

  const canPrint = useWebUsb
    ? !!webUsbDevice && !!selectedOperador && !!lineaProceso.trim()
    : !!selectedSystemPrinter && !!selectedOperador && !!lineaProceso.trim();
  const isCustom = JSON.stringify(positions) !== JSON.stringify(calcDefaults(currentFormat));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm print:hidden">
      <div className={`rounded-xl overflow-hidden flex flex-col max-h-[92vh] mx-4 w-full max-w-5xl ${themeBg}`}>
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-700/50 flex justify-between items-center bg-gradient-to-r from-slate-800 to-slate-900">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
              <Calendar className="w-4 h-4 text-amber-400" />
              <span>Trazabilidad: {product.sku}</span>
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5 truncate">{product.item_name}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 bg-slate-700/60 p-0.5 rounded-lg border border-slate-600/40">
              {(['dark', 'light', 'glass'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    onChangeTheme(t);
                  }}
                  className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase transition-all cursor-pointer ${
                    theme === t
                      ? 'bg-blue-600 text-white shadow'
                      : 'text-slate-300 hover:text-white hover:bg-slate-700/40'
                  }`}
                >
                  {t === 'glass' ? 'Vidrio' : t === 'dark' ? 'Oscuro' : 'Claro'}
                </button>
              ))}
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1 flex-shrink-0 cursor-pointer">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content: 2-row layout */}
        <div className="flex-1 overflow-y-auto">
          {/* ── TOP ROW: inputs (left ~35%) + preview (right ~65%) ── */}
          <div className="grid grid-cols-1 lg:grid-cols-12">
            {/* Left: Data inputs */}
            <div className={`lg:col-span-4 p-4 flex flex-col gap-3 overflow-y-auto ${col1Bg}`}>
              {/* Caducidad warning */}
              {!hasCaducidad && (
                <div className="flex items-start gap-2 px-2.5 py-2 bg-amber-50/10 border border-amber-500/20 rounded-lg">
                  <span className="text-amber-500 text-sm leading-none mt-0.5">⚠️</span>
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold text-amber-500">Sin caducidad configurada</p>
                    <p className="text-[9px] text-amber-600 mt-0.5">Ingresa días manualmente.</p>
                  </div>
                </div>
              )}

              {/* Dates */}
              <div>
                <h3 className={`text-[9px] font-bold uppercase tracking-widest mb-2 ${theme === 'light' ? 'text-slate-400' : 'text-slate-500'}`}>Fechas</h3>
                <div className="space-y-2">
                  <div className={`flex items-center gap-2 px-2.5 py-2 rounded-lg ${subCardClass}`}>
                    <Calendar className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className={`text-[8px] font-semibold uppercase ${theme === 'light' ? 'text-slate-400' : 'text-slate-500'}`}>Elaboración</div>
                      <label htmlFor="trace-date" className="sr-only">Fecha de elaboración</label>
                      <input type="date" id="trace-date" aria-label="Fecha de elaboración" value={toInputDate(elabDate)}
                        onChange={(e) => setElabDate(new Date(e.target.value + "T12:00:00"))}
                        className={`w-full text-xs font-semibold bg-transparent outline-none cursor-pointer ${
                          theme === 'light' ? 'text-slate-800' : 'text-white'
                        }`} />
                    </div>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-600/10 text-blue-400">{formatDDMMYYYY(elabDate)}</span>
                  </div>
                  {!hasCaducidad && (
                    <div className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border-amber-500/20 ${subCardClass}`}>
                      <span className="text-amber-400 text-xs flex-shrink-0">📅</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[8px] font-semibold text-amber-500 uppercase">Días de vida útil</div>
                        <label htmlFor="trace-expiry-days" className="sr-only">Días de caducidad</label>
                        <input type="number" id="trace-expiry-days" aria-label="Días de caducidad" min={1} max={9999} value={manualDays}
                          onChange={(e) => setManualDays(Math.max(1, Number(e.target.value)))}
                          className={`w-full text-xs font-semibold bg-transparent outline-none ${
                            theme === 'light' ? 'text-slate-800' : 'text-white'
                          }`} />
                      </div>
                    </div>
                  )}
                  <div className={`flex items-center gap-2 px-2.5 py-2 rounded-lg ${subCardClass}`}>
                    <Calendar className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className={`text-[8px] font-semibold uppercase ${theme === 'light' ? 'text-slate-400' : 'text-slate-500'}`}>Vencimiento</div>
                      <div className="text-xs font-semibold mt-0.5">{formatDDMMYYYY(vencDate)}</div>
                    </div>
                    <span className="text-[9px] bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded">{expirationDays}d</span>
                  </div>
                </div>
              </div>

              {/* ISP info */}
              {hasIsp && (
                <div className="flex items-center gap-2 px-2.5 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                  <span className="text-emerald-500 text-sm flex-shrink-0">🏷️</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[8px] font-semibold text-emerald-500 uppercase">ISP del producto</div>
                    <div className="text-xs font-bold text-emerald-400">{product.isp}</div>
                  </div>
                </div>
              )}

              {/* ── Operador + Línea de Proceso ── */}
              <div>
                <h3 className={`text-[9px] font-bold uppercase tracking-widest mb-2 flex items-center gap-1 ${theme === 'light' ? 'text-slate-400' : 'text-slate-500'}`}>
                  <User className="w-3 h-3" />
                  Operador y Línea
                </h3>
                <div className="space-y-2">
                  {/* Operator selector */}
                  <div className={`px-2.5 py-2 rounded-lg ${subCardClass}`}>
                    <div className={`text-[8px] font-semibold uppercase mb-1 ${theme === 'light' ? 'text-slate-400' : 'text-slate-500'}`}><label htmlFor="trace-operator">Operador</label></div>
                    <select
                      id="trace-operator"
                      aria-label="Seleccionar operador"
                      value={selectedOperadorId ?? ""}
                      onChange={(e) => {
                        const id = Number(e.target.value);
                        setSelectedOperadorId(id || null);
                        setUseCustomLine(false);
                      }}
                      className={`w-full text-xs font-semibold bg-transparent outline-none cursor-pointer ${
                        theme === 'light' ? 'text-slate-800' : 'text-white'
                      }`}
                    >
                      <option value="" className={theme === 'light' ? 'text-slate-800' : 'bg-slate-900 text-white'}>— Seleccionar operador —</option>
                      {empleados.map((emp) => (
                        <option key={emp.id} value={emp.id} className={theme === 'light' ? 'text-slate-800' : 'bg-slate-900 text-white'}>
                          {emp.codigo} - {emp.nombre}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Line de proceso */}
                  {selectedOperador && (
                    <div className={`px-2.5 py-2 rounded-lg ${subCardClass}`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className={`text-[8px] font-semibold uppercase ${theme === 'light' ? 'text-slate-400' : 'text-slate-500'}`}>Línea de proceso</div>
                        {selectedOperador.linea_proceso && (
                          <label className="flex items-center gap-1 cursor-pointer">
                            <input
                              type="checkbox"
                              id="trace-custom-line"
                              aria-label="Línea personalizada"
                              checked={useCustomLine}
                              onChange={(e) => {
                                  setUseCustomLine(e.target.checked);
                                  if (!e.target.checked && selectedOperador.linea_proceso) {
                                    setLineaProceso(selectedOperador.linea_proceso);
                                  }
                              }}
                              className="w-3 h-3 rounded border-slate-350 text-blue-600 focus:ring-blue-500"
                            />
                            <span className={`text-[8px] ${theme === 'light' ? 'text-slate-500' : 'text-slate-400'}`}>Cambiar línea</span>
                          </label>
                        )}
                      </div>
                      {useCustomLine || !selectedOperador.linea_proceso ? (
                        <input
                          type="text"
                          id="trace-custom-text"
                          aria-label="Texto línea personalizada"
                          value={lineaProceso}
                          onChange={(e) => setLineaProceso(e.target.value)}
                          placeholder="Ej: L1, L2, L3..."
                          className={`w-full text-xs font-semibold rounded px-2 py-1 outline-none border ${
                            theme === 'light' 
                              ? 'bg-slate-50 border-slate-200 text-slate-800 focus:border-blue-400' 
                              : 'bg-slate-800/60 border-slate-800 text-white focus:border-blue-500'
                          }`}
                        />
                      ) : (
                        <div className="text-xs font-bold flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                          <span>{lineaProceso || "Sin línea asignada"}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* No operator warning */}
                  {!selectedOperador && (
                    <div className="flex items-start gap-2 px-2.5 py-2 bg-red-500/10 border border-red-500/20 rounded-lg">
                      <span className="text-red-400 text-sm leading-none mt-0.5">⚠️</span>
                      <p className="text-[9px] text-red-450 font-medium">Operador obligatorio para imprimir</p>
                    </div>
                  )}

                  {/* Trace code preview */}
                  {selectedOperador && (
                    <div className="px-2.5 py-2 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                      <div className="text-[8px] font-semibold text-purple-400 uppercase mb-1">Código de trazabilidad</div>
                      <div className="text-sm font-bold text-purple-400 tracking-wide font-mono">{traceCode}</div>
                      <div className="text-[8px] text-purple-500 mt-1">
                        S{String(getISOWeek(elabDate)).padStart(2, "0")}=Semana · {getDayNumber(elabDate)}=Día · {selectedOperador.codigo}=Op · {lineaProceso || "XX"}=Línea
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Font sizes */}
              <div>
                <h3 className={`text-[9px] font-bold uppercase tracking-widest mb-2 ${theme === 'light' ? 'text-slate-400' : 'text-slate-500'}`}>Fuente</h3>
                <div className="space-y-1.5">
                  {[
                    { label: "Fechas", val: dateFontMm, set: setDateFontMm },
                    { label: "Nombre", val: nameFontMm, set: setNameFontMm },
                    { label: "Código", val: traceFontMm, set: setTraceFontMm },
                  ].map((item) => (
                    <div key={item.label} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg ${subCardClass}`}>
                      <span className={`text-[9px] font-medium uppercase flex-1 ${theme === 'light' ? 'text-slate-500' : 'text-slate-400'}`}>{item.label}</span>
                      <button onClick={() => item.set(clampFont(item.val - 0.5))}
                        className={`w-5 h-5 flex items-center justify-center rounded transition-colors cursor-pointer ${
                          theme === 'light' ? 'bg-slate-100 hover:bg-slate-200 text-slate-650' : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
                        }`}>
                        <Minus className="w-2.5 h-2.5" />
                      </button>
                      <span className="text-[10px] font-bold w-8 text-center tabular-nums">{item.val.toFixed(1)}</span>
                      <button onClick={() => item.set(clampFont(item.val + 0.5))}
                        className={`w-5 h-5 flex items-center justify-center rounded transition-colors cursor-pointer ${
                          theme === 'light' ? 'bg-slate-100 hover:bg-slate-200 text-slate-650' : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
                        }`}>
                        <Plus className="w-2.5 h-2.5" />
                      </button>
                      <span className="text-[7px] opacity-50">mm</span>
                    </div>
                  ))}
                </div>
              </div>



              {/* Save / Reset */}
              <div className="mt-auto pt-2 space-y-1.5">
                {isCustom && (
                  <div className="space-y-1.5">
                    <button onClick={handleSaveLayout}
                      className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-semibold rounded-lg transition-colors cursor-pointer ${
                        layoutSaved ? 'text-emerald-600 bg-emerald-50/10 border border-emerald-500/20'
                        : 'text-white bg-blue-600 hover:bg-blue-500 border border-blue-500 shadow-sm'}`}>
                      <span className="flex items-center gap-1.5">
                        {layoutSaved
                          ? <><Check className="w-3 h-3" /><span>Guardado ✓</span></>
                          : <><Save className="w-3 h-3" /><span>Guardar posiciones</span></>}
                      </span>
                    </button>
                    <button onClick={handleResetPositions}
                      className={`w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] font-medium border rounded-lg transition-colors cursor-pointer ${
                        theme === 'light'
                          ? 'text-slate-500 hover:text-slate-700 bg-white border-slate-200 hover:bg-slate-50'
                          : 'text-slate-400 hover:text-slate-200 bg-slate-800/40 border-slate-850 hover:bg-slate-800'
                      }`}>
                      <RotateCcw className="w-3 h-3" /><span>Restablecer</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Interactive Preview */}
            <div className={`lg:col-span-8 p-4 flex flex-col ${col2Bg}`}>
              <h3 className={`text-[9px] font-bold uppercase tracking-widest mb-3 ${theme === 'light' ? 'text-slate-400' : 'text-slate-500'}`}>
                Vista previa interactiva
              </h3>
              <div className="flex-1 w-full h-full flex items-center justify-center">
                <DraggableTracePreview
                  format={currentFormat}
                  positions={positions}
                  onPositionsChange={handlePositionsChange}
                  dateFontMm={dateFontMm}
                  nameFontMm={nameFontMm}
                  traceFontMm={traceFontMm}
                  elabText={`ELAB: ${formatDDMMYYYY(elabDate)}`}
                  vencText={`VENC: ${formatDDMMYYYY(vencDate)}`}
                  productName={product.item_name}
                  ispText={ispText}
                  traceCode={traceCode}
                />
              </div>
              {currentFormat.labelsPerRow > 1 && (
                <div className={`mt-2 px-2 py-1.5 border rounded-lg text-center ${
                  theme === 'light' ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                }`}>
                  <p className="text-[9px] font-medium">
                    <span>Formato: {currentFormat.labelsPerRow} columnas × {currentFormat.labelsPerColumn || 1} filas — se replicará en todas</span>
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── BOTTOM ROW: full-width print console ── */}
        <div className={`p-4 flex-shrink-0 border-t ${col3Bg}`}>
          <div className="flex items-center gap-2 mb-3">
            <Code className={`w-3.5 h-3.5 ${theme === 'light' ? 'text-blue-600' : 'text-blue-450'}`} />
            <h3 className={`text-[9px] font-bold uppercase tracking-widest ${theme === 'light' ? 'text-slate-550 font-bold' : 'text-slate-400'}`}>Consola de Impresión</h3>
            {onCloud && bridgeChecked && (
              localBridgeAvailable ? (
                <span className="ml-auto flex items-center gap-1 text-[8px] font-semibold text-emerald-400 bg-emerald-900/30 px-2 py-0.5 rounded-full">
                  <Wifi className="w-3 h-3" /> Agente local conectado
                </span>
              ) : (
                <span className="ml-auto flex items-center gap-1 text-[8px] font-semibold text-amber-400 bg-amber-900/30 px-2 py-0.5 rounded-full">
                  <WifiOff className="w-3 h-3" /> Sin agente local
                </span>
              )
            )}
          </div>

          {/* Controls row: format, copies, printer */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3">
            {/* Format selector */}
            <div>
              <label htmlFor="trace-format" className={`block text-[9px] font-semibold uppercase tracking-wider mb-1 ${theme === 'light' ? 'text-slate-500' : 'text-slate-400'}`}>Formato</label>
              <select id="trace-format" aria-label="Formato de etiqueta" className={inputClass}
                value={activeFormatId} onChange={(e) => setActiveFormatId(e.target.value)}>
                {labelFormats.map((f) => (<option key={f.id} value={f.id}>{f.name}</option>))}
              </select>
            </div>

            {/* Copies selector */}
            <div>
              <label htmlFor="trace-copies" className={`block text-[9px] font-semibold uppercase tracking-wider mb-1 ${theme === 'light' ? 'text-slate-500' : 'text-slate-400'}`}>¿Cuántas etiquetas desea imprimir?</label>
              <input type="number" id="trace-copies" aria-label="Cantidad de copias" min={1} max={999} value={copies}
                onChange={(e) => setCopies(Math.max(1, Number(e.target.value)))}
                className={inputClass} />
              {cols > 1 && (
                <div className="mt-1.5 text-[9px] leading-snug">
                  {isExactMultiple ? (
                    <span className="text-emerald-500 font-medium">✅ Equivale exactamente a {calculatedRows} {calculatedRows === 1 ? 'fila completa' : 'filas completas'}.</span>
                  ) : (
                    <span className={theme === 'light' ? 'text-slate-500' : 'text-slate-400'}>
                      💡 Se imprimirán {calculatedRows} filas (= {totalPhysicalLabels} etiquetas en total) para cubrir las {copies} solicitadas. <strong className={theme === 'light' ? 'text-blue-600' : 'text-blue-400'}>Te sugerimos imprimir {totalPhysicalLabels} para no desperdiciar la fila completa.</strong>
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Printer selector */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="trace-printer" className={`text-[9px] font-semibold uppercase tracking-wider ${theme === 'light' ? 'text-slate-500' : 'text-slate-400'}`}>Impresora</label>
                {useWebUsb ? (
                  <span className="text-[8px] text-blue-400 font-medium flex items-center gap-1">
                    <Usb className="w-3 h-3" /> WebUSB
                  </span>
                ) : (
                  systemPrinters.length > 0 && selectedSystemPrinter === loadDefaultPrinter() && (
                    <span className="text-[8px] text-emerald-400 font-medium">★ predeterminada</span>
                  )
                )}
              </div>
              {useWebUsb ? (
                // WebUSB mode
                webUsbDevice ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 rounded-md border border-emerald-600 bg-emerald-900/30 text-sm p-2 text-emerald-300 flex items-center gap-2">
                      <Usb className="w-4 h-4" />
                      <span className="truncate">{webUsbDevice.productName || "Impresora USB"}</span>
                    </div>
                    <button onClick={handleDisconnectWebUsb} className="p-2 rounded-md border border-slate-700 bg-slate-800 hover:bg-red-700 text-slate-400 hover:text-white transition-colors cursor-pointer" title="Desconectar">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button onClick={handleConnectWebUsb}
                    className="w-full rounded-md border-2 border-dashed border-blue-500 bg-blue-900/20 hover:bg-blue-900/40 text-sm p-2.5 text-blue-300 hover:text-blue-200 transition-colors flex items-center justify-center gap-2 cursor-pointer">
                    <Usb className="w-4 h-4" />
                    <span>Conectar Impresora USB</span>
                  </button>
                )
              ) : (
                // Server-side mode
                systemPrinters.length > 0 ? (
                  <select id="trace-printer" aria-label="Seleccionar impresora" className={inputClass}
                    value={selectedSystemPrinter} onChange={(e) => handlePrinterChange(e.target.value)}>
                    {systemPrinters.map((p) => (<option key={p.Name} value={p.Name}>{p.Name} ({p.PortName})</option>))}
                  </select>
                ) : (
                  <div className={`w-full rounded-md border text-sm p-2 italic ${
                    theme === 'light' ? 'border-slate-350 bg-slate-200 text-slate-500' : 'border-slate-800 bg-slate-900/40 text-slate-500'
                  }`}>Sin impresoras detectadas</div>
                )
              )}
            </div>
          </div>

          {/* Row 2: Print/Download buttons and ZPL code box */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 mt-3 items-end">
            <div className="lg:col-span-4 flex flex-col gap-1.5 font-bold">
              <button onClick={handlePrint} disabled={usbPrinting || !canPrint}
                className="w-full flex items-center justify-center px-4 py-2.5 outline-none rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-colors border border-emerald-500 shadow-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                <Printer className="w-4 h-4 mr-2" />
                <span>{usbPrinting ? "Enviando..." : "🖨️ Imprimir Trazabilidad"}</span>
              </button>
              <button onClick={handleDownloadZPL}
                className={`w-full flex items-center justify-center px-3 py-1.5 outline-none rounded-md font-medium text-[11px] transition-colors border cursor-pointer ${
                  theme === 'light'
                    ? 'bg-slate-200 hover:bg-slate-300 text-slate-700 border-slate-300'
                    : 'bg-slate-800 hover:bg-slate-750 text-slate-300 border-slate-700'
                }`}>
                <Download className="w-3 h-3 mr-1.5" /><span>Descargar .ZPL</span>
              </button>
            </div>

            <div className="lg:col-span-8 bg-slate-950 border border-slate-900 rounded-md p-2 overflow-hidden relative group max-h-[90px] h-[90px]">
              <pre className="text-[8px] text-emerald-400 font-mono whitespace-pre-wrap break-all h-full overflow-y-auto custom-scrollbar leading-relaxed">
                {zplCode}
              </pre>
              <button onClick={handleCopyZpl}
                className="absolute top-1 right-1 p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 cursor-pointer"
                title="Copiar ZPL">
                {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          </div>
          {copied && <p className="text-[10px] text-green-400 mt-0.5 text-right font-medium">¡Copiado!</p>}
        </div>

        {/* Footer */}
        <div className={`px-5 py-2.5 border-t flex justify-between items-center ${
          theme === 'light' ? 'bg-slate-100 border-slate-200' : 'bg-slate-950/60 border-slate-800'
        }`}>
          <div className={`text-[10px] ${theme === 'light' ? 'text-slate-400' : 'text-slate-500'}`}>
            <span>{currentFormat.width}×{currentFormat.height}mm · {currentFormat.dpi} DPI · {currentFormat.labelsPerRow}col</span>
            {hasIsp && <span className="text-emerald-500 ml-2">● ISP activo</span>}
          </div>
          <button onClick={onClose}
            className={`px-4 py-1.5 text-sm font-medium border rounded-md transition-colors shadow-sm cursor-pointer ${
              theme === 'light'
                ? 'text-slate-700 bg-white border-slate-300 hover:bg-slate-50'
                : 'text-slate-300 bg-slate-800 border-slate-700 hover:bg-slate-700'
            }`}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
