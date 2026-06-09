import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Type, Calendar, Minus, Hash, Plus, Trash2, Save, FolderOpen,
  Printer, Download, AlignLeft, AlignCenter, AlignRight, Bold,
  GripVertical, Copy, Check, Code, Move, X,
} from "lucide-react";
import { LabelFormat } from "../types";

// ─── Interfaces ──────────────────────────────────────────────────────────────
interface LabelElement {
  id: string;
  type: "text" | "date" | "line" | "number";
  content: string;
  x: number;  // mm from left
  y: number;  // mm from top
  fontSize: number; // mm
  align: "L" | "C" | "R";
  bold: boolean;
}

interface FreeLabelCreatorProps {
  labelFormats: LabelFormat[];
  onShowToast?: (message: string, type: "success" | "error") => void;
}

interface SavedDesign {
  id?: number;
  name: string;
  elements: LabelElement[];
  formatId: string;
  format_id?: string;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────
const PRINTER_STORAGE_KEY = "zebra-default-printer";
const DESIGNS_STORAGE_KEY = "zebra-free-label-designs";

// ─── localStorage helpers ────────────────────────────────────────────────────
function loadDefaultPrinter(): string {
  try { return localStorage.getItem(PRINTER_STORAGE_KEY) || ""; } catch { return ""; }
}
function saveDefaultPrinter(name: string) {
  try { localStorage.setItem(PRINTER_STORAGE_KEY, name); } catch {}
}

// ─── DB API helpers ──────────────────────────────────────────────────────────
async function fetchDesignsFromDb(): Promise<SavedDesign[]> {
  try {
    const res = await fetch('/api/label-designs');
    if (!res.ok) return [];
    const rows = await res.json();
    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      elements: r.elements || [],
      formatId: r.format_id || r.formatId,
      createdAt: r.created_at || r.createdAt,
      updatedAt: r.updated_at || r.updatedAt,
    }));
  } catch { return []; }
}

async function createDesignInDb(design: { name: string; formatId: string; elements: LabelElement[] }): Promise<SavedDesign | null> {
  try {
    const res = await fetch('/api/label-designs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: design.name, format_id: design.formatId, elements: design.elements }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return { id: data.id, name: data.name, elements: data.elements, formatId: data.format_id, createdAt: data.created_at, updatedAt: data.updated_at };
  } catch { return null; }
}

async function updateDesignInDb(id: number, design: { name: string; formatId: string; elements: LabelElement[] }): Promise<boolean> {
  try {
    const res = await fetch(`/api/label-designs/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: design.name, format_id: design.formatId, elements: design.elements }),
    });
    return res.ok;
  } catch { return false; }
}

async function deleteDesignFromDb(id: number): Promise<boolean> {
  try {
    const res = await fetch(`/api/label-designs/${id}`, { method: 'DELETE' });
    return res.ok;
  } catch { return false; }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function generateId() {
  return `el-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatDDMMYYYY(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function mmToDots(mm: number, dpi: number): number {
  return Math.round(mm * dpi / 25.4);
}

const ELEMENT_COLORS: Record<string, { border: string; bg: string; text: string; dot: string }> = {
  text: { border: "border-blue-400", bg: "bg-blue-50", text: "text-blue-700", dot: "#3b82f6" },
  date: { border: "border-emerald-400", bg: "bg-emerald-50", text: "text-emerald-700", dot: "#10b981" },
  line: { border: "border-amber-400", bg: "bg-amber-50", text: "text-amber-700", dot: "#f59e0b" },
  number: { border: "border-purple-400", bg: "bg-purple-50", text: "text-purple-700", dot: "#8b5cf6" },
};

const ELEMENT_ICONS: Record<string, React.ReactNode> = {
  text: <Type className="w-3.5 h-3.5" />,
  date: <Calendar className="w-3.5 h-3.5" />,
  line: <Minus className="w-3.5 h-3.5" />,
  number: <Hash className="w-3.5 h-3.5" />,
};

const ELEMENT_LABELS: Record<string, string> = {
  text: "Texto libre",
  date: "Fecha actual",
  line: "Línea separadora",
  number: "Consecutivo",
};

// ─── ZPL Generation ──────────────────────────────────────────────────────────
function generateFreeZpl(
  format: LabelFormat,
  elements: LabelElement[],
  copies: number,
  startNumber: number,
): string {
  const dpi = format.dpi;
  const dpmm = dpi / 25.4;
  const labelW = mmToDots(format.width, dpi);
  const labelH = mmToDots(format.height, dpi);
  const gapDots = mmToDots(format.horizontalGap, dpi);
  const marginL = mmToDots(format.marginLeft, dpi);
  const marginR = mmToDots(format.marginRight, dpi);
  const usableW = labelW - marginL - marginR;

  const cols = format.labelsPerRow || 1;
  const rows = format.labelsPerColumn || 1;
  const vGap = mmToDots(format.verticalGap || 2, dpi);

  const totalPw = Math.max(labelW, labelW * cols + gapDots * Math.max(0, cols - 1) + marginL);

  const today = formatDDMMYYYY(new Date());

  let zpl = "^XA\n";
  zpl += `^PW${totalPw}\n`;
  zpl += `^LL${labelH}\n`;
  zpl += `~SD${format.darkness}\n`;
  zpl += `^PR${format.printSpeed}\n`;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const colOffsetX = marginL + col * (labelW + gapDots);
      const rowOffsetY = row * (labelH + vGap);

      for (const el of elements) {
        const xDots = colOffsetX + mmToDots(el.x, dpi);
        const yDots = rowOffsetY + mmToDots(el.y, dpi);
        const fontH = mmToDots(el.fontSize, dpi);
        const fontW = Math.round(fontH * 0.6);

        if (el.type === "line") {
          const lineWidth = usableW;
          zpl += `^FO${xDots},${yDots}^GB${lineWidth},1,1^FS\n`;
          continue;
        }

        let text = el.content;
        if (el.type === "date") text = today;
        if (el.type === "number") text = String(startNumber).padStart(el.content.length || 4, "0");

        const boldPrefix = el.bold ? "^A0N," : "^A0N,";

        if (el.align === "C") {
          zpl += `^FO${colOffsetX + marginL > colOffsetX ? colOffsetX : colOffsetX},${yDots}^FB${usableW},1,0,C,0${boldPrefix}${fontH},${fontW}^FD${text}^FS\n`;
        } else if (el.align === "R") {
          zpl += `^FO${colOffsetX},${yDots}^FB${usableW},1,0,R,0${boldPrefix}${fontH},${fontW}^FD${text}^FS\n`;
        } else {
          zpl += `^FO${xDots},${yDots}${boldPrefix}${fontH},${fontW}^FD${text}^FS\n`;
        }
      }
    }
  }

  zpl += `^PQ${copies},0,1,Y\n`;
  zpl += "^XZ\n";
  return zpl;
}

// ─── Interactive Preview ─────────────────────────────────────────────────────
interface FreePreviewProps {
  format: LabelFormat;
  elements: LabelElement[];
  selectedElementId: string | null;
  onSelectElement: (id: string | null) => void;
  onUpdateElement: (id: string, updates: Partial<LabelElement>) => void;
}

function FreeLabelPreview({
  format, elements, selectedElementId, onSelectElement, onUpdateElement,
}: FreePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, startX: 0, startY: 0 });

  const cols = format.labelsPerRow || 1;
  const rows = format.labelsPerColumn || 1;
  const gapMm = format.horizontalGap || 2;
  const vGapMm = format.verticalGap || 2;

  const totalWidthMm = format.width * cols + gapMm * Math.max(0, cols - 1);
  const totalHeightMm = format.height * rows + vGapMm * Math.max(0, rows - 1);

  const scale = Math.min(520 / totalWidthMm, 380 / totalHeightMm);
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

  const zebraFontRatio = 0.70;

  // Generate grid dots pattern
  const gridDots = useMemo(() => {
    const dots: { x: number; y: number }[] = [];
    const spacing = 5; // mm
    for (let gx = spacing; gx < format.width; gx += spacing) {
      for (let gy = spacing; gy < format.height; gy += spacing) {
        dots.push({ x: gx * scale, y: gy * scale });
      }
    }
    return dots;
  }, [format.width, format.height, scale]);

  const handleMouseDown = useCallback((id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(id);
    onSelectElement(id);
    const el = elements.find(el => el.id === id);
    if (el) {
      dragStartRef.current = { mouseX: e.clientX, mouseY: e.clientY, startX: el.x, startY: el.y };
    }
  }, [elements, onSelectElement]);

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: MouseEvent) => {
      const dx = (e.clientX - dragStartRef.current.mouseX) / scale;
      const dy = (e.clientY - dragStartRef.current.mouseY) / scale;
      const newX = Math.max(format.marginLeft, Math.min(
        format.width - format.marginRight - 2,
        dragStartRef.current.startX + dx,
      ));
      const newY = Math.max(format.marginTop, Math.min(
        format.height - format.marginBottom - 2,
        dragStartRef.current.startY + dy,
      ));
      onUpdateElement(dragging, {
        x: Math.round(newX * 10) / 10,
        y: Math.round(newY * 10) / 10,
      });
    };
    const handleUp = () => setDragging(null);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragging, scale, format, onUpdateElement]);

  const today = formatDDMMYYYY(new Date());

  const getDisplayText = (el: LabelElement) => {
    switch (el.type) {
      case "date": return today;
      case "number": return "0001";
      case "line": return "";
      default: return el.content || "Texto";
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="relative bg-slate-100 rounded-lg p-3 border border-slate-200"
        style={{ width: gridW + 24, height: gridH + 24 }}
        onClick={() => onSelectElement(null)}
      >
        <div className="relative" style={{ width: gridW, height: gridH }} ref={containerRef}>
          {Array.from({ length: rows }).map((_, row) =>
            Array.from({ length: cols }).map((_, col) => {
              const offsetX = col * (singleW + gapPx);
              const offsetY = row * (singleH + vGapPx);
              const isFirstLabel = row === 0 && col === 0;

              return (
                <div
                  key={`${row}-${col}`}
                  className={`absolute bg-white border ${isFirstLabel ? "border-blue-300 shadow-md" : "border-slate-300"} rounded-sm overflow-hidden`}
                  style={{ left: offsetX, top: offsetY, width: singleW, height: singleH }}
                >
                  {/* Grid dots */}
                  {isFirstLabel && gridDots.map((dot, i) => (
                    <div
                      key={i}
                      className="absolute rounded-full bg-slate-200"
                      style={{ left: dot.x - 0.5, top: dot.y - 0.5, width: 1, height: 1 }}
                    />
                  ))}

                  {/* Margin guides */}
                  {isFirstLabel && (
                    <div
                      className="absolute border border-dashed border-blue-200/50 pointer-events-none"
                      style={{ left: pML, top: pMT, width: usableW, height: usableH }}
                    />
                  )}

                  {/* Elements */}
                  {elements.map((el) => {
                    const color = ELEMENT_COLORS[el.type] || ELEMENT_COLORS.text;
                    const isSelected = selectedElementId === el.id && isFirstLabel;
                    const isBeingDragged = dragging === el.id;

                    if (el.type === "line") {
                      const yPx = el.y * scale;
                      return (
                        <div
                          key={el.id}
                          onMouseDown={isFirstLabel ? (e) => handleMouseDown(el.id, e) : undefined}
                          className={`absolute ${isFirstLabel ? "cursor-move" : ""}`}
                          style={{
                            left: pML,
                            top: yPx - 1,
                            width: usableW,
                            height: 3,
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div
                            className={`w-full h-px ${isSelected || isBeingDragged ? "bg-amber-500" : "bg-slate-400"}`}
                            style={{ marginTop: 1 }}
                          />
                        </div>
                      );
                    }

                    const fontPx = el.fontSize * scale * zebraFontRatio;
                    const yPx = el.y * scale;
                    const xPx = el.align === "L" ? el.x * scale : pML;
                    const width = el.align === "L" ? usableW - (el.x * scale - pML) : usableW;
                    const textAlign = el.align === "C" ? "center" : el.align === "R" ? "right" : "left";

                    return (
                      <div
                        key={el.id}
                        onMouseDown={isFirstLabel ? (e) => handleMouseDown(el.id, e) : undefined}
                        className={`absolute truncate select-none ${
                          isFirstLabel ? `cursor-move border ${isSelected || isBeingDragged ? `${color.border} ${color.bg}` : "border-transparent hover:border-slate-300"}` : ""
                        }`}
                        style={{
                          left: xPx,
                          top: yPx,
                          width: width,
                          fontSize: Math.max(6, fontPx),
                          lineHeight: `${Math.max(8, fontPx + 2)}px`,
                          textAlign,
                          fontWeight: el.bold ? "bold" : "normal",
                          color: isSelected ? color.dot : "#334155",
                        }}
                        onClick={(e) => e.stopPropagation()}
                        title={isFirstLabel ? `Arrastra: ${el.content || ELEMENT_LABELS[el.type]}` : undefined}
                      >
                        {getDisplayText(el)}
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
        <span>Arrastra los elementos en la 1ª etiqueta — se replica en todas</span>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export function FreeLabelCreator({ labelFormats, onShowToast }: FreeLabelCreatorProps) {
  // ── Format
  const [activeFormatId, setActiveFormatId] = useState(labelFormats[0]?.id || "");
  const currentFormat = labelFormats.find((f) => f.id === activeFormatId) || labelFormats[0];

  // ── Elements
  const [elements, setElements] = useState<LabelElement[]>([]);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [startNumber, setStartNumber] = useState(1);

  // ── Print state
  const [copies, setCopies] = useState(1);
  const [systemPrinters, setSystemPrinters] = useState<{ Name: string; PortName: string; DriverName: string }[]>([]);
  const [selectedSystemPrinter, setSelectedSystemPrinter] = useState("");
  const [usbPrinting, setUsbPrinting] = useState(false);
  const [copied, setCopied] = useState(false);

  // ── Template state
  const [savedDesigns, setSavedDesigns] = useState<SavedDesign[]>([]);
  const [saveName, setSaveName] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [editingDesignId, setEditingDesignId] = useState<number | null>(null);
  const [editingDesignName, setEditingDesignName] = useState("");

  // ── Drag reorder
  const [dragReorderIdx, setDragReorderIdx] = useState<number | null>(null);

  // ── Load printers
  useEffect(() => {
    const savedPrinter = loadDefaultPrinter();
    fetch("/api/system-printers")
      .then((r) => r.json())
      .then((printers: any[]) => {
        setSystemPrinters(printers);
        if (savedPrinter && printers.some((p) => p.Name === savedPrinter)) {
          setSelectedSystemPrinter(savedPrinter);
        } else {
          const zebra = printers.find((p) =>
            p.DriverName?.toLowerCase().includes("zebra") || p.Name?.toLowerCase().includes("zebra")
          );
          if (zebra) setSelectedSystemPrinter(zebra.Name);
          else if (printers.length > 0) setSelectedSystemPrinter(printers[0].Name);
        }
      })
      .catch(() => {});

    // Load designs from DB
    fetchDesignsFromDb().then(setSavedDesigns);
  }, []);

  const handlePrinterChange = (name: string) => {
    setSelectedSystemPrinter(name);
    saveDefaultPrinter(name);
  };

  // ── Element CRUD
  const addElement = (type: LabelElement["type"]) => {
    const usableH = currentFormat.height - currentFormat.marginTop - currentFormat.marginBottom;
    const yOffset = currentFormat.marginTop + (elements.length * 5) % usableH;
    const newEl: LabelElement = {
      id: generateId(),
      type,
      content: type === "text" ? "Texto" : type === "date" ? "DD/MM/YYYY" : type === "number" ? "0001" : "",
      x: currentFormat.marginLeft,
      y: Math.min(yOffset, currentFormat.height - currentFormat.marginBottom - 3),
      fontSize: type === "line" ? 1 : 3,
      align: "L",
      bold: false,
    };
    setElements((prev) => [...prev, newEl]);
    setSelectedElementId(newEl.id);
  };

  const updateElement = useCallback((id: string, updates: Partial<LabelElement>) => {
    setElements((prev) => prev.map((el) => (el.id === id ? { ...el, ...updates } : el)));
  }, []);

  const deleteElement = (id: string) => {
    setElements((prev) => prev.filter((el) => el.id !== id));
    if (selectedElementId === id) setSelectedElementId(null);
  };

  const clampFont = (v: number) => Math.max(1.5, Math.min(12, Math.round(v * 2) / 2));

  // ── Reorder via drag
  const handleDragStart = (idx: number) => {
    setDragReorderIdx(idx);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragReorderIdx === null || dragReorderIdx === idx) return;
    const newElements = [...elements];
    const [moved] = newElements.splice(dragReorderIdx, 1);
    newElements.splice(idx, 0, moved);
    setElements(newElements);
    setDragReorderIdx(idx);
  };

  const handleDragEnd = () => {
    setDragReorderIdx(null);
  };

  // ── Save / Load / Edit designs (DB-backed)
  const refreshDesigns = async () => {
    const designs = await fetchDesignsFromDb();
    setSavedDesigns(designs);
  };

  const handleSaveDesign = async () => {
    if (!saveName.trim()) return;
    if (editingDesignId) {
      // Update existing design
      const ok = await updateDesignInDb(editingDesignId, {
        name: saveName.trim(),
        formatId: activeFormatId,
        elements,
      });
      if (ok) {
        onShowToast?.(`Diseño "${saveName.trim()}" actualizado`, "success");
      } else {
        onShowToast?.("Error al actualizar diseño", "error");
      }
    } else {
      // Create new design
      const created = await createDesignInDb({
        name: saveName.trim(),
        formatId: activeFormatId,
        elements,
      });
      if (created) {
        setEditingDesignId(created.id || null);
        setEditingDesignName(created.name);
        onShowToast?.(`Diseño "${created.name}" guardado`, "success");
      } else {
        onShowToast?.("Error al guardar diseño", "error");
      }
    }
    setSaveName("");
    setShowSaveDialog(false);
    await refreshDesigns();
  };

  const handleLoadDesign = (design: SavedDesign) => {
    setElements(design.elements);
    if (labelFormats.some((f) => f.id === design.formatId)) {
      setActiveFormatId(design.formatId);
    }
    setEditingDesignId(design.id || null);
    setEditingDesignName(design.name);
    onShowToast?.(`Diseño "${design.name}" cargado para edición`, "success");
  };

  const handleDeleteDesign = async (design: SavedDesign) => {
    if (!design.id) return;
    const ok = await deleteDesignFromDb(design.id);
    if (ok) {
      onShowToast?.(`Diseño "${design.name}" eliminado`, "success");
      if (editingDesignId === design.id) {
        setEditingDesignId(null);
        setEditingDesignName("");
      }
      await refreshDesigns();
    } else {
      onShowToast?.("Error al eliminar diseño", "error");
    }
  };

  const handleNewDesign = () => {
    setElements([]);
    setSelectedElementId(null);
    setEditingDesignId(null);
    setEditingDesignName("");
  };

  const handleQuickSave = async () => {
    if (!editingDesignId || !editingDesignName) return;
    const ok = await updateDesignInDb(editingDesignId, {
      name: editingDesignName,
      formatId: activeFormatId,
      elements,
    });
    if (ok) {
      onShowToast?.(`Diseño "${editingDesignName}" guardado`, "success");
      await refreshDesigns();
    } else {
      onShowToast?.("Error al guardar", "error");
    }
  };

  // ── ZPL
  const zplCode = useMemo(
    () => generateFreeZpl(currentFormat, elements, copies, startNumber),
    [currentFormat, elements, copies, startNumber]
  );

  const handleCopyZpl = () => {
    navigator.clipboard.writeText(zplCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadZPL = () => {
    const blob = new Blob([zplCode], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `free_label_${Date.now()}.zpl`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handlePrint = async () => {
    if (!selectedSystemPrinter) {
      onShowToast?.("Selecciona una impresora", "error");
      return;
    }
    setUsbPrinting(true);
    try {
      const res = await fetch("/api/print/usb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zpl: zplCode, printerName: selectedSystemPrinter }),
      });
      const data = await res.json();
      if (res.ok) onShowToast?.(`✅ ${data.message}`, "success");
      else onShowToast?.(data.error || "Error de impresión", "error");
    } catch (e: any) {
      onShowToast?.("Error: " + e.message, "error");
    } finally {
      setUsbPrinting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* ── Header ── */}
      <div className="px-4 py-2.5 bg-gradient-to-r from-slate-800 to-slate-900 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <Type className="w-4 h-4 text-blue-400" />
          <h2 className="text-sm font-bold text-white tracking-wide">
            <span>Creador de Etiquetas Libre</span>
          </h2>
          {editingDesignId && (
            <span className="px-2 py-0.5 text-[9px] font-bold bg-blue-600/30 text-blue-300 rounded border border-blue-500/30">
              Editando: {editingDesignName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleNewDesign}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-slate-300 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors border border-slate-600"
          >
            <Plus className="w-3 h-3" />
            <span>Nuevo</span>
          </button>
          {editingDesignId ? (
            <button
              onClick={handleQuickSave}
              disabled={elements.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors border border-emerald-500 disabled:opacity-50"
            >
              <Save className="w-3 h-3" />
              <span>Guardar</span>
            </button>
          ) : (
            <button
              onClick={() => setShowSaveDialog(true)}
              disabled={elements.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors border border-blue-500 disabled:opacity-50"
            >
              <Save className="w-3 h-3" />
              <span>Guardar como</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* ── Left panel: Toolbar + Element list ── */}
        <div className="w-[280px] flex-shrink-0 border-r border-slate-200 bg-white flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="p-3 border-b border-slate-100">
            <h3 className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-2">
              Agregar elemento
            </h3>
            <div className="grid grid-cols-2 gap-1.5">
              {(["text", "date", "line", "number"] as const).map((type) => {
                const color = ELEMENT_COLORS[type];
                return (
                  <button
                    key={type}
                    onClick={() => addElement(type)}
                    className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[10px] font-semibold transition-all duration-150 border ${color.border} ${color.bg} ${color.text} hover:shadow-sm active:scale-95`}
                  >
                    {ELEMENT_ICONS[type]}
                    <span>{ELEMENT_LABELS[type]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Element list */}
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
            <h3 className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
              Elementos ({elements.length})
            </h3>
            {elements.length === 0 && (
              <div className="text-center py-8 text-slate-400">
                <Type className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-[11px]">
                  <span>Agrega elementos usando</span>
                </p>
                <p className="text-[11px]">
                  <span>los botones de arriba</span>
                </p>
              </div>
            )}
            {elements.map((el, idx) => {
              const color = ELEMENT_COLORS[el.type];
              const isSelected = selectedElementId === el.id;

              return (
                <div
                  key={el.id}
                  draggable
                  onDragStart={() => handleDragStart(idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDragEnd={handleDragEnd}
                  onClick={() => setSelectedElementId(el.id)}
                  className={`rounded-lg border transition-all duration-150 ${
                    isSelected
                      ? `${color.border} ${color.bg} shadow-sm`
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  {/* Top row: drag handle + type badge + delete */}
                  <div className="flex items-center gap-1.5 px-2 pt-2 pb-1">
                    <GripVertical className="w-3 h-3 text-slate-300 cursor-grab flex-shrink-0" />
                    <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${color.bg} ${color.text}`}>
                      {ELEMENT_ICONS[el.type]}
                      <span>{ELEMENT_LABELS[el.type]}</span>
                    </div>
                    <div className="flex-1" />
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteElement(el.id); }}
                      className="p-0.5 text-slate-300 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Content input (not for lines) */}
                  {el.type !== "line" && (
                    <div className="px-2 pb-1.5">
                      <input
                        type="text"
                        value={el.content}
                        onChange={(e) => updateElement(el.id, { content: e.target.value })}
                        placeholder={el.type === "date" ? "Fecha auto" : el.type === "number" ? "0001" : "Contenido"}
                        className="w-full text-[11px] text-slate-700 bg-white/70 border border-slate-200 rounded px-2 py-1 outline-none focus:border-blue-400 font-medium"
                        readOnly={el.type === "date"}
                      />
                    </div>
                  )}

                  {/* Controls row: font size, alignment, bold */}
                  <div className="flex items-center gap-1 px-2 pb-2">
                    {/* Font size */}
                    {el.type !== "line" && (
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); updateElement(el.id, { fontSize: clampFont(el.fontSize - 0.5) }); }}
                          className="w-4 h-4 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 text-slate-500"
                        >
                          <Minus className="w-2 h-2" />
                        </button>
                        <span className="text-[9px] font-bold text-slate-600 w-6 text-center tabular-nums">{el.fontSize.toFixed(1)}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); updateElement(el.id, { fontSize: clampFont(el.fontSize + 0.5) }); }}
                          className="w-4 h-4 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 text-slate-500"
                        >
                          <Plus className="w-2 h-2" />
                        </button>
                        <span className="text-[7px] text-slate-400">mm</span>
                      </div>
                    )}

                    <div className="flex-1" />

                    {/* Alignment */}
                    {el.type !== "line" && (
                      <div className="flex items-center rounded border border-slate-200 overflow-hidden">
                        {(["L", "C", "R"] as const).map((a) => {
                          const Icon = a === "L" ? AlignLeft : a === "C" ? AlignCenter : AlignRight;
                          return (
                            <button
                              key={a}
                              onClick={(e) => { e.stopPropagation(); updateElement(el.id, { align: a }); }}
                              className={`w-5 h-5 flex items-center justify-center transition-colors ${
                                el.align === a ? "bg-blue-500 text-white" : "bg-white text-slate-400 hover:bg-slate-50"
                              }`}
                            >
                              <Icon className="w-2.5 h-2.5" />
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Bold */}
                    {el.type !== "line" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); updateElement(el.id, { bold: !el.bold }); }}
                        className={`w-5 h-5 flex items-center justify-center rounded border transition-colors ${
                          el.bold ? "bg-blue-500 text-white border-blue-500" : "bg-white text-slate-400 border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        <Bold className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Saved Designs List */}
          <div className="border-t border-slate-200 p-3 overflow-y-auto" style={{ maxHeight: '220px' }}>
            <h3 className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
              Diseños guardados ({savedDesigns.length})
            </h3>
            {savedDesigns.length === 0 ? (
              <div className="text-center py-4 text-slate-400">
                <FolderOpen className="w-6 h-6 mx-auto mb-1 opacity-30" />
                <p className="text-[10px]"><span>Sin diseños guardados</span></p>
              </div>
            ) : (
              <div className="space-y-1">
                {savedDesigns.map((design) => {
                  const fmt = labelFormats.find((f) => f.id === design.formatId);
                  const isActive = editingDesignId === design.id;
                  return (
                    <div
                      key={design.id || design.name}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border transition-all cursor-pointer group ${
                        isActive
                          ? 'border-blue-300 bg-blue-50 shadow-sm'
                          : 'border-slate-100 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                      onClick={() => handleLoadDesign(design)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          {isActive && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />}
                          <span className="text-[11px] font-semibold text-slate-800 truncate">{design.name}</span>
                        </div>
                        <div className="text-[9px] text-slate-400 mt-0.5">
                          <span>{design.elements.length} elem</span>
                          {fmt && <span> · {fmt.name}</span>}
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteDesign(design); }}
                        className="p-0.5 text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                        title="Eliminar"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Center: Preview ── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 flex items-center justify-center p-4 bg-slate-50 overflow-auto">
            {currentFormat ? (
              <FreeLabelPreview
                format={currentFormat}
                elements={elements}
                selectedElementId={selectedElementId}
                onSelectElement={setSelectedElementId}
                onUpdateElement={updateElement}
              />
            ) : (
              <div className="text-slate-400 text-sm">
                <span>Selecciona un formato de etiqueta</span>
              </div>
            )}
          </div>

          {currentFormat && (currentFormat.labelsPerRow > 1 || (currentFormat.labelsPerColumn || 1) > 1) && (
            <div className="mx-4 mb-2 px-2 py-1.5 bg-blue-50 border border-blue-200 rounded-lg text-center">
              <p className="text-[9px] text-blue-600 font-medium">
                <span>Formato: {currentFormat.labelsPerRow} columnas × {currentFormat.labelsPerColumn || 1} filas — se replicará en todas</span>
              </p>
            </div>
          )}

          {/* ── Bottom: Print Console ── */}
          <div className="bg-slate-800 p-4 text-white border-t border-slate-700 flex-shrink-0">
            <div className="flex items-center gap-2 mb-3">
              <Code className="w-3.5 h-3.5 text-blue-400" />
              <h3 className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                <span>Consola de Impresión</span>
              </h3>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 mb-3">
              {/* Format selector */}
              <div>
                <label className="block text-[9px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  <span>Formato</span>
                </label>
                <select
                  className="w-full rounded-md border border-slate-600 bg-slate-700 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm p-2 text-white outline-none cursor-pointer"
                  value={activeFormatId}
                  onChange={(e) => setActiveFormatId(e.target.value)}
                >
                  {labelFormats.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>

              {/* Printer selector */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[9px] font-semibold text-slate-500 uppercase tracking-wider">
                    <span>Impresora</span>
                  </label>
                  {systemPrinters.length > 0 && selectedSystemPrinter === loadDefaultPrinter() && (
                    <span className="text-[8px] text-emerald-400 font-medium">★ predeterminada</span>
                  )}
                </div>
                {systemPrinters.length > 0 ? (
                  <select
                    className="w-full rounded-md border border-slate-600 bg-slate-700 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm p-2 text-white outline-none cursor-pointer"
                    value={selectedSystemPrinter}
                    onChange={(e) => handlePrinterChange(e.target.value)}
                  >
                    {systemPrinters.map((p) => (
                      <option key={p.Name} value={p.Name}>{p.Name} ({p.PortName})</option>
                    ))}
                  </select>
                ) : (
                  <div className="w-full rounded-md border border-slate-600 bg-slate-700 text-sm p-2 text-slate-500 italic">
                    <span>Sin impresoras</span>
                  </div>
                )}
              </div>

              {/* Copies + Start number */}
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-[9px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    <span>Copias</span>
                  </label>
                  <input
                    type="number" min={1} max={999} value={copies}
                    onChange={(e) => setCopies(Math.max(1, Number(e.target.value)))}
                    className="w-full rounded-md border border-slate-600 bg-slate-700 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm p-2 text-white outline-none font-semibold"
                  />
                </div>
                {elements.some((el) => el.type === "number") && (
                  <div className="flex-1">
                    <label className="block text-[9px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                      <span>Inicio #</span>
                    </label>
                    <input
                      type="number" min={1} value={startNumber}
                      onChange={(e) => setStartNumber(Math.max(1, Number(e.target.value)))}
                      className="w-full rounded-md border border-slate-600 bg-slate-700 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm p-2 text-white outline-none font-semibold"
                    />
                  </div>
                )}
              </div>

              {/* Print & Download */}
              <div className="flex flex-col gap-1.5">
                <button
                  onClick={handlePrint}
                  disabled={usbPrinting || !selectedSystemPrinter || elements.length === 0}
                  className="w-full flex items-center justify-center px-4 py-2.5 outline-none rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-colors border border-emerald-500 shadow-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Printer className="w-4 h-4 mr-2" />
                  <span>{usbPrinting ? "Enviando..." : "🖨️ Imprimir"}</span>
                </button>
                <button
                  onClick={handleDownloadZPL}
                  disabled={elements.length === 0}
                  className="w-full flex items-center justify-center px-3 py-1.5 outline-none rounded-md bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium text-[11px] transition-colors border border-slate-600 cursor-pointer disabled:opacity-50"
                >
                  <Download className="w-3 h-3 mr-1.5" />
                  <span>Descargar .ZPL</span>
                </button>
              </div>
            </div>

            {/* ZPL Code */}
            <div className="bg-slate-950 border border-slate-900 rounded-md p-2 overflow-hidden relative group max-h-[120px]">
              <pre className="text-[8px] text-emerald-400 font-mono whitespace-pre-wrap break-all h-full overflow-y-auto custom-scrollbar leading-relaxed">
                {zplCode}
              </pre>
              <button
                onClick={handleCopyZpl}
                className="absolute top-1 right-1 p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                title="Copiar ZPL"
              >
                {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
            {copied && (
              <p className="text-[10px] text-green-400 mt-0.5 text-right font-medium">
                <span>¡Copiado!</span>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Save Dialog ── */}
      {showSaveDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 flex justify-between items-center bg-gradient-to-r from-slate-800 to-slate-900">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Save className="w-4 h-4 text-blue-400" />
                <span>{editingDesignId ? "Guardar como nuevo" : "Guardar diseño"}</span>
              </h3>
              <button onClick={() => setShowSaveDialog(false)} className="text-slate-400 hover:text-white transition-colors p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5">
              <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                <span>Nombre del diseño</span>
              </label>
              <input
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Mi etiqueta personalizada"
                className="w-full rounded-md border border-slate-300 bg-white shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm p-2.5 text-slate-800 outline-none"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveDesign(); }}
              />
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => setShowSaveDialog(false)}
                  className="flex-1 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors"
                >
                  <span>Cancelar</span>
                </button>
                <button
                  onClick={handleSaveDesign}
                  disabled={!saveName.trim()}
                  className="flex-1 px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-md transition-colors disabled:opacity-50"
                >
                  <span>Guardar</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      <div className="px-4 py-2 border-t border-slate-200 bg-white flex justify-between items-center flex-shrink-0">
        <div className="text-[10px] text-slate-400">
          {currentFormat && (
            <span>{currentFormat.width}×{currentFormat.height}mm · {currentFormat.dpi} DPI · {currentFormat.labelsPerRow}col · {elements.length} elementos</span>
          )}
        </div>
        <div className="text-[10px] text-slate-400 flex items-center gap-2">
          <span>{savedDesigns.length} diseños en BD</span>
          {editingDesignId && (
            <span className="px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded text-[9px] font-semibold">
              Editando #{editingDesignId}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
