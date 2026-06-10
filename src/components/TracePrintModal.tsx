import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { X, Printer, Download, Copy, Check, Code, Minus, Plus, Calendar, Move, RotateCcw, Save, User, Settings2, Usb, Wifi, WifiOff } from "lucide-react";
import { Product, LabelFormat } from "../types";
import { isWebUSBSupported, getAlreadyPairedPrinters, requestUSBPrinter, sendZPLviaUSB, forgetUSBPrinter } from "../utils/webusb";
import { isRunningOnCloud, isLocalServerAvailable, fetchPrinters, sendPrintJob } from "../utils/printBridge";

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
  const traceFontH = Math.round(traceFontMm * dpmm);
  const traceFontW = Math.round(traceFontH * 0.6);

  const elabStr = formatDDMMYYYY(elabDate);
  const vencStr = formatDDMMYYYY(vencDate);
  const hasIsp = ispValue && ispValue.trim().length > 0;

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
      const y5 = rowOffsetY + Math.round(positions.traceCodeY * dpmm);

      zpl += `^FO${colOffsetX},${y1}^FB${usableW},1,0,C,0^A0N,${dateFontH},${dateFontW}^FDELAB: ${elabStr}^FS\n`;
      zpl += `^FO${colOffsetX},${y2}^FB${usableW},1,0,C,0^A0N,${dateFontH},${dateFontW}^FDVENC: ${vencStr}^FS\n`;
      zpl += `^FO${colOffsetX},${y3}^FB${usableW},1,0,C,0^A0N,${nameFontH},${nameFontW}^FD${productName.substring(0, 40)}^FS\n`;

      if (hasIsp) {
        const y4 = rowOffsetY + Math.round(positions.ispY * dpmm);
        zpl += `^FO${colOffsetX},${y4}^FB${usableW},1,0,C,0^A0N,${nameFontH},${nameFontW}^FDISP: ${ispValue!.trim()}^FS\n`;
      }

      zpl += `^FO${colOffsetX},${y5}^FB${usableW},1,0,C,0^A0N,${traceFontH},${traceFontW}^FD${traceCode}^FS\n`;
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

  const totalWidthMm = format.width * cols + gapMm * Math.max(0, cols - 1);
  const totalHeightMm = format.height * rows + vGapMm * Math.max(0, rows - 1);

  const scale = Math.min(480 / totalWidthMm, 320 / totalHeightMm);
  const singleW = format.width * scale;
  const singleH = format.height * scale;
  const gapPx = gapMm * scale;
  const vGapPx = vGapMm * scale;
  const gridW = singleW * cols + gapPx * Math.max(0, cols - 1);
  const gridH = singleH * rows + vGapPx * Math.max(0, rows - 1);

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
    return () => { window.removeEventListener("mousemove", handleMove); window.removeEventListener("mouseup", handleUp); };
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
    <div className="flex flex-col items-center gap-2">
      <div className="relative bg-slate-100 rounded-lg p-3 border border-slate-200"
        style={{ width: gridW + 24, height: gridH + 24 }}>
        <div className="relative" style={{ width: gridW, height: gridH }} ref={containerRef}>
          {Array.from({ length: rows }).map((_, row) =>
            Array.from({ length: cols }).map((_, col) => {
              const offsetX = col * (singleW + gapPx);
              const offsetY = row * (singleH + vGapPx);
              const isFirstLabel = row === 0 && col === 0;

              return (
                <div key={`${row}-${col}`}
                  className={`absolute bg-white border ${isFirstLabel ? 'border-blue-300 shadow-md' : 'border-slate-300'} rounded-sm overflow-hidden`}
                  style={{ left: offsetX, top: offsetY, width: singleW, height: singleH }}>
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
                          left: pML, top: yPx, width: usableW,
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

  // ── Printer state
  const [systemPrinters, setSystemPrinters] = useState<{ Name: string; PortName: string; DriverName: string }[]>([]);
  const [selectedSystemPrinter, setSelectedSystemPrinter] = useState("");
  const [usbPrinting, setUsbPrinting] = useState(false);
  const [copied, setCopied] = useState(false);

  // Print Bridge state
  const [localBridgeAvailable, setLocalBridgeAvailable] = useState(false);
  const [onCloud] = useState(isRunningOnCloud());
  const [bridgeChecked, setBridgeChecked] = useState(false);

  // WebUSB state (last resort fallback)
  const [webUsbDevice, setWebUsbDevice] = useState<USBDevice | null>(null);
  const [webUsbSupported] = useState(isWebUSBSupported());
  const [useWebUsb, setUseWebUsb] = useState(false);

  useEffect(() => {
    const savedPrinter = loadDefaultPrinter();

    const loadPrinters = async () => {
      // Step 1: If on Cloud, check if local server is available
      let useBridge = false;
      if (onCloud) {
        useBridge = await isLocalServerAvailable();
        setLocalBridgeAvailable(useBridge);
      }
      setBridgeChecked(true);

      // Step 2: Fetch printers (from local bridge or same-server)
      const printers = await fetchPrinters(useBridge);
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
      } else if (onCloud && !useBridge) {
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

  // ── ZPL
  const zplCode = useMemo(() =>
    generateTraceZpl(currentFormat, elabDate, vencDate, product.item_name, product.isp, traceCode, dateFontMm, nameFontMm, traceFontMm, copies, positions),
    [currentFormat, elabDate, vencDate, product.item_name, product.isp, traceCode, dateFontMm, nameFontMm, traceFontMm, copies, positions]
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
      const result = await sendPrintJob(zplCode, selectedSystemPrinter, localBridgeAvailable);
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

        {/* Content: 2-row layout */}
        <div className="flex-1 overflow-y-auto">
          {/* ── TOP ROW: inputs (left ~35%) + preview (right ~65%) ── */}
          <div className="grid grid-cols-1 lg:grid-cols-12">
            {/* Left: Data inputs */}
            <div className="lg:col-span-4 border-r border-slate-100 p-4 bg-slate-50/70 flex flex-col gap-3 overflow-y-auto">
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

              {/* ISP info */}
              {hasIsp && (
                <div className="flex items-center gap-2 px-2.5 py-2 bg-emerald-50 rounded-lg border border-emerald-200">
                  <span className="text-emerald-500 text-sm flex-shrink-0">🏷️</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[8px] font-semibold text-emerald-600 uppercase">ISP del producto</div>
                    <div className="text-xs font-bold text-emerald-800">{product.isp}</div>
                  </div>
                </div>
              )}

              {/* ── Operador + Línea de Proceso ── */}
              <div>
                <h3 className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                  <User className="w-3 h-3" />
                  Operador y Línea
                </h3>
                <div className="space-y-2">
                  {/* Operator selector */}
                  <div className="px-2.5 py-2 bg-white rounded-lg border border-slate-200">
                    <div className="text-[8px] font-semibold text-slate-400 uppercase mb-1">Operador</div>
                    <select
                      value={selectedOperadorId ?? ""}
                      onChange={(e) => {
                        const id = Number(e.target.value);
                        setSelectedOperadorId(id || null);
                        setUseCustomLine(false);
                      }}
                      className="w-full text-xs font-semibold text-slate-800 bg-transparent outline-none cursor-pointer"
                    >
                      <option value="">— Seleccionar operador —</option>
                      {empleados.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.codigo} - {emp.nombre}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Line de proceso */}
                  {selectedOperador && (
                    <div className="px-2.5 py-2 bg-white rounded-lg border border-slate-200">
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-[8px] font-semibold text-slate-400 uppercase">Línea de proceso</div>
                        {selectedOperador.linea_proceso && (
                          <label className="flex items-center gap-1 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={useCustomLine}
                              onChange={(e) => {
                                setUseCustomLine(e.target.checked);
                                if (!e.target.checked && selectedOperador.linea_proceso) {
                                  setLineaProceso(selectedOperador.linea_proceso);
                                }
                              }}
                              className="w-3 h-3 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-[8px] text-slate-500">Cambiar línea</span>
                          </label>
                        )}
                      </div>
                      {useCustomLine || !selectedOperador.linea_proceso ? (
                        <input
                          type="text"
                          value={lineaProceso}
                          onChange={(e) => setLineaProceso(e.target.value)}
                          placeholder="Ej: L1, L2, L3..."
                          className="w-full text-xs font-semibold text-slate-800 bg-slate-50 border border-slate-200 rounded px-2 py-1 outline-none focus:border-blue-400"
                        />
                      ) : (
                        <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                          {lineaProceso || "Sin línea asignada"}
                        </div>
                      )}
                    </div>
                  )}

                  {/* No operator warning */}
                  {!selectedOperador && (
                    <div className="flex items-start gap-2 px-2.5 py-2 bg-red-50 border border-red-200 rounded-lg">
                      <span className="text-red-400 text-sm leading-none mt-0.5">⚠️</span>
                      <p className="text-[9px] text-red-600 font-medium">Operador obligatorio para imprimir</p>
                    </div>
                  )}

                  {/* Trace code preview */}
                  {selectedOperador && (
                    <div className="px-2.5 py-2 bg-purple-50 rounded-lg border border-purple-200">
                      <div className="text-[8px] font-semibold text-purple-500 uppercase mb-1">Código de trazabilidad</div>
                      <div className="text-sm font-bold text-purple-800 tracking-wide font-mono">{traceCode}</div>
                      <div className="text-[8px] text-purple-400 mt-1">
                        S{String(getISOWeek(elabDate)).padStart(2, "0")}=Semana · {getDayNumber(elabDate)}=Día · {selectedOperador.codigo}=Op · {lineaProceso || "XX"}=Línea
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Font sizes */}
              <div>
                <h3 className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-2">Fuente</h3>
                <div className="space-y-1.5">
                  {[
                    { label: "Fechas", val: dateFontMm, set: setDateFontMm },
                    { label: "Nombre", val: nameFontMm, set: setNameFontMm },
                    { label: "Código", val: traceFontMm, set: setTraceFontMm },
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

            {/* Right: Interactive Preview */}
            <div className="lg:col-span-8 p-4 flex flex-col bg-white">
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
                  traceFontMm={traceFontMm}
                  elabText={`ELAB: ${formatDDMMYYYY(elabDate)}`}
                  vencText={`VENC: ${formatDDMMYYYY(vencDate)}`}
                  productName={product.item_name}
                  ispText={ispText}
                  traceCode={traceCode}
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
          </div>

          {/* ── BOTTOM ROW: full-width print console ── */}
          <div className="bg-slate-800 p-4 text-white border-t border-slate-700">
            <div className="flex items-center gap-2 mb-3">
              <Code className="w-3.5 h-3.5 text-blue-400" />
              <h3 className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Consola de Impresión</h3>
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

            {/* Controls row: format, printer, print/download */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3">
              {/* Format selector */}
              <div>
                <label className="block text-[9px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Formato</label>
                <select className="w-full rounded-md border border-slate-600 bg-slate-700 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm p-2 text-white outline-none cursor-pointer"
                  value={activeFormatId} onChange={(e) => setActiveFormatId(e.target.value)}>
                  {labelFormats.map((f) => (<option key={f.id} value={f.id}>{f.name}</option>))}
                </select>
              </div>

              {/* Printer selector */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[9px] font-semibold text-slate-500 uppercase tracking-wider">Impresora</label>
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
                      <button onClick={handleDisconnectWebUsb} className="p-2 rounded-md border border-slate-600 bg-slate-700 hover:bg-red-700 text-slate-400 hover:text-white transition-colors" title="Desconectar">
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
                    <select className="w-full rounded-md border border-slate-600 bg-slate-700 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm p-2 text-white outline-none cursor-pointer"
                      value={selectedSystemPrinter} onChange={(e) => handlePrinterChange(e.target.value)}>
                      {systemPrinters.map((p) => (<option key={p.Name} value={p.Name}>{p.Name} ({p.PortName})</option>))}
                    </select>
                  ) : (
                    <div className="w-full rounded-md border border-slate-600 bg-slate-700 text-sm p-2 text-slate-500 italic">Sin impresoras detectadas</div>
                  )
                )}
              </div>

              {/* Print & Download */}
              <div className="flex flex-col gap-1.5">
                <button onClick={handlePrint} disabled={usbPrinting || !canPrint}
                  className="w-full flex items-center justify-center px-4 py-2.5 outline-none rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-colors border border-emerald-500 shadow-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                  <Printer className="w-4 h-4 mr-2" />
                  <span>{usbPrinting ? "Enviando..." : "🖨️ Imprimir Trazabilidad"}</span>
                </button>
                <button onClick={handleDownloadZPL}
                  className="w-full flex items-center justify-center px-3 py-1.5 outline-none rounded-md bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium text-[11px] transition-colors border border-slate-600 cursor-pointer">
                  <Download className="w-3 h-3 mr-1.5" /><span>Descargar .ZPL</span>
                </button>
              </div>
            </div>

            {/* ZPL Code */}
            <div className="bg-slate-950 border border-slate-900 rounded-md p-2 overflow-hidden relative group max-h-[120px]">
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

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-slate-200 bg-slate-50 flex justify-between items-center">
          <div className="text-[10px] text-slate-400">
            <span>{currentFormat.width}×{currentFormat.height}mm · {currentFormat.dpi} DPI · {currentFormat.labelsPerRow}col</span>
            {hasIsp && <span className="text-emerald-500 ml-2">● ISP activo</span>}
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
