import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Calendar, Plus, Search, Send, FileText, Check, Settings, X, Edit, Trash2, 
  Loader2, Share2, ClipboardList, Cpu, AlertCircle, CheckCircle, Info, RefreshCw, Clock,
  ChevronUp, ChevronDown, Layers, Boxes, Droplet, BarChart2, TrendingUp, Sparkles
} from 'lucide-react';
import { Product, LineaProceso, Planificacion, TipoEmpaqueSecundario, TipoEnvasePrimario, TipoTapa } from '../types';

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

function parseFormatoToLiters(formatoStr: string | null | undefined): number {
  if (!formatoStr) return 0;
  const clean = formatoStr.trim().toLowerCase();
  if (!clean) return 0;
  
  // Try to match a number followed by CC or ML
  const mlMatch = clean.match(/^([\d.,]+)\s*(cc|ml|mls)$/);
  if (mlMatch) {
    const val = parseFloat(mlMatch[1].replace(',', '.'));
    return isNaN(val) ? 0 : val / 1000;
  }
  
  // Try to match a number followed by L, LT, LTS, LITROS
  const lMatch = clean.match(/^([\d.,]+)\s*(l|lt|lts|litro|litros)$/);
  if (lMatch) {
    const val = parseFloat(lMatch[1].replace(',', '.'));
    return isNaN(val) ? 0 : val;
  }
  
  // Just a raw number
  const val = parseFloat(clean.replace(',', '.'));
  return isNaN(val) ? 0 : val;
}

interface PlanificacionManagerProps {
  products: Product[];
  onShowToast?: (message: string, type: 'success' | 'error') => void;
  theme: 'light' | 'dark' | 'glass';
  tiposEmpaque?: TipoEmpaqueSecundario[];
  tiposEnvasePrimario?: TipoEnvasePrimario[];
  tiposTapa?: TipoTapa[];
}

export function PlanificacionManager({ products, onShowToast, theme, tiposEmpaque = [], tiposEnvasePrimario = [], tiposTapa = [] }: PlanificacionManagerProps) {
  // ---- States --------------------------------------------------------------
  const [lineas, setLineas] = useState<LineaProceso[]>([]);
  const [plans, setPlans] = useState<Planificacion[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    return todayStr < '2026-07-01' ? '2026-07-01' : todayStr;
  });
  const [loading, setLoading] = useState(true);
  const [whatsappRecipient, setWhatsappRecipient] = useState<string | null>(null);
  const [whatsappConnected, setWhatsappConnected] = useState(false);

  // Tab State
  const [activeTab, setActiveTab] = useState<'producto_terminado' | 'dashboard'>('producto_terminado');

  // Dashboard Filters and Data States
  const [dashStartDate, setDashStartDate] = useState(() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth();
    const startStr = new Date(y, m, 1).toISOString().split('T')[0];
    return startStr < '2026-07-01' ? '2026-07-01' : startStr;
  });
  const [dashEndDate, setDashEndDate] = useState(() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth();
    const endStr = new Date(y, m + 1, 0).toISOString().split('T')[0];
    return endStr < '2026-07-01' ? '2026-07-01' : endStr;
  });
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedWeek, setSelectedWeek] = useState('');
  const [selectedBrand, setSelectedBrand] = useState('');
  const [dashPlans, setDashPlans] = useState<Planificacion[]>([]);
  const [dashLoading, setDashLoading] = useState(false);
  const [historyStats, setHistoryStats] = useState<{ globalAverageLitersPerDay: number; absoluteRecordLitersSingleDay: number } | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const lastLoadedDatesRef = React.useRef({ start: '', end: '' });

  // Column resizing states and event handlers
  const defaultLineColWidths = {
    n: 65,
    turno: 90,
    sku: 90,
    producto: 220,
    marca: 120,
    envPri: 140,
    envSec: 130,
    tapa: 130,
    cantidad: 95,
    obs: 180,
    estado: 80,
    acciones: 80
  };

  const defaultDashColWidths = {
    sku: 80,
    producto: 280,
    marca: 120,
    envPri: 160,
    qty: 110,
    pallets: 110
  };

  // Column resizing states and event handlers
  const [lineColWidths, setLineColWidths] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem("tracelabel-line-col-widths");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === "object") {
          return { ...defaultLineColWidths, ...parsed };
        }
      } catch (e) {}
    }
    return defaultLineColWidths;
  });

  const [dashColWidths, setDashColWidths] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem("tracelabel-dash-col-widths");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === "object") {
          return { ...defaultDashColWidths, ...parsed };
        }
      } catch (e) {}
    }
    return defaultDashColWidths;
  });

  useEffect(() => {
    localStorage.setItem("tracelabel-line-col-widths", JSON.stringify(lineColWidths));
  }, [lineColWidths]);

  useEffect(() => {
    localStorage.setItem("tracelabel-dash-col-widths", JSON.stringify(dashColWidths));
  }, [dashColWidths]);

  const defaultLineColOrder = [
    'n', 'turno', 'sku', 'producto', 'marca', 'envPri', 'envSec', 'tapa', 'cantidad', 'obs', 'estado', 'acciones'
  ];

  const [lineColOrder, setLineColOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem("tracelabel-line-col-order");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const existing = parsed.filter(id => defaultLineColOrder.includes(id));
          const missing = defaultLineColOrder.filter(id => !existing.includes(id));
          if (existing.length > 0) {
            return [...existing, ...missing];
          }
        }
      } catch (e) {}
    }
    return defaultLineColOrder;
  });

  useEffect(() => {
    localStorage.setItem("tracelabel-line-col-order", JSON.stringify(lineColOrder));
  }, [lineColOrder]);

  const isLineDragActiveRef = React.useRef<boolean>(false);
  const [lineDragOverColId, setLineDragOverColId] = useState<string | null>(null);
  const [lineDragDirection, setLineDragDirection] = useState<"left" | "right" | null>(null);

  const handleLineDragStart = (e: React.DragEvent<HTMLTableHeaderCellElement>, id: string) => {
    e.dataTransfer.setData("text/plain", id);
    isLineDragActiveRef.current = true;
  };

  const handleLineDragOver = (e: React.DragEvent<HTMLTableHeaderCellElement>, targetId: string) => {
    e.preventDefault();
    if (!isLineDragActiveRef.current) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const isLeft = x < rect.width / 2;
    
    setLineDragOverColId(targetId);
    setLineDragDirection(isLeft ? "left" : "right");
  };

  const handleLineDragEnd = () => {
    setLineDragOverColId(null);
    setLineDragDirection(null);
    isLineDragActiveRef.current = false;
  };

  const handleLineDrop = (e: React.DragEvent<HTMLTableHeaderCellElement>, targetId: string) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData("text/plain");
    if (sourceId === targetId) return;

    const sourceIdx = lineColOrder.indexOf(sourceId);
    const targetIdx = lineColOrder.indexOf(targetId);
    if (sourceIdx === -1 || targetIdx === -1) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const isLeft = x < rect.width / 2;
    
    const newOrder = [...lineColOrder];
    newOrder.splice(sourceIdx, 1);
    
    let insertIdx = newOrder.indexOf(targetId);
    if (!isLeft) insertIdx += 1;
    newOrder.splice(insertIdx, 0, sourceId);
    
    setLineColOrder(newOrder);
    setLineDragOverColId(null);
    setLineDragDirection(null);
    isLineDragActiveRef.current = false;
  };

  const [hoveredResizeCol, setHoveredResizeCol] = useState<string | null>(null);

  const handleLineResizeStart = (e: React.MouseEvent, colKey: string) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = lineColWidths[colKey] || 100;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const newWidth = Math.max(40, startWidth + deltaX);
      setLineColWidths((prev) => ({
        ...prev,
        [colKey]: newWidth
      }));
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const renderHeader = (colId: string) => {
    const isOver = lineDragOverColId === colId;
    const borderClass = isOver
      ? lineDragDirection === "left"
        ? "border-l-4 border-blue-500"
        : "border-r-4 border-blue-500"
      : "";
    const isDraggable = !hoveredResizeCol;

    const commonHeaderProps = {
      draggable: isDraggable,
      onDragStart: (e: React.DragEvent<HTMLTableHeaderCellElement>) => handleLineDragStart(e, colId),
      onDragOver: (e: React.DragEvent<HTMLTableHeaderCellElement>) => handleLineDragOver(e, colId),
      onDragEnd: handleLineDragEnd,
      onDrop: (e: React.DragEvent<HTMLTableHeaderCellElement>) => handleLineDrop(e, colId),
      style: { width: lineColWidths[colId] || 100 },
      className: `group relative select-none py-2.5 font-bold transition-all duration-150 hover:bg-slate-500/5 ${borderClass} ${
        isDraggable ? "cursor-grab active:cursor-grabbing" : ""
      }`
    };

    const resizeHandle = (
      <div
        draggable={false}
        onMouseDown={(e) => handleLineResizeStart(e, colId)}
        onMouseEnter={() => setHoveredResizeCol(colId)}
        onMouseLeave={() => setHoveredResizeCol(null)}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        className={`absolute right-0 top-0 bottom-0 w-1.5 hover:bg-blue-500/30 active:bg-blue-600/50 cursor-col-resize select-none z-20 transition-colors ${
          hoveredResizeCol === colId ? "bg-blue-500/20" : ""
        }`}
      />
    );

    switch (colId) {
      case 'n':
        return (
          <th {...commonHeaderProps} className={`${commonHeaderProps.className} text-center`}>
            <span>N°</span>
            {resizeHandle}
          </th>
        );
      case 'turno':
        return (
          <th {...commonHeaderProps}>
            <span>Turno</span>
            {resizeHandle}
          </th>
        );
      case 'sku':
        return (
          <th {...commonHeaderProps}>
            <span>SKU</span>
            {resizeHandle}
          </th>
        );
      case 'producto':
        return (
          <th {...commonHeaderProps}>
            <span>Producto</span>
            {resizeHandle}
          </th>
        );
      case 'marca':
        return (
          <th {...commonHeaderProps}>
            <span>Marca</span>
            {resizeHandle}
          </th>
        );
      case 'envPri':
        return (
          <th {...commonHeaderProps}>
            <span>Env. Pri.</span>
            {resizeHandle}
          </th>
        );
      case 'envSec':
        return (
          <th {...commonHeaderProps}>
            <span>Env. Sec.</span>
            {resizeHandle}
          </th>
        );
      case 'tapa':
        return (
          <th {...commonHeaderProps}>
            <span>Tapa</span>
            {resizeHandle}
          </th>
        );
      case 'cantidad':
        return (
          <th {...commonHeaderProps} className={`${commonHeaderProps.className} text-right pr-2`}>
            <span>Cantidad</span>
            {resizeHandle}
          </th>
        );
      case 'obs':
        return (
          <th {...commonHeaderProps} className={`${commonHeaderProps.className} px-4`}>
            <span>Observaciones</span>
            {resizeHandle}
          </th>
        );
      case 'estado':
        return (
          <th {...commonHeaderProps} className={`${commonHeaderProps.className} text-center`}>
            <span>Estado</span>
            {resizeHandle}
          </th>
        );
      case 'acciones':
        return (
          <th {...commonHeaderProps} className={`${commonHeaderProps.className} text-right pr-2`}>
            <span>Acciones</span>
            {resizeHandle}
          </th>
        );
      default:
        return null;
    }
  };

  const renderCell = (colId: string, plan: Planificacion, idx: number, linePlans: Planificacion[]) => {
    switch (colId) {
      case 'n':
        return (
          <td className="py-2.5 text-center">
            <div className="flex items-center justify-center gap-2">
              <div className="flex flex-col gap-0.5 opacity-30 select-none cursor-grab" title="Prioridad de producción">
                <div className="flex gap-0.5">
                  <span className="w-0.5 h-0.5 rounded-full bg-slate-500 dark:bg-slate-400" />
                  <span className="w-0.5 h-0.5 rounded-full bg-slate-500 dark:bg-slate-400" />
                </div>
                <div className="flex gap-0.5">
                  <span className="w-0.5 h-0.5 rounded-full bg-slate-500 dark:bg-slate-400" />
                  <span className="w-0.5 h-0.5 rounded-full bg-slate-500 dark:bg-slate-400" />
                </div>
                <div className="flex gap-0.5">
                  <span className="w-0.5 h-0.5 rounded-full bg-slate-500 dark:bg-slate-400" />
                  <span className="w-0.5 h-0.5 rounded-full bg-slate-500 dark:bg-slate-400" />
                </div>
              </div>
              <span className="font-mono font-extrabold text-[10px] text-slate-700 dark:text-slate-355 min-w-3 text-center">
                {idx + 1}
              </span>
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => handleMovePlan(plan.id!, 'up')}
                  disabled={idx === 0}
                  className={`p-0.5 hover:bg-slate-500/10 rounded transition-colors ${
                    idx === 0 ? 'opacity-0 pointer-events-none' : 'text-slate-400 hover:text-blue-500 hover:scale-110'
                  }`}
                  title="Subir prioridad"
                >
                  <ChevronUp className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => handleMovePlan(plan.id!, 'down')}
                  disabled={idx === linePlans.length - 1}
                  className={`p-0.5 hover:bg-slate-500/10 rounded transition-colors ${
                    idx === linePlans.length - 1 ? 'opacity-0 pointer-events-none' : 'text-slate-400 hover:text-blue-500 hover:scale-110'
                  }`}
                  title="Bajar prioridad"
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
              </div>
            </div>
          </td>
        );
      case 'turno':
        return (
          <td className="py-2.5">
            <span className={`font-semibold text-[8px] uppercase px-1.5 py-0.5 rounded border ${getTurnoBadgeClass()}`}>
              {plan.turno}
            </span>
          </td>
        );
      case 'sku':
        return (
          <td className="py-2.5 font-bold text-slate-800">
            {plan.product_sku}
          </td>
        );
      case 'producto':
        return (
          <td className="py-2.5 text-slate-650 font-medium overflow-hidden" title={`${plan.product_name || 'Desconocido'}${plan.product_formato ? ` (${plan.product_formato})` : ''}`}>
            <div className="font-semibold text-slate-800 dark:text-slate-200 truncate">
              {plan.product_name || 'Desconocido'}{plan.product_formato ? ` (${plan.product_formato})` : ''}
            </div>
            {(() => {
              const divisor = getPlanDivisor(plan);
              if (divisor > 0) {
                const pallets = plan.cantidad_programada / divisor;
                return (
                  <div className="text-[10px] text-slate-455 dark:text-slate-500 font-mono font-semibold mt-0.5">
                    {pallets.toFixed(1)} Pallets de {divisor} unidades
                  </div>
                );
              }
              return (
                <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                  Sin empaque secundario
                </div>
              );
            })()}
          </td>
        );
      case 'marca':
        return (
          <td className="py-2.5 text-slate-500 font-semibold truncate max-w-[110px]" title={plan.product_marca || 'S/M'}>
            {plan.product_marca || 'S/M'}
          </td>
        );
      case 'envPri':
        return (
          (() => {
            const envaseNombre = plan.product_envase_primario_tipo || 'BOTELLA';
            const envaseObj = tiposEnvasePrimario.find(t => t.nombre === envaseNombre);
            const displayEnvase = envaseObj && envaseObj.codigo 
              ? `${envaseObj.codigo} ${envaseObj.nombre}`
              : envaseNombre;
            return (
              <td className="py-2.5 text-slate-500 font-semibold whitespace-nowrap" title={displayEnvase}>
                {displayEnvase}
              </td>
            );
          })()
        );
      case 'envSec':
        return (
          <td className="py-2.5">
            {plan.envase_secundario_tipo && plan.envase_secundario_tipo !== 'NO APLICA' ? (
              <span className={`px-1.5 py-0.5 rounded-sm text-[8px] font-bold tracking-wider border ${getEnvaseSecundarioBadgeClass(plan.envase_secundario_tipo)}`}>
                {plan.envase_secundario_tipo}
              </span>
            ) : (
              <span className="text-slate-400 font-medium text-xs">-</span>
            )}
          </td>
        );
      case 'tapa':
        return (
          (() => {
            const tapaNombre = plan.product_tapa_tipo;
            if (!tapaNombre || tapaNombre === 'NO APLICA' || tapaNombre === '-') {
              return (
                <td className="py-2.5 text-slate-400 font-medium text-xs">
                  -
                </td>
              );
            }
            const tapaObj = tiposTapa.find(t => t.nombre === tapaNombre);
            const displayTapa = tapaObj && tapaObj.codigo 
              ? `${tapaObj.codigo} ${tapaObj.nombre}`
              : tapaNombre;
            return (
              <td className="py-2.5 text-slate-500 font-semibold whitespace-nowrap" title={displayTapa}>
                {displayTapa}
              </td>
            );
          })()
        );
      case 'cantidad':
        return (
          <td className="py-2.5 text-right pr-2">
            <div className="font-mono font-bold text-blue-600 dark:text-blue-400">
              {plan.cantidad_programada.toLocaleString()}
            </div>
          </td>
        );
      case 'obs':
        return (
          <td className="py-2.5 px-4 italic text-slate-400 dark:text-slate-500 truncate max-w-[200px]" title={plan.observaciones || ''}>
            {plan.observaciones || '-'}
          </td>
        );
      case 'estado':
        return (
          <td className="py-2 px-1">
            <div className="flex justify-center">
              <div className="relative w-[96px] h-7 bg-slate-100 dark:bg-slate-800/80 rounded-full p-0.5 flex items-center select-none border border-slate-200 dark:border-slate-700/80 shadow-inner">
                {/* Sliding thumb */}
                <div 
                  onClick={() => handleToggleState(plan)}
                  className={`absolute top-[2px] bottom-[2px] w-7 rounded-full shadow-md transition-all duration-300 ease-out flex items-center justify-center text-[11px] font-bold cursor-pointer z-20 ${
                    plan.estado === 'en_proceso' 
                      ? 'left-[34px] bg-blue-500 text-white shadow-blue-500/40' 
                      : plan.estado === 'completado' 
                        ? 'left-[66px] bg-emerald-500 text-white shadow-emerald-500/40' 
                        : 'left-[2px] bg-amber-500 text-white shadow-amber-500/40'
                  }`}
                >
                  {plan.estado === 'en_proceso' ? (
                    <span className="relative flex h-4 w-4 items-center justify-center">
                      <span className="animate-spin absolute inline-flex h-full w-full rounded-full border border-white border-t-transparent opacity-85"></span>
                      <RefreshCw className="w-2.5 h-2.5" />
                    </span>
                  ) : plan.estado === 'completado' ? (
                    <Check className="w-3 h-3 stroke-[3]" />
                  ) : (
                    <Calendar className="w-3 h-3" />
                  )}
                </div>

                {/* Background slots (clickable targets) */}
                <div className="flex w-full justify-between items-center text-slate-400 dark:text-slate-500 text-xs px-[6px] z-10 font-medium">
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleSetState(plan, 'programado'); }}
                    className={`w-6 h-6 flex items-center justify-center rounded-full hover:text-amber-500 transition-colors cursor-pointer ${
                      plan.estado === 'programado' || !plan.estado ? 'opacity-0 pointer-events-none' : ''
                    }`}
                    title="Cambiar a Programado"
                  >
                    <Calendar className="w-3 h-3" />
                  </button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleSetState(plan, 'en_proceso'); }}
                    className={`w-6 h-6 flex items-center justify-center rounded-full hover:text-blue-500 transition-colors cursor-pointer ${
                      plan.estado === 'en_proceso' ? 'opacity-0 pointer-events-none' : ''
                    }`}
                    title="Cambiar a En Proceso"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleSetState(plan, 'completado'); }}
                    className={`w-6 h-6 flex items-center justify-center rounded-full hover:text-emerald-500 transition-colors cursor-pointer ${
                      plan.estado === 'completado' ? 'opacity-0 pointer-events-none' : ''
                    }`}
                    title="Cambiar a Completado"
                  >
                    <Check className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          </td>
        );
      case 'acciones':
        return (
          <td className="py-2.5 text-right whitespace-nowrap pr-2">
            <div className="inline-flex gap-1">
              <button
                onClick={() => handleOpenEditPlan(plan)}
                className="p-1 text-slate-400 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors cursor-pointer"
                title="Editar"
              >
                <Edit className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setDeletingId(plan.id ?? null)}
                className="p-1 text-slate-400 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors cursor-pointer"
                title="Eliminar"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </td>
        );
      default:
        return null;
    }
  };

  const handleDashResizeStart = (e: React.MouseEvent, colKey: string) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = dashColWidths[colKey] || 100;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const newWidth = Math.max(40, startWidth + deltaX);
      setDashColWidths((prev) => ({
        ...prev,
        [colKey]: newWidth
      }));
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const getPlanDivisor = useCallback((p: Planificacion) => {
    const envSecTipo = p.envase_secundario_tipo || (p.envase_secundario === 'Con Envase Secundario' || p.termocontraible === 'Termocontraible' ? 'TERMOCONTRAIBLE' : 'NO APLICA');
    const matched = tiposEmpaque.find(t => t.nombre === envSecTipo);
    const requiresGroup = matched ? matched.requiere_empaque_grupal === 1 : (envSecTipo !== 'NO APLICA');
    return requiresGroup
      ? Number(p.product_cant_grupal || 0)
      : Number(p.product_cant_individual || 0);
  }, [tiposEmpaque]);

  // KPI Calculations
  const totals = useMemo(() => {
    let totalPallets = 0;
    let totalEnvases = 0;
    let totalLiters = 0;

    plans.forEach((p) => {
      const cantProg = p.cantidad_programada || 0;
      totalEnvases += cantProg;

      // Calculate pallets
      const divisor = getPlanDivisor(p);
      if (divisor > 0) {
        totalPallets += (cantProg / divisor);
      }

      // Calculate liters
      const formatoLiters = parseFormatoToLiters(p.product_formato);
      totalLiters += cantProg * formatoLiters;
    });

    return {
      pallets: totalPallets,
      envases: totalEnvases,
      liters: totalLiters
    };
  }, [plans, getPlanDivisor]);

  const envasePrimarioTotals = useMemo(() => {
    const summary: Record<string, { codigo: string; nombre: string; total: number }> = {};

    plans.forEach((p) => {
      const cantProg = p.cantidad_programada || 0;
      const envaseNombre = p.product_envase_primario_tipo || 'BOTELLA';

      const envaseObj = tiposEnvasePrimario.find((t) => t.nombre === envaseNombre);
      const envaseCodigo = envaseObj?.codigo || '-';
      const displayName = envaseObj?.nombre || envaseNombre;

      const key = `${envaseCodigo}_${displayName}`;
      if (!summary[key]) {
        summary[key] = {
          codigo: envaseCodigo,
          nombre: displayName,
          total: 0
        };
      }
      summary[key].total += cantProg;
    });

    return Object.values(summary).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [plans, tiposEnvasePrimario]);

  const tapaTotals = useMemo(() => {
    const summary: Record<string, { codigo: string; nombre: string; total: number }> = {};

    plans.forEach((p) => {
      const cantProg = p.cantidad_programada || 0;
      const tapaNombre = p.product_tapa_tipo;
      if (!tapaNombre || tapaNombre === 'NO APLICA' || tapaNombre === '-') return;

      const tapaObj = tiposTapa.find((t) => t.nombre === tapaNombre);
      const tapaCodigo = tapaObj?.codigo || '-';
      const displayName = tapaObj?.nombre || tapaNombre;

      const key = `${tapaCodigo}_${displayName}`;
      if (!summary[key]) {
        summary[key] = {
          codigo: tapaCodigo,
          nombre: displayName,
          total: 0
        };
      }
      summary[key].total += cantProg;
    });

    return Object.values(summary).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [plans, tiposTapa]);


  // Form Modal States
  const [showFormModal, setShowFormModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentPlanId, setCurrentPlanId] = useState<number | null>(null);
  const [selectedLineaId, setSelectedLineaId] = useState<number | ''>('');
  const [productSearch, setProductSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [qtyProgrammed, setQtyProgrammed] = useState<number | ''>('');
  const [selectedTurno, setSelectedTurno] = useState<'Mañana' | 'Tarde' | 'Noche'>('Mañana');
  const [formDate, setFormDate] = useState('');
  const [savingPlan, setSavingPlan] = useState(false);
  const [isLineFixed, setIsLineFixed] = useState(false);
  const [envaseSecundario, setEnvaseSecundario] = useState<'Con Envase Secundario' | 'Sin Envase Secundario'>('Sin Envase Secundario');
  const [envaseSecundarioTipo, setEnvaseSecundarioTipo] = useState<string>('NO APLICA');
  const [observaciones, setObservaciones] = useState('');

  // Category filters for product selection in autocomplete
  const [filterBusinessLine, setFilterBusinessLine] = useState('');
  const [filterFamily, setFilterFamily] = useState('');
  const [filterMarca, setFilterMarca] = useState('');

  // Delete State
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Sending WhatsApp Loading State per plan ID
  const [sendingWpMap, setSendingWpMap] = useState<{ [key: number]: boolean }>({});

  // Theme Styles mapping
  const cardBg = 'bg-white border-slate-200 text-slate-800 shadow-sm';
  const textMuted = 'text-slate-500';
  const textTitle = 'text-slate-800';
  const borderCol = 'border-slate-200';
  
  const inputClass = 'w-full rounded-lg border border-slate-200 bg-slate-50 text-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:bg-white focus:border-blue-500 focus:ring-blue-500 transition-all';

  // Dynamic badge style helper functions to ensure consistent rendering across Light, Dark, and Glass themes
  const getLineCodeBadgeClass = () => {
    return theme === 'light'
      ? 'bg-blue-50 text-blue-600 border-blue-200'
      : theme === 'glass'
        ? 'bg-blue-500/10 text-blue-300 border-blue-500/20 backdrop-blur-sm'
        : 'bg-blue-950/40 text-blue-400 border-blue-900/50';
  };

  const getVersionBadgeClass = (status: 'unnotified' | 'synced' | 'modified') => {
    if (status === 'synced') {
      return theme === 'light'
        ? 'bg-emerald-50 text-emerald-700 border-emerald-250/30'
        : theme === 'glass'
          ? 'bg-emerald-500/10 text-emerald-350 border-emerald-500/20'
          : 'bg-emerald-950/30 text-emerald-400 border-emerald-900/40';
    } else if (status === 'modified') {
      return theme === 'light'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : theme === 'glass'
          ? 'bg-amber-500/10 text-amber-350 border-amber-500/20'
          : 'bg-amber-950/30 text-amber-450 border-amber-900/40';
    } else {
      return theme === 'light'
        ? 'bg-rose-50 text-rose-700 border-rose-250'
        : theme === 'glass'
          ? 'bg-rose-500/10 text-rose-350 border-rose-500/20'
          : 'bg-rose-950/30 text-rose-450 border-rose-900/40';
    }
  };

  const getLineVersionStatus = (linePlans: Planificacion[]) => {
    if (linePlans.length === 0) {
      return { status: 'unnotified' as const, text: 'Sin Notificar' };
    }
    
    const v = linePlans[0]?.current_version;
    const lastNotifiedState = linePlans[0]?.last_notified_state;
    
    if (!v) {
      return { status: 'unnotified' as const, text: 'Versión: 1 (Borrador)' };
    }
    
    // Sort and serialize current plans
    const sortedPlans = [...linePlans].sort((a, b) => (a.prioridad || 0) - (b.prioridad || 0));
    const currentStateObj = sortedPlans.map(p => ({
      sku: p.product_sku,
      qty: p.cantidad_programada,
      turno: p.turno,
      termo: p.envase_secundario || p.termocontraible || 'Sin Envase Secundario',
      obs: p.observaciones || '',
      prioridad: p.prioridad || 0
    }));
    const currentPlanState = JSON.stringify(currentStateObj);
    
    if (lastNotifiedState === currentPlanState) {
      return { status: 'synced' as const, text: `Versión: ${v} (Enviada)` };
    } else {
      return { status: 'modified' as const, text: `Versión: ${v + 1} (Borrador)` };
    }
  };

  const getQtyBadgeClass = (hasPlans: boolean) => {
    if (hasPlans) {
      return theme === 'light'
        ? 'bg-blue-100 text-blue-750 border-blue-200/30'
        : theme === 'glass'
          ? 'bg-blue-500/15 text-blue-350 border-blue-500/20'
          : 'bg-blue-950/40 text-blue-400 border-blue-900/50';
    } else {
      return theme === 'light'
        ? 'bg-slate-100 text-slate-500 border-slate-200/45'
        : theme === 'glass'
          ? 'bg-white/5 text-slate-400 border-white/5'
          : 'bg-slate-800 text-slate-450 border-slate-700/50';
    }
  };

  const getTurnoBadgeClass = () => {
    return theme === 'light'
      ? 'bg-slate-100 text-slate-600 border-slate-200/20'
      : theme === 'glass'
        ? 'bg-white/5 text-slate-300 border-white/10'
        : 'bg-slate-800 text-slate-400 border-slate-700/30';
  };

  const getEnvaseSecundarioBadgeClass = (tipo: any) => {
    if (tipo && tipo !== 'NO APLICA' && tipo !== 'Sin Envase Secundario') {
      return theme === 'light'
        ? 'bg-purple-50 text-purple-700 border-purple-200'
        : theme === 'glass'
          ? 'bg-purple-500/10 text-purple-300 border-purple-500/20'
          : 'bg-purple-950/30 text-purple-400 border-purple-900/40';
    } else {
      return theme === 'light'
        ? 'bg-slate-50 text-slate-600 border-slate-200/50'
        : theme === 'glass'
          ? 'bg-white/5 text-slate-400 border-white/5'
          : 'bg-slate-800/60 text-slate-400 border-slate-750';
    }
  };

  // ---- Fetch Config --------------------------------------------------------
  const fetchConfigAndStatus = useCallback(async () => {
    try {
      // Recipient
      const resConfig = await fetch('/api/config/whatsapp_recipient');
      if (resConfig.ok) {
        const data = await resConfig.json();
        setWhatsappRecipient(data.value);
      }
      // Status
      const resStatus = await fetch('/api/whatsapp/status');
      if (resStatus.ok) {
        const data = await resStatus.json();
        setWhatsappConnected(data.status === 'connected');
      }
    } catch {}
  }, []);

  const fetchLineasYPlanes = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const resLines = await fetch('/api/lineas-proceso');
      if (!resLines.ok) throw new Error('Error al obtener líneas de proceso');
      const linesData: LineaProceso[] = await resLines.json();

      // Fetch employees to resolve assigned operators in real time
      const resEmpleados = await fetch('/api/empleados');
      let empleadosData: any[] = [];
      if (resEmpleados.ok) {
        empleadosData = await resEmpleados.json();
      }

      // Override line.operador dynamically by matching with the empleados table
      const resolvedLines = linesData.map(l => {
        const matchingEmp = empleadosData.find((emp: any) => {
          if (!emp.linea_proceso) return false;
          const empLineStr = emp.linea_proceso.toLowerCase().trim();
          const lineCode = l.codigo.toLowerCase().trim();
          const lineDesc = l.descripcion.toLowerCase().trim();
          
          return (
            empLineStr === lineDesc ||
            empLineStr === lineCode ||
            empLineStr === `linea ${lineCode}` ||
            empLineStr === `linea ${parseInt(lineCode, 10)}`
          );
        });

        return {
          ...l,
          operador: matchingEmp ? matchingEmp.nombre.trim() : l.operador
        };
      });
      setLineas(resolvedLines);

      // Fetch plans
      const resPlans = await fetch(`/api/planificaciones?fecha=${selectedDate}`);
      if (!resPlans.ok) throw new Error('Error al obtener planificaciones');
      const plansData: Planificacion[] = await resPlans.json();
      setPlans(plansData);
    } catch (err: any) {
      if (!silent) {
        onShowToast?.(err.message || 'Error al cargar datos', 'error');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [selectedDate, onShowToast]);

  const fetchDashboardData = useCallback(async (silent = false) => {
    if (!silent) setDashLoading(true);
    try {
      let prevStartDate = dashStartDate;
      if (dashStartDate && dashEndDate) {
        const start = new Date(dashStartDate);
        const end = new Date(dashEndDate);
        const diffTime = Math.abs(end.getTime() - start.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

        const prevStartDateObj = new Date(start);
        prevStartDateObj.setDate(prevStartDateObj.getDate() - diffDays);
        prevStartDate = prevStartDateObj.toISOString().split('T')[0];
      }

      const res = await fetch(`/api/planificaciones?fecha_inicio=${prevStartDate}&fecha_fin=${dashEndDate}`);
      if (!res.ok) throw new Error("Error fetching dashboard data");
      const data = await res.json();
      setDashPlans(data);
      lastLoadedDatesRef.current = { start: dashStartDate, end: dashEndDate };

      setStatsLoading(true);
      fetch('/api/dashboard/history-stats')
        .then(async r => {
          if (r.ok) {
            const stats = await r.json();
            setHistoryStats(stats);
          }
        })
        .catch(err => console.error("Error fetching historical stats:", err))
        .finally(() => setStatsLoading(false));
    } catch (e: any) {
      console.error(e);
      onShowToast?.("Error al cargar datos del dashboard", "error");
    } finally {
      if (!silent) setDashLoading(false);
    }
  }, [dashStartDate, dashEndDate, onShowToast]);

  useEffect(() => {
    if (activeTab === 'dashboard') {
      const isAlreadyLoaded = lastLoadedDatesRef.current.start === dashStartDate && 
                              lastLoadedDatesRef.current.end === dashEndDate && 
                              dashPlans.length > 0;
      fetchDashboardData(isAlreadyLoaded);
    }
  }, [activeTab, fetchDashboardData, dashPlans.length, dashStartDate, dashEndDate]);

  useEffect(() => {
    fetchLineasYPlanes(false);
    fetchConfigAndStatus();
  }, [fetchLineasYPlanes, fetchConfigAndStatus]);

  // Refresco silencioso en segundo plano cada 15 segundos
  useEffect(() => {
    const interval = setInterval(() => {
      fetchLineasYPlanes(true);
      if (activeTab === 'dashboard') {
        fetchDashboardData(true);
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchLineasYPlanes, activeTab, fetchDashboardData]);

  // Unique options for cascading categories (only active products)
  const activeProducts = useMemo(() => {
    return products.filter(p => p.activo !== false);
  }, [products]);

  const uniqueBusinessLines = useMemo(() => {
    return Array.from(new Set(activeProducts.map(p => p.business_line).filter(Boolean))).sort() as string[];
  }, [activeProducts]);

  const uniqueFamilies = useMemo(() => {
    let list = activeProducts;
    if (filterBusinessLine) {
      list = list.filter(p => p.business_line === filterBusinessLine);
    }
    return Array.from(new Set(list.map(p => p.family).filter(Boolean))).sort() as string[];
  }, [activeProducts, filterBusinessLine]);

  const uniqueMarcas = useMemo(() => {
    let list = activeProducts;
    if (filterBusinessLine) {
      list = list.filter(p => p.business_line === filterBusinessLine);
    }
    if (filterFamily) {
      list = list.filter(p => p.family === filterFamily);
    }
    return Array.from(new Set(list.map(p => p.marca).filter(Boolean))).sort() as string[];
  }, [activeProducts, filterBusinessLine, filterFamily]);

  // Product Autocomplete filter
  const filteredProducts = useMemo(() => {
    let list = activeProducts;

    // Apply categories cascading filters
    if (filterBusinessLine) {
      list = list.filter(p => p.business_line === filterBusinessLine);
    }
    if (filterFamily) {
      list = list.filter(p => p.family === filterFamily);
    }
    if (filterMarca) {
      list = list.filter(p => p.marca === filterMarca);
    }

    const searchStr = productSearch.trim().toLowerCase();
    if (!searchStr) {
      return list.slice(0, 50);
    }
    return list.filter(p => 
      p.sku.toLowerCase().includes(searchStr) ||
      p.item_name.toLowerCase().includes(searchStr) ||
      (p.marca && p.marca.toLowerCase().includes(searchStr))
    ).slice(0, 50);
  }, [productSearch, products, filterBusinessLine, filterFamily, filterMarca]);

  // ---- CRUD Actions --------------------------------------------------------
  const handleOpenNewPlan = (lineaId?: number) => {
    setIsEditing(false);
    setCurrentPlanId(null);
    setSelectedLineaId(lineaId || '');
    setIsLineFixed(!!lineaId);
    setProductSearch('');
    setSelectedProduct(null);
    setQtyProgrammed('');
    setSelectedTurno('Mañana');
    setFormDate(selectedDate);
    setEnvaseSecundario('Sin Envase Secundario');
    setEnvaseSecundarioTipo('NO APLICA');
    setObservaciones('');
    setFilterBusinessLine('');
    setFilterFamily('');
    setFilterMarca('');
    setShowFormModal(true);
  };

  const handleOpenEditPlan = (plan: Planificacion) => {
    setIsEditing(true);
    setCurrentPlanId(plan.id ?? null);
    setSelectedLineaId(plan.linea_id);
    setIsLineFixed(true);
    const prod = products.find(p => p.sku === plan.product_sku) || null;
    setSelectedProduct(prod);
    setProductSearch(prod ? `${prod.sku} - ${prod.item_name} - ${prod.marca || 'S/M'}` : plan.product_sku);
    setQtyProgrammed(plan.cantidad_programada);
    setSelectedTurno((plan.turno as any) || 'Mañana');
    setFormDate(plan.fecha);
    const envVal = plan.envase_secundario || plan.termocontraible;
    setEnvaseSecundario(envVal === 'Con Envase Secundario' || envVal === 'Termocontraible' ? 'Con Envase Secundario' : 'Sin Envase Secundario');
    setEnvaseSecundarioTipo(plan.envase_secundario_tipo || (envVal === 'Con Envase Secundario' || envVal === 'Termocontraible' ? 'TERMOCONTRAIBLE' : 'NO APLICA'));
    setObservaciones(plan.observaciones || '');
    setFilterBusinessLine(prod?.business_line || '');
    setFilterFamily(prod?.family || '');
    setFilterMarca(prod?.marca || '');
    setShowFormModal(true);
  };

  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLineaId || !selectedProduct || !qtyProgrammed || !formDate) {
      onShowToast?.('Por favor completa todos los campos obligatorios', 'error');
      return;
    }

    setSavingPlan(true);
    const body = {
      linea_id: Number(selectedLineaId),
      product_sku: selectedProduct.sku,
      cantidad_programada: Number(qtyProgrammed),
      fecha: formDate,
      turno: selectedTurno,
      estado: isEditing ? (plans.find(p => p.id === currentPlanId)?.estado || 'programado') : 'programado',
      envase_secundario: envaseSecundario,
      termocontraible: envaseSecundario === 'Con Envase Secundario' ? 'Termocontraible' : 'Sin Termocontraible',
      envase_secundario_tipo: envaseSecundarioTipo,
      observaciones,
    };

    try {
      const url = isEditing ? `/api/planificaciones/${currentPlanId}` : '/api/planificaciones';
      const method = isEditing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Error al guardar la planificación');
      }

      onShowToast?.(isEditing ? 'Planificación actualizada' : 'Planificación agregada', 'success');
      setShowFormModal(false);
      await fetchLineasYPlanes(true);
      await fetchDashboardData(true);
    } catch (err: any) {
      onShowToast?.(err.message, 'error');
    } finally {
      setSavingPlan(false);
    }
  };

  const handleSetState = async (plan: Planificacion, nextState: string) => {
    try {
      const res = await fetch(`/api/planificaciones/${plan.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...plan,
          estado: nextState
        }),
      });

      if (!res.ok) throw new Error('Error al cambiar el estado');
      onShowToast?.(`Estado actualizado a ${nextState.replace('_', ' ')}`, 'success');
      await fetchLineasYPlanes(true);
      await fetchDashboardData(true);
    } catch (err: any) {
      onShowToast?.(err.message, 'error');
    }
  };

  const handleToggleState = async (plan: Planificacion) => {
    const nextStateMap: { [key: string]: string } = {
      'programado': 'en_proceso',
      'en_proceso': 'completado',
      'completado': 'programado'
    };
    const nextState = nextStateMap[plan.estado || 'programado'] || 'programado';
    await handleSetState(plan, nextState);
  };

  const handleDeletePlan = async () => {
    if (deletingId == null) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/planificaciones/${deletingId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Error al eliminar planificación');
      onShowToast?.('Planificación eliminada', 'success');
      setDeletingId(null);
      await fetchLineasYPlanes(true);
      await fetchDashboardData(true);
    } catch (err: any) {
      onShowToast?.(err.message, 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleMovePlan = async (id: number, direction: 'up' | 'down') => {
    try {
      const res = await fetch(`/api/planificaciones/${id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction }),
      });
      if (!res.ok) throw new Error('Error al cambiar la prioridad');
      await fetchLineasYPlanes(true);
      await fetchDashboardData(true);
    } catch (err: any) {
      onShowToast?.(err.message, 'error');
    }
  };

  const handlePrintConsolidatedReport = () => {
    if (plans.length === 0) return;

    try {
      const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4',
      });

      // Slate-900 general header
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, 297, 30, 'F');

      // Title
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.text('AQUAOPS - CONSOLIDADO DIARIO DE PRODUCCIÓN', 14, 12);
      
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(203, 213, 225);
      doc.text(`Fecha Planificación: ${selectedDate} | Emitido: ${new Date().toLocaleDateString()}`, 14, 22);

      let currentY = 40;

      // Group planifications by process line
      const plansByLinea = new Map<number, Planificacion[]>();
      plans.forEach(p => {
        if (!plansByLinea.has(p.linea_id)) {
          plansByLinea.set(p.linea_id, []);
        }
        plansByLinea.get(p.linea_id)!.push(p);
      });

      // Render each process line that has planifications
      lineas.forEach((linea) => {
        const linePlans = plansByLinea.get(linea.id) || [];
        if (linePlans.length === 0) return;

        // Check page overflow before drawing header
        if (currentY > 155) {
          doc.addPage();
          currentY = 20;
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(15, 23, 42); // slate-900
        doc.text(`LÍNEA: [${linea.codigo}] - ${linea.descripcion || ''}`, 14, currentY);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139); // slate-500
        const v = linePlans[0]?.current_version;
        const versionStr = v ? `Versión: ${v}` : 'Sin Notificar';
        doc.text(`Máquina: ${linea.tipo_maquina || 'No especificada'} | Operador: ${linea.operador || 'No asignado'} | ${versionStr}`, 14, currentY + 4);

        const tableBody = linePlans.map((p, idx) => {
          const divisor = getPlanDivisor(p);
          const palletsStr = divisor > 0
            ? `${(p.cantidad_programada / divisor).toFixed(1)} Pallets`
            : '-';
          
          const productCellText = p.product_name
            ? `${p.product_name}${p.product_formato ? ` (${p.product_formato})` : ''}${divisor > 0 ? `\n${(p.cantidad_programada / divisor).toFixed(1)} Pallets de ${divisor} unidades` : ''}`
            : 'Desconocido';

          const envaseNombre = p.product_envase_primario_tipo || 'BOTELLA';
          const envaseObj = tiposEnvasePrimario.find(t => t.nombre === envaseNombre);
          const envaseCode = envaseObj?.codigo ? `${envaseObj.codigo} ` : '';
          const envaseLabel = `${envaseCode}${envaseNombre}`;

          const envSecTipo = p.envase_secundario_tipo || (p.envase_secundario === 'Con Envase Secundario' || p.termocontraible === 'Termocontraible' ? 'TERMOCONTRAIBLE' : 'NO APLICA');
          const envSecLabel = envSecTipo === 'NO APLICA' ? '-' : envSecTipo;

          const tapaNombre = p.product_tapa_tipo;
          const tapaObj = tiposTapa.find(t => t.nombre === tapaNombre);
          const tapaCode = tapaObj?.codigo ? `${tapaObj.codigo} ` : '';
          const tapaLabel = !tapaNombre || tapaNombre === 'NO APLICA' || tapaNombre === '-' ? '-' : `${tapaCode}${tapaNombre}`;

          return [
            (idx + 1).toString(),
            p.turno || 'Mañana',
            p.product_sku,
            productCellText,
            p.product_marca || 'S/M',
            envaseLabel,
            envSecLabel,
            tapaLabel,
            p.cantidad_programada.toLocaleString(),
            (p.estado || 'programado').toUpperCase().replace('_', ' '),
            p.observaciones || '-'
          ];
        });

        const totalQty = linePlans.reduce((sum, p) => sum + (p.cantidad_programada || 0), 0);
        const totalPallets = linePlans.reduce((sum, p) => {
          const divisor = getPlanDivisor(p);
          if (divisor > 0) {
            return sum + (p.cantidad_programada / divisor);
          }
          return sum;
        }, 0);
        const totalPalletsStr = totalPallets > 0 ? ` (${totalPallets.toFixed(1)} Pallets)` : '';

        autoTable(doc, {
          head: [['N°', 'Turno', 'SKU', 'Producto', 'Marca', 'Env. Pri.', 'Env. Sec.', 'Tapa', 'Cantidad', 'Estado', 'Observaciones']],
          body: tableBody,
          foot: [['', '', '', '', '', '', '', 'Total Envases:', `${totalQty.toLocaleString()}${totalPalletsStr}`, '', '']],
          footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 7.5 },
          startY: currentY + 7,
          theme: 'grid',
          headStyles: { fillColor: [30, 41, 59], fontSize: 8 },
          styles: { fontSize: 7.5, cellPadding: 2.5 },
        });

        currentY = (doc as any).lastAutoTable.finalY + 12;
      });

      // ---- Estimacion de Envases Primarios Consolidada ----
      const envaseConsolidated: Record<string, { codigo: string; nombre: string; total: number }> = {};
      plans.forEach(p => {
        const envaseNombre = p.product_envase_primario_tipo || 'BOTELLA';
        const envaseObj = tiposEnvasePrimario.find(t => t.nombre === envaseNombre);
        const envaseCodigo = envaseObj?.codigo || '-';
        const displayName = envaseObj?.nombre || envaseNombre;
        const key = `${envaseCodigo}_${displayName}`;
        if (!envaseConsolidated[key]) {
          envaseConsolidated[key] = { codigo: envaseCodigo, nombre: displayName, total: 0 };
        }
        envaseConsolidated[key].total += p.cantidad_programada || 0;
      });
      const envaseList = Object.values(envaseConsolidated).sort((a, b) => b.total - a.total);

      if (envaseList.length > 0) {
        if (currentY > 140) {
          doc.addPage();
          currentY = 20;
        } else {
          currentY += 5;
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(15, 23, 42); // slate-900
        doc.text('ESTIMACIÓN ACUMULADA DE ENVASES PRIMARIOS REQUERIDOS', 14, currentY);

        const envTableBody = envaseList.map((item) => [
          item.codigo,
          item.nombre,
          item.total.toLocaleString()
        ]);

        const globalTotalEnvases = envaseList.reduce((sum, item) => sum + item.total, 0);

        autoTable(doc, {
          head: [['Código', 'Envase Primario', 'Total Unidades']],
          body: envTableBody,
          foot: [['', 'Total Envases Primarios:', `${globalTotalEnvases.toLocaleString()} uds`]],
          footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 7.5 },
          startY: currentY + 4,
          theme: 'grid',
          headStyles: { fillColor: [16, 185, 129], fontSize: 8 }, // Emerald theme header
          styles: { fontSize: 7.5, cellPadding: 2 },
          margin: { left: 14, right: 14 },
        });

        currentY = (doc as any).lastAutoTable.finalY + 12;
      }

      // ---- Estimacion de Tapas Consolidada ----
      const tapaConsolidated: Record<string, { codigo: string; nombre: string; total: number }> = {};
      plans.forEach(p => {
        const tapaNombre = p.product_tapa_tipo;
        if (!tapaNombre || tapaNombre === 'NO APLICA' || tapaNombre === '-') return;

        const tapaObj = tiposTapa.find(t => t.nombre === tapaNombre);
        const tapaCodigo = tapaObj?.codigo || '-';
        const displayName = tapaObj?.nombre || tapaNombre;
        const key = `${tapaCodigo}_${displayName}`;
        if (!tapaConsolidated[key]) {
          tapaConsolidated[key] = { codigo: tapaCodigo, nombre: displayName, total: 0 };
        }
        tapaConsolidated[key].total += p.cantidad_programada || 0;
      });
      const tapaList = Object.values(tapaConsolidated).sort((a, b) => b.total - a.total);

      if (tapaList.length > 0) {
        if (currentY > 140) {
          doc.addPage();
          currentY = 20;
        } else {
          currentY += 5;
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(15, 23, 42); // slate-900
        doc.text('ESTIMACIÓN ACUMULADA DE TAPAS REQUERIDAS', 14, currentY);

        const tapaTableBody = tapaList.map((item) => [
          item.codigo,
          item.nombre,
          item.total.toLocaleString()
        ]);

        const globalTotalTapas = tapaList.reduce((sum, item) => sum + item.total, 0);

        autoTable(doc, {
          head: [['Código', 'Tipo de Tapa', 'Total Unidades']],
          body: tapaTableBody,
          foot: [['', 'Total Tapas:', `${globalTotalTapas.toLocaleString()} uds`]],
          footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 7.5 },
          startY: currentY + 4,
          theme: 'grid',
          headStyles: { fillColor: [139, 92, 246], fontSize: 8 }, // Violet theme header
          styles: { fontSize: 7.5, cellPadding: 2 },
          margin: { left: 14, right: 14 },
        });

        currentY = (doc as any).lastAutoTable.finalY + 12;
      }

      // Bottom Signatures block
      // Check page overflow for signatures
      if (currentY > 150) {
        doc.addPage();
        currentY = 20;
      }

      currentY += 15;
      doc.setDrawColor(203, 213, 225);
      doc.line(30, currentY, 100, currentY);
      doc.line(197, currentY, 267, currentY);

      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text('Firma Jefe de Producción', 42, currentY + 5);
      doc.text('Firma Operador Responsable', 212, currentY + 5);

      doc.setFontSize(7);
      doc.text('Generado automáticamente por AquaOps.', 14, 200);

      doc.save(`consolidado_produccion_${selectedDate}.pdf`);
      onShowToast?.('Consolidado descargado con éxito', 'success');
    } catch (err: any) {
      onShowToast?.('Error al generar consolidado: ' + err.message, 'error');
    }
  };

  // ---- PDF & WhatsApp Notification -----------------------------------------
  const handleNotifyWhatsApp = async (linea: LineaProceso, linePlans: Planificacion[]) => {
    if (linePlans.length === 0) return;
    const recipientsList: string[] = [];
    if (linea.whatsapp_phone) {
      const phones = linea.whatsapp_phone.split(/[,;]+/).map(p => {
        const clean = p.replace(/\D/g, '');
        if (!clean) return '';
        return clean.includes('@') ? clean : `${clean}@s.whatsapp.net`;
      }).filter(Boolean);
      if (phones.length > 0) {
        recipientsList.push(phones.join(','));
      }
    }
    if (linea.whatsapp_group_id && (linea.whatsapp_group_id as string).trim()) {
      recipientsList.push(linea.whatsapp_group_id.trim());
    }
    if (recipientsList.length === 0 && whatsappRecipient) {
      recipientsList.push(whatsappRecipient);
    }
    const targetRecipient = recipientsList.join(',');

    if (!targetRecipient) {
      onShowToast?.('WhatsApp no configurado. Asigna un teléfono/grupo a esta línea o define el grupo global en Configuración.', 'error');
      return;
    }
    if (!whatsappConnected) {
      onShowToast?.('WhatsApp desconectado. Vincula el celular del Jefe de Producción en Configuración.', 'error');
      return;
    }

    const notificationKey = linea.id!;
    setSendingWpMap(prev => ({ ...prev, [notificationKey]: true }));
    try {
      // 1. Generate PDF on client side
      const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4',
      });

      // Member card styles & header
      doc.setFillColor(15, 23, 42); // slate-900 background for header
      doc.rect(0, 0, 297, 35, 'F');

      // Title
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text('AQUAOPS - PLANIFICACIÓN DE PRODUCCIÓN', 14, 15);
      
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(203, 213, 225); // slate-300
      doc.text(`Fecha del Reporte: ${new Date().toLocaleDateString()}`, 14, 25);

      // Body Info
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text('Planificación Diaria por Línea de Proceso', 14, 48);

      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139); // slate-500
      
      // Left details block
      doc.text('INFORMACIÓN DE LÍNEA', 14, 56);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(`Línea: [${linea.codigo}] ${linea.descripcion}`, 14, 61);
      doc.setFont('helvetica', 'normal');
      doc.text(`Máquina: ${linea.tipo_maquina || 'No especificada'}`, 14, 66);
      doc.text(`Operador: ${linea.operador || 'No asignado'}`, 14, 71);

      // Right details block
      doc.setTextColor(100, 116, 139);
      doc.text('INFORMACIÓN GENERAL', 180, 56);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(`Fecha Planificada: ${selectedDate}`, 180, 61);
      doc.setFont('helvetica', 'normal');
      const v = linePlans[0]?.current_version;
      const versionStatus = getLineVersionStatus(linePlans);
      const nextVer = v ? (versionStatus.status === 'synced' ? v : v + 1) : 1;
      doc.text(`Versión: ${nextVer}`, 180, 66);

      // Draw table for Product assignments (sorted by priority)
      const tableBody = linePlans.map((p, idx) => {
        const divisor = getPlanDivisor(p);
        const palletsStr = divisor > 0
          ? `${(p.cantidad_programada / divisor).toFixed(1)} Pallets`
          : '-';
        
        const productCellText = p.product_name
          ? `${p.product_name}${p.product_formato ? ` (${p.product_formato})` : ''}${divisor > 0 ? `\n${(p.cantidad_programada / divisor).toFixed(1)} Pallets de ${divisor} unidades` : ''}`
          : 'Desconocido';

        const envaseNombre = p.product_envase_primario_tipo || 'BOTELLA';
        const envaseObj = tiposEnvasePrimario.find(t => t.nombre === envaseNombre);
        const envaseCode = envaseObj?.codigo ? `${envaseObj.codigo} ` : '';
        const envaseLabel = `${envaseCode}${envaseNombre}`;

        const envSecTipo = p.envase_secundario_tipo || (p.envase_secundario === 'Con Envase Secundario' || p.termocontraible === 'Termocontraible' ? 'TERMOCONTRAIBLE' : 'NO APLICA');
        const envSecLabel = envSecTipo === 'NO APLICA' ? '-' : envSecTipo;

        const tapaNombre = p.product_tapa_tipo;
        const tapaObj = tiposTapa.find(t => t.nombre === tapaNombre);
        const tapaCode = tapaObj?.codigo ? `${tapaObj.codigo} ` : '';
        const tapaLabel = !tapaNombre || tapaNombre === 'NO APLICA' || tapaNombre === '-' ? '-' : `${tapaCode}${tapaNombre}`;

        return [
          (idx + 1).toString(),
          p.turno || 'Mañana',
          p.product_sku,
          productCellText,
          p.product_marca || 'S/M',
          envaseLabel,
          envSecLabel,
          tapaLabel,
          p.cantidad_programada.toLocaleString(),
          (p.estado || 'programado').toUpperCase().replace('_', ' '),
          p.observaciones || '-'
        ];
      });

      const totalQty = linePlans.reduce((sum, p) => sum + (p.cantidad_programada || 0), 0);
      const totalPallets = linePlans.reduce((sum, p) => {
        const divisor = getPlanDivisor(p);
        if (divisor > 0) {
          return sum + (p.cantidad_programada / divisor);
        }
        return sum;
      }, 0);
      const totalPalletsStr = totalPallets > 0 ? ` (${totalPallets.toFixed(1)} Pallets)` : '';

      autoTable(doc, {
        head: [['N°', 'Turno', 'SKU', 'Producto', 'Marca', 'Env. Pri.', 'Env. Sec.', 'Tapa', 'Cantidad', 'Estado', 'Observaciones']],
        body: tableBody,
        foot: [['', '', '', '', '', '', '', 'Total Envases:', `${totalQty.toLocaleString()}${totalPalletsStr}`, '', '']],
        footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 8 },
        startY: 80,
        theme: 'grid',
        headStyles: { fillColor: [30, 41, 59] }, // slate-800
        styles: { fontSize: 8, cellPadding: 3 },
      });

      // ---- Estimacion de Envases Primarios para esta Línea ----
      const envaseLine: Record<string, { codigo: string; nombre: string; total: number }> = {};
      linePlans.forEach(p => {
        const envaseNombre = p.product_envase_primario_tipo || 'BOTELLA';
        const envaseObj = tiposEnvasePrimario.find(t => t.nombre === envaseNombre);
        const envaseCodigo = envaseObj?.codigo || '-';
        const displayName = envaseObj?.nombre || envaseNombre;
        const key = `${envaseCodigo}_${displayName}`;
        if (!envaseLine[key]) {
          envaseLine[key] = { codigo: envaseCodigo, nombre: displayName, total: 0 };
        }
        envaseLine[key].total += p.cantidad_programada || 0;
      });
      const envaseLineList = Object.values(envaseLine).sort((a, b) => b.total - a.total);

      let finalY = (doc as any).lastAutoTable.finalY + 12;

      if (envaseLineList.length > 0) {
        if (finalY > 140) {
          doc.addPage();
          finalY = 20;
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(15, 23, 42); // slate-900
        doc.text('ESTIMACIÓN DE ENVASES PRIMARIOS REQUERIDOS (ESTA LÍNEA)', 14, finalY);

        const envLineTableBody = envaseLineList.map((item) => [
          item.codigo,
          item.nombre,
          item.total.toLocaleString()
        ]);

        const lineTotalEnvases = envaseLineList.reduce((sum, item) => sum + item.total, 0);

        autoTable(doc, {
          head: [['Código', 'Envase Primario', 'Total Unidades']],
          body: envLineTableBody,
          foot: [['', 'Total Envases Primarios:', `${lineTotalEnvases.toLocaleString()} uds`]],
          footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 7.5 },
          startY: finalY + 4,
          theme: 'grid',
          headStyles: { fillColor: [16, 185, 129], fontSize: 8 }, // Emerald theme header
          styles: { fontSize: 7.5, cellPadding: 2 },
          margin: { left: 14, right: 14 },
        });

        finalY = (doc as any).lastAutoTable.finalY + 20;
      } else {
        finalY = (doc as any).lastAutoTable.finalY + 25;
      }

      // ---- Estimacion de Tapas para esta Línea ----
      const tapaLine: Record<string, { codigo: string; nombre: string; total: number }> = {};
      linePlans.forEach(p => {
        const tapaNombre = p.product_tapa_tipo;
        if (!tapaNombre || tapaNombre === 'NO APLICA' || tapaNombre === '-') return;

        const tapaObj = tiposTapa.find(t => t.nombre === tapaNombre);
        const tapaCodigo = tapaObj?.codigo || '-';
        const displayName = tapaObj?.nombre || tapaNombre;
        const key = `${tapaCodigo}_${displayName}`;
        if (!tapaLine[key]) {
          tapaLine[key] = { codigo: tapaCodigo, nombre: displayName, total: 0 };
        }
        tapaLine[key].total += p.cantidad_programada || 0;
      });
      const tapaLineList = Object.values(tapaLine).sort((a, b) => b.total - a.total);

      if (tapaLineList.length > 0) {
        if (finalY > 140) {
          doc.addPage();
          finalY = 20;
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(15, 23, 42); // slate-900
        doc.text('ESTIMACIÓN DE TAPAS REQUERIDAS (ESTA LÍNEA)', 14, finalY);

        const tapaLineTableBody = tapaLineList.map((item) => [
          item.codigo,
          item.nombre,
          item.total.toLocaleString()
        ]);

        const lineTotalTapas = tapaLineList.reduce((sum, item) => sum + item.total, 0);

        autoTable(doc, {
          head: [['Código', 'Tipo de Tapa', 'Total Unidades']],
          body: tapaLineTableBody,
          foot: [['', 'Total Tapas:', `${lineTotalTapas.toLocaleString()} uds`]],
          footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 7.5 },
          startY: finalY + 4,
          theme: 'grid',
          headStyles: { fillColor: [139, 92, 246], fontSize: 8 }, // Violet theme header
          styles: { fontSize: 7.5, cellPadding: 2 },
          margin: { left: 14, right: 14 },
        });

        finalY = (doc as any).lastAutoTable.finalY + 20;
      } else {
        finalY = finalY + 5;
      }

      // Signature area
      if (finalY > 170) {
        doc.addPage();
        finalY = 40;
      }
      doc.setDrawColor(203, 213, 225);
      doc.line(30, finalY, 100, finalY);
      doc.line(197, finalY, 267, finalY);

      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139); // slate-500
      doc.text('Firma Jefe de Producción', 42, finalY + 5);
      doc.text('Firma Operador Responsable', 212, finalY + 5);

      // Footer note
      doc.setFontSize(7);
      doc.text('Generado automáticamente por AquaOps Pro.', 14, 200);

      // 2. Convert PDF to base64
      const pdfBase64 = doc.output('datauristring').split(',')[1];
      const filename = `planificacion_${linea.codigo}_${selectedDate}.pdf`;
      
      const totalPalletsText = totalPallets > 0 ? `${totalPallets.toFixed(1)} Pallets` : '0 Pallets';
      let caption = `📋 *Planificación de Producción - AquaOps*\n\n` +
        `🔹 *Línea*: ${linea.codigo} (${linea.descripcion || 'S/D'})\n` +
        `🔹 *Fecha*: ${selectedDate}\n\n` +
        `📊 *Resumen Diario*:\n` +
        `🔹 *Total Programado*: ${totalQty.toLocaleString()} uds (${totalPalletsText})\n\n` +
        `📌 *Por favor, abra el reporte PDF adjunto para ver la secuencia detallada de turnos, SKUs, observaciones de productos y requerimientos de envase primario.*`;

      // 3. Serialize plan state to check for changes on backend
      const sortedPlans = [...linePlans].sort((a, b) => (a.prioridad || 0) - (b.prioridad || 0));
      const stateObj = sortedPlans.map(p => ({
        sku: p.product_sku,
        qty: p.cantidad_programada,
        turno: p.turno,
        termo: p.envase_secundario || p.termocontraible || 'Sin Envase Secundario',
        obs: p.observaciones || '',
        prioridad: p.prioridad || 0
      }));
      const plan_state = JSON.stringify(stateObj);

      // 4. Send via backend WhatsApp endpoint
      const res = await fetch('/api/whatsapp/send-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdfBase64,
          filename,
          caption,
          recipient: targetRecipient,
          linea_id: linea.id,
          fecha: selectedDate,
          plan_state,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Error al enviar por WhatsApp');
      }

      const resData = await res.json();
      if (resData.changed === false) {
        onShowToast?.(`ℹ️ La planificación de la línea ${linea.codigo} no ha cambiado. No fue necesario reenviar.`, 'success');
      } else {
        onShowToast?.(`✅ Planificación de la línea ${linea.codigo} enviada al grupo de WhatsApp (Versión ${resData.version || 1})`, 'success');
        await fetchLineasYPlanes(true); // Refresh to update version badge
        await fetchDashboardData(true);
      }
    } catch (err: any) {
      onShowToast?.(err.message, 'error');
    } finally {
      setSendingWpMap(prev => ({ ...prev, [notificationKey]: false }));
    }
  };

  // Group plans by Line ID for easy lookup
  const plansByLinea = useMemo(() => {
    const map = new Map<number, Planificacion[]>();
    plans.forEach(p => {
      if (!map.has(p.linea_id)) {
        map.set(p.linea_id, []);
      }
      map.get(p.linea_id)!.push(p);
    });
    // Ordenar turnos: Mañana, Tarde, Noche
    const shiftOrder = { 'Mañana': 1, 'Tarde': 2, 'Noche': 3 };
    map.forEach((list) => {
      list.sort((a, b) => {
        const orderA = shiftOrder[a.turno as 'Mañana' | 'Tarde' | 'Noche'] || 4;
        const orderB = shiftOrder[b.turno as 'Mañana' | 'Tarde' | 'Noche'] || 4;
        return orderA - orderB;
      });
    });
    return map;
  }, [plans]);

  const empaquesList = tiposEmpaque && tiposEmpaque.length > 0
    ? tiposEmpaque
    : [
        { nombre: 'NO APLICA', requiere_empaque_grupal: 0 },
        { nombre: 'TERMOCONTRAIBLE', requiere_empaque_grupal: 1 },
        { nombre: 'CAJA', requiere_empaque_grupal: 1 }
      ];

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className={`${cardBg} rounded-xl shadow-sm border p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4`}>
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Calendar className="w-5 h-5 text-blue-500" />
            Planificación de Producción
          </h1>
          <p className="text-sm mt-1 text-slate-500">
            Asigna productos y programa la producción diaria en las líneas de envasado.
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Date Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Fecha:</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className={`rounded-lg border px-3 py-1.5 text-xs outline-none focus:ring-1 ${
                theme === 'light' 
                  ? 'border-slate-200 bg-slate-50 text-slate-800 focus:border-blue-500 focus:ring-blue-500 [color-scheme:light]'
                  : 'border-slate-750 bg-slate-900 text-white focus:border-blue-500 focus:ring-blue-500 [color-scheme:dark]'
              }`}
            />
          </div>

          <button
            onClick={() => handleOpenNewPlan()}
            disabled={lineas.length === 0}
            className="inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-lg shadow-sm text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors cursor-pointer disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Nueva Programación
          </button>

          <button
            onClick={handlePrintConsolidatedReport}
            disabled={lineas.length === 0 || plans.length === 0}
            className={`inline-flex items-center justify-center px-4 py-2 border rounded-lg shadow-sm text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 ${
              theme === 'light'
                ? 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                : 'border-slate-750 bg-slate-900 hover:bg-slate-800 text-slate-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5 mr-1.5 text-blue-500" />
            Consolidado del Día
          </button>
        </div>
      </div>

      {/* Tab Selector Buttons */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-6 mt-2">
        <button
          onClick={() => setActiveTab('producto_terminado')}
          className={`pb-2.5 text-xs font-bold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer ${
            activeTab === 'producto_terminado'
              ? 'border-blue-500 text-blue-600 dark:text-blue-400 font-extrabold'
              : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
          }`}
        >
          <ClipboardList className="w-3.5 h-3.5" />
          PRODUCTO TERMINADO
        </button>
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`pb-2.5 text-xs font-bold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer ${
            activeTab === 'dashboard'
              ? 'border-blue-500 text-blue-600 dark:text-blue-400 font-extrabold'
              : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
          }`}
        >
          <BarChart2 className="w-3.5 h-3.5" />
          DASHBOARD
        </button>
      </div>

      {activeTab === 'producto_terminado' ? (
        <>
          {/* Consolidated KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: Pallets */}
        <div className={`${cardBg} rounded-xl border p-5 flex items-center justify-between`}>
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Pallets Consolidados</span>
            <div className="text-2xl font-bold font-mono tracking-tight">
              {totals.pallets.toFixed(1)}
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500">Total estimado de pallets para el día</p>
          </div>
          <div className={`p-3 rounded-lg ${
            theme === 'light' 
              ? 'bg-blue-50 text-blue-600' 
              : theme === 'glass' 
                ? 'bg-blue-500/10 text-blue-300 border border-blue-500/25' 
                : 'bg-blue-950/40 text-blue-400 border border-blue-900/50'
          }`}>
            <Layers className="w-6 h-6" />
          </div>
        </div>

        {/* Card 2: Envases */}
        <div className={`${cardBg} rounded-xl border p-5 flex items-center justify-between`}>
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Envases Planificados</span>
            <div className="text-2xl font-bold font-mono tracking-tight">
              {totals.envases.toLocaleString()}
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500">Suma total de unidades programadas</p>
          </div>
          <div className={`p-3 rounded-lg ${
            theme === 'light' 
              ? 'bg-emerald-50 text-emerald-600' 
              : theme === 'glass' 
                ? 'bg-emerald-500/10 text-emerald-350 border border-emerald-500/25' 
                : 'bg-emerald-950/40 text-emerald-400 border border-emerald-900/50'
          }`}>
            <Boxes className="w-6 h-6" />
          </div>
        </div>

        {/* Card 3: Litros */}
        <div className={`${cardBg} rounded-xl border p-5 flex items-center justify-between`}>
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Litros Totales</span>
            <div className="text-2xl font-bold font-mono tracking-tight">
              {totals.liters.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} L
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500">Volumen total de líquido planificado</p>
          </div>
          <div className={`p-3 rounded-lg ${
            theme === 'light' 
              ? 'bg-violet-50 text-violet-600' 
              : theme === 'glass' 
                ? 'bg-violet-500/10 text-violet-300 border border-violet-500/25' 
                : 'bg-violet-950/40 text-violet-400 border border-violet-900/50'
          }`}>
            <Droplet className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Primary Packaging Accumulated Estimations */}
      {envasePrimarioTotals.length > 0 && (
        <div className={`${cardBg} rounded-xl border p-5 mt-4`}>
          <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-4">
            Estimación de Envases Primarios para el Día
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
            {envasePrimarioTotals.map((item, idx) => {
              const itemBg = theme === 'light'
                ? 'bg-slate-50 border-slate-200'
                : theme === 'glass'
                  ? 'bg-white/5 border-white/10 backdrop-blur-sm'
                  : 'bg-slate-900/30 border-slate-800';

              return (
                <div 
                  key={idx} 
                  className={`flex items-center justify-between p-2.5 border rounded-xl transition-all hover:scale-[1.01] ${itemBg}`}
                >
                  <div className="space-y-0.5 mr-2">
                    <span className="text-[9px] font-bold text-blue-500 font-mono">
                      CÓD. {item.codigo}
                    </span>
                    <h4 className="text-[11px] font-bold text-slate-700 dark:text-slate-300 leading-tight" title={item.nombre}>
                      {item.nombre}
                    </h4>
                  </div>
                  <div className="text-xs font-bold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                    {item.total.toLocaleString()} <span className="text-[9px] text-slate-400 dark:text-slate-500 font-medium">uds</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Global Total Accumulator Card at the bottom */}
          <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800/80 flex justify-end">
            <div className={`p-2.5 px-4 border rounded-xl flex items-center gap-4 ${
              theme === 'light'
                ? 'bg-blue-50/50 border-blue-100 text-blue-800'
                : theme === 'glass'
                  ? 'bg-blue-500/5 border-blue-500/15 backdrop-blur-sm text-blue-300'
                  : 'bg-blue-950/20 border-blue-900/40 text-blue-400'
            }`}>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Total Envases Primarios:
              </span>
              <span className="text-sm font-black font-mono text-blue-600 dark:text-blue-400">
                {envasePrimarioTotals.reduce((sum, item) => sum + item.total, 0).toLocaleString()} <span className="text-[10px] font-bold">uds</span>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Tapas Accumulated Estimations */}
      {tapaTotals.length > 0 && (
        <div className={`${cardBg} rounded-xl border p-5 mt-4`}>
          <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-4">
            Estimación de Tapas para el Día
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
            {tapaTotals.map((item, idx) => {
              const itemBg = theme === 'light'
                ? 'bg-slate-50 border-slate-200'
                : theme === 'glass'
                  ? 'bg-white/5 border-white/10 backdrop-blur-sm'
                  : 'bg-slate-900/30 border-slate-800';

              return (
                <div 
                  key={idx} 
                  className={`flex items-center justify-between p-2.5 border rounded-xl transition-all hover:scale-[1.01] ${itemBg}`}
                >
                  <div className="space-y-0.5 mr-2">
                    <span className="text-[9px] font-bold text-violet-500 font-mono">
                      CÓD. {item.codigo}
                    </span>
                    <h4 className="text-[11px] font-bold text-slate-700 dark:text-slate-300 leading-tight" title={item.nombre}>
                      {item.nombre}
                    </h4>
                  </div>
                  <div className="text-xs font-bold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                    {item.total.toLocaleString()} <span className="text-[9px] text-slate-400 dark:text-slate-500 font-medium">uds</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Global Total Accumulator Card at the bottom */}
          <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800/80 flex justify-end">
            <div className={`p-2.5 px-4 border rounded-xl flex items-center gap-4 ${
              theme === 'light'
                ? 'bg-violet-50/50 border-violet-100 text-violet-800'
                : theme === 'glass'
                  ? 'bg-violet-500/5 border-violet-500/15 backdrop-blur-sm text-violet-300'
                  : 'bg-violet-950/20 border-violet-900/40 text-violet-400'
            }`}>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Total Tapas:
              </span>
              <span className="text-sm font-black font-mono text-violet-600 dark:text-violet-400">
                {tapaTotals.reduce((sum, item) => sum + item.total, 0).toLocaleString()} <span className="text-[10px] font-bold">uds</span>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp Status Alert */}
      {(!whatsappRecipient || !whatsappConnected) && (
        <div className={`p-4 rounded-xl border flex items-start gap-3 text-xs leading-relaxed ${
          theme === 'light'
            ? 'bg-amber-50 border-amber-200 text-amber-800'
            : 'bg-amber-950/20 border-amber-900/30 text-amber-400'
        }`}>
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Notificaciones automáticas desactivadas: </span>
            {!whatsappRecipient ? (
              <span>No se ha configurado el grupo o número de WhatsApp de destino. Ingresa a la sección de Configuración para definir el destinatario.</span>
            ) : (
              <span>El celular del Jefe de Producción no está vinculado a la aplicación. Por favor ingresa a Configuración y vincula el celular para realizar envíos automáticos.</span>
            )}
          </div>
        </div>
      )}

      {/* Lines Grid */}
      {loading && lineas.length === 0 ? (
        <div className="text-center py-24 italic text-slate-500 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <span>Cargando líneas y programación del día...</span>
        </div>
      ) : lineas.length === 0 ? (
        <div className={`${cardBg} rounded-xl shadow-sm border p-12 text-center text-sm italic text-slate-500`}>
          No hay líneas de proceso configuradas en el sistema. Ve a la sección de Configuración para agregarlas primero.
        </div>
      ) : (
        <div className={`flex flex-col gap-6 ${loading ? 'opacity-60 transition-opacity pointer-events-none' : ''}`}>
          {lineas.map((linea) => {
            const linePlans = plansByLinea.get(linea.id!) || [];

            return (
              <div key={linea.id} className={`${cardBg} rounded-xl shadow-sm border overflow-hidden flex flex-col justify-between h-auto`}>
                {/* Card Header */}
                <div className={`p-4 border-b ${borderCol} flex justify-between items-center bg-slate-500/5`}>
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getLineCodeBadgeClass()}`}>
                      {linea.codigo}
                    </span>
                    <h3 className="font-bold text-sm text-slate-800">
                      {linea.descripcion}
                    </h3>
                    <span className={`text-[10px] ${textMuted} border-l border-slate-200 pl-3`}>
                      {linea.tipo_maquina || 'Sin Tipo'}
                    </span>
                    {linea.operador && (
                      <span className={`text-[10px] ${textMuted} border-l border-slate-200 pl-3`}>
                        Operador: <span className="font-semibold text-slate-700">{linea.operador}</span>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {linePlans.length > 0 && (
                      (() => {
                        const { status, text } = getLineVersionStatus(linePlans);
                        return (
                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${getVersionBadgeClass(status)}`}>
                            {text}
                          </span>
                        );
                      })()
                    )}

                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${getQtyBadgeClass(linePlans.length > 0)}`}>
                      {linePlans.length > 0 
                        ? `${linePlans.length} ${linePlans.length === 1 ? 'Programación' : 'Programaciones'}`
                        : 'Libre'
                      }
                    </span>
                  </div>
                </div>

                {/* Card Body */}
                <div className="p-4 flex-1 flex flex-col justify-start overflow-x-auto">
                  {linePlans.length > 0 ? (
                      <div className="w-full min-w-[850px]">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">
                          Planificación de Proceso
                        </div>
                      
                      <table className="w-full text-left text-xs border-collapse" style={{ tableLayout: "fixed" }}>
                        <thead>
                          <tr className="border-b border-slate-200 text-[10px] text-slate-400 uppercase tracking-wider">
                            {lineColOrder.map((colId) => (
                              <React.Fragment key={colId}>
                                {renderHeader(colId)}
                              </React.Fragment>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {linePlans.map((plan, idx) => (
                            <tr key={plan.id} className="hover:bg-slate-500/5 transition-colors duration-150 border-b border-slate-200">
                              {lineColOrder.map((colId) => (
                                <React.Fragment key={colId}>
                                  {renderCell(colId, plan, idx, linePlans)}
                                </React.Fragment>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-slate-200 font-bold bg-slate-500/5 text-[10px] text-slate-700 dark:text-slate-300">
                            {lineColOrder.map((colId, index) => {
                              if (colId === 'cantidad') {
                                return (
                                  <td key={colId} className="py-3 text-right text-blue-600 dark:text-blue-400 pr-2">
                                    <div className="font-mono font-extrabold text-xs">
                                      {linePlans.reduce((sum, p) => sum + (p.cantidad_programada || 0), 0).toLocaleString()}
                                    </div>
                                    {(() => {
                                      const totalPallets = linePlans.reduce((sum, p) => {
                                        const divisor = getPlanDivisor(p);
                                        if (divisor > 0) return sum + (p.cantidad_programada / divisor);
                                        return sum;
                                      }, 0);
                                      if (totalPallets > 0) {
                                        return (
                                          <div className="text-[9px] text-slate-450 dark:text-slate-500 font-mono font-semibold leading-tight mt-0.5">
                                            {totalPallets.toFixed(1)} Pallets
                                          </div>
                                        );
                                      }
                                      return null;
                                    })()}
                                  </td>
                                );
                              }
                              
                              const nextColId = lineColOrder[index + 1];
                              if (nextColId === 'cantidad') {
                                return (
                                  <td key={colId} className="py-3 px-3 text-right valign-middle">
                                    Total Envases:
                                  </td>
                                );
                              }
                              return <td key={colId} className="py-3"></td>;
                            })}
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  ) : (
                    <div className="text-center py-6 my-auto">
                      <Cpu className="w-8 h-8 text-slate-300 dark:text-slate-700 mx-auto mb-1.5" />
                      <p className="text-xs text-slate-400 italic">No hay producción programada</p>
                    </div>
                  )}
                </div>

                {/* Card Actions */}
                <div className={`px-4 py-2.5 border-t ${borderCol} flex justify-end gap-3 items-center bg-slate-500/2`}>
                  <button
                    onClick={() => handleOpenNewPlan(linea.id)}
                    className="inline-flex items-center justify-center gap-1 px-4 py-1.5 text-xs font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-slate-800 rounded border border-blue-400/20 transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Programar</span>
                  </button>
                  
                  {linePlans.length > 0 && (
                    <button
                      onClick={() => handleNotifyWhatsApp(linea, linePlans)}
                      disabled={sendingWpMap[linea.id!]}
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold transition-all shadow-sm cursor-pointer disabled:opacity-50"
                    >
                      {sendingWpMap[linea.id!] ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Send className="w-3.5 h-3.5" />
                      )}
                      <span>Notificar</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
        </>
      ) : (
        <PlanificacionDashboard 
          dashPlans={dashPlans}
          products={products}
          theme={theme}
          cardBg={cardBg}
          borderCol={borderCol}
          textMuted={textMuted}
          dashStartDate={dashStartDate}
          setDashStartDate={setDashStartDate}
          dashEndDate={dashEndDate}
          setDashEndDate={setDashEndDate}
          selectedMonth={selectedMonth}
          setSelectedMonth={setSelectedMonth}
          selectedWeek={selectedWeek}
          setSelectedWeek={setSelectedWeek}
          selectedBrand={selectedBrand}
          setSelectedBrand={setSelectedBrand}
          dashLoading={dashLoading}
          fetchDashboardData={fetchDashboardData}
          tiposEnvasePrimario={tiposEnvasePrimario}
          tiposTapa={tiposTapa}
          getPlanDivisor={getPlanDivisor}
          dashColWidths={dashColWidths}
          hoveredResizeCol={hoveredResizeCol}
          setHoveredResizeCol={setHoveredResizeCol}
          handleDashResizeStart={handleDashResizeStart}
          historyStats={historyStats}
          statsLoading={statsLoading}
        />
      )}

      {/* FORM MODAL */}
      {showFormModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs">
          <div className={`${cardBg} rounded-xl shadow-lg border w-full max-w-2xl mx-4 overflow-hidden`}>
            {/* Header */}
            <div className="bg-slate-900 px-6 py-4 text-white flex justify-between items-center">
              <h3 className="font-bold text-sm tracking-wide uppercase flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-400" />
                {isEditing ? 'Editar Programación' : 'Nueva Programación'}
              </h3>
              <button
                onClick={() => setShowFormModal(false)}
                className="text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* Form */}
            <form onSubmit={handleSavePlan} className="p-6 space-y-4">
              {/* Line */}
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Línea de Proceso *
                </label>
                {isLineFixed ? (
                  <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border font-semibold text-sm ${
                    theme === 'light'
                      ? 'border-blue-100 bg-blue-50 text-blue-750'
                      : 'border-blue-900/30 bg-blue-900/10 text-blue-400'
                  }`}>
                    <Cpu className="w-4 h-4 text-blue-500" />
                    <span>
                      {(() => {
                        const l = lineas.find(x => x.id === Number(selectedLineaId));
                        return l ? `${l.codigo} - ${l.descripcion}` : 'Línea Seleccionada';
                      })()}
                    </span>
                  </div>
                ) : (
                  <select
                    required
                    value={selectedLineaId}
                    onChange={(e) => setSelectedLineaId(e.target.value ? Number(e.target.value) : '')}
                    className={inputClass}
                  >
                    <option value="">Selecciona una línea...</option>
                    {lineas.map(l => (
                      <option key={l.id} value={l.id}>{l.codigo} - {l.descripcion}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Cascading category filters */}
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div>
                  <label className="block text-[9px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Línea de Negocio
                  </label>
                  <select
                    value={filterBusinessLine}
                    onChange={(e) => {
                      setFilterBusinessLine(e.target.value);
                      setFilterFamily('');
                      setFilterMarca('');
                      setSelectedProduct(null);
                      setProductSearch('');
                    }}
                    className={inputClass}
                  >
                    <option value="">(Todas)</option>
                    {uniqueBusinessLines.map(bl => (
                      <option key={bl} value={bl}>{bl}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[9px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Familia
                  </label>
                  <select
                    value={filterFamily}
                    onChange={(e) => {
                      setFilterFamily(e.target.value);
                      setFilterMarca('');
                      setSelectedProduct(null);
                      setProductSearch('');
                    }}
                    className={inputClass}
                  >
                    <option value="">(Todas)</option>
                    {uniqueFamilies.map(f => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[9px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Marca
                  </label>
                  <select
                    value={filterMarca}
                    onChange={(e) => {
                      setFilterMarca(e.target.value);
                      setSelectedProduct(null);
                      setProductSearch('');
                    }}
                    className={inputClass}
                  >
                    <option value="">(Todas)</option>
                    {uniqueMarcas.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Product Autocomplete */}
              <div className="relative">
                <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Producto *
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    placeholder="Escribe SKU o Nombre del producto..."
                    value={productSearch}
                    onChange={(e) => {
                      setProductSearch(e.target.value);
                      setSelectedProduct(null);
                      setShowProductDropdown(true);
                    }}
                    onFocus={() => setShowProductDropdown(true)}
                    onBlur={() => setTimeout(() => setShowProductDropdown(false), 200)}
                    className={inputClass}
                  />
                  {selectedProduct && (
                    <span className="absolute right-3 top-2.5 text-emerald-500 text-[10px] font-bold uppercase">
                      ✓ Seleccionado
                    </span>
                  )}
                </div>

                {/* Dropdown list */}
                {showProductDropdown && !selectedProduct && (
                  <div className={`absolute z-10 left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-lg border shadow-lg divide-y divide-slate-100 ${
                    theme === 'light' ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-750'
                  }`}>
                    {filteredProducts.length === 0 ? (
                      <div className="p-3 text-xs text-slate-500 italic text-center">
                        No se encontraron productos
                      </div>
                    ) : (
                      filteredProducts.map(p => (
                        <div
                          key={p.sku}
                          onClick={() => {
                            setSelectedProduct(p);
                            setProductSearch(`${p.sku} - ${p.item_name} - ${p.marca || 'S/M'}`);
                            setShowProductDropdown(false);
                            const defaultTipo = p.envase_secundario_tipo || (p.envase_secundario_default || p.termocontraible_default ? 'TERMOCONTRAIBLE' : 'NO APLICA');
                            setEnvaseSecundarioTipo(defaultTipo);
                            if (defaultTipo !== 'NO APLICA') {
                              setEnvaseSecundario('Con Envase Secundario');
                            } else {
                              setEnvaseSecundario('Sin Envase Secundario');
                            }
                          }}
                          className={`p-3 text-xs text-left cursor-pointer transition-colors whitespace-nowrap overflow-hidden ${
                            theme === 'light' ? 'hover:bg-slate-100 text-slate-800' : 'hover:bg-slate-850 text-white'
                          }`}
                        >
                          <div className="font-semibold">
                            <span className="text-blue-600 dark:text-blue-400">SKU: {p.sku}</span>
                            <span className="text-slate-400 mx-2">|</span>
                            <span>{p.item_name}</span>
                            <span className="text-slate-400 mx-2">|</span>
                            <span className="text-slate-500 dark:text-slate-400">{p.marca || 'S/M'}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Grid 2 Column */}
              <div className="grid grid-cols-2 gap-4">
                {/* Quantity */}
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Cantidad Programada *
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={qtyProgrammed}
                    onChange={(e) => setQtyProgrammed(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="Ej: 5000"
                    className={inputClass}
                  />
                </div>

                {/* Shift */}
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Turno *
                  </label>
                  <select
                    value={selectedTurno}
                    onChange={(e: any) => setSelectedTurno(e.target.value)}
                    className={inputClass}
                  >
                    <option value="Mañana">Mañana</option>
                    <option value="Tarde">Tarde</option>
                    <option value="Noche">Noche</option>
                  </select>
                </div>
              </div>

              {/* Grid 2 Column */}
              <div className="grid grid-cols-2 gap-4">
                {/* Date */}
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Fecha de Programación *
                  </label>
                  <input
                    type="date"
                    required
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className={inputClass}
                  />
                </div>

                {/* Envase Secundario */}
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Envase Secundario *
                  </label>
                  <select
                    value={envaseSecundarioTipo}
                    onChange={(e: any) => {
                      const val = e.target.value;
                      setEnvaseSecundarioTipo(val);
                      if (val !== 'NO APLICA') {
                        setEnvaseSecundario('Con Envase Secundario');
                      } else {
                        setEnvaseSecundario('Sin Envase Secundario');
                      }
                    }}
                    className={inputClass}
                  >
                    {empaquesList.map((tipo) => (
                      <option key={tipo.id || tipo.nombre} value={tipo.nombre}>
                        {tipo.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Info Empaque y Pallets Estimados */}
              {selectedProduct && (
                <div className={`grid grid-cols-2 gap-4 p-3 rounded-lg border ${
                  theme === 'light' 
                    ? 'bg-slate-50/60 border-slate-200' 
                    : 'bg-slate-900/40 border-slate-800'
                }`}>
                  <div>
                    {(() => {
                      const matchedEmpaque = empaquesList.find(t => t.nombre === envaseSecundarioTipo);
                      const requiresGroup = matchedEmpaque ? matchedEmpaque.requiere_empaque_grupal === 1 : (envaseSecundarioTipo !== 'NO APLICA');
                      return (
                        <>
                          <label className="block text-[9px] font-bold text-slate-455 uppercase tracking-wider mb-0.5">
                            Cant. por Pallet ({requiresGroup ? 'Grupal' : 'Individual'})
                          </label>
                          <div className={`text-xs font-bold ${
                            theme === 'light' ? 'text-slate-700' : 'text-slate-300'
                          }`}>
                            {requiresGroup
                              ? `${selectedProduct.cant_grupal || 0} unidades`
                              : `${selectedProduct.cant_individual || 0} unidades`}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-slate-455 uppercase tracking-wider mb-0.5">
                      Pallets Estimados
                    </label>
                    <div className="text-xs font-extrabold text-blue-600 dark:text-blue-400">
                      {(() => {
                        const matchedEmpaque = empaquesList.find(t => t.nombre === envaseSecundarioTipo);
                        const requiresGroup = matchedEmpaque ? matchedEmpaque.requiere_empaque_grupal === 1 : (envaseSecundarioTipo !== 'NO APLICA');
                        const divisor = requiresGroup
                          ? Number(selectedProduct.cant_grupal || 0)
                          : Number(selectedProduct.cant_individual || 0);
                        if (!qtyProgrammed || divisor <= 0) return '0.00 pallets';
                        const pallets = Number(qtyProgrammed) / divisor;
                        return `${pallets.toFixed(2)} pallets`;
                      })()}
                    </div>
                  </div>
                </div>
              )}

              {/* Observaciones */}
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Observaciones
                </label>
                <textarea
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  placeholder="Escribe alguna observación o comentario aquí..."
                  className={`${inputClass} resize-none h-16`}
                />
              </div>

              {/* Actions */}
              <div className="flex justify-end space-x-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowFormModal(false)}
                  className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-semibold text-slate-500 dark:text-slate-450 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingPlan || !selectedProduct}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                >
                  {savingPlan ? 'Guardando...' : 'Guardar Plan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE MODAL */}
      {deletingId != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs">
          <div className={`${cardBg} rounded-xl shadow-lg border w-full max-w-sm mx-4 p-6`}>
            <h3 className="text-lg font-bold text-slate-850 dark:text-white mb-2">Eliminar Planificación</h3>
            <p className="text-sm text-slate-500 mb-6">
              ¿Estás seguro de que deseas eliminar este plan de producción? Esta acción no se puede deshacer.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setDeletingId(null)}
                className="px-4 py-2 border border-slate-200 dark:border-slate-750 rounded-lg text-sm font-semibold text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleDeletePlan}
                disabled={deleting}
                className="px-4 py-2 bg-red-650 hover:bg-red-700 text-white rounded-lg text-sm font-semibold shadow-sm cursor-pointer disabled:opacity-50"
              >
                {deleting ? 'Eliminando...' : 'Sí, Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PlanificacionDashboard Sub-Component ─────────────────────────────────────
interface PlanificacionDashboardProps {
  dashPlans: Planificacion[];
  products: Product[];
  theme: 'light' | 'dark' | 'glass';
  cardBg: string;
  borderCol: string;
  textMuted: string;
  dashStartDate: string;
  setDashStartDate: (d: string) => void;
  dashEndDate: string;
  setDashEndDate: (d: string) => void;
  selectedMonth: string;
  setSelectedMonth: (m: string) => void;
  selectedWeek: string;
  setSelectedWeek: (w: string) => void;
  selectedBrand: string;
  setSelectedBrand: (b: string) => void;
  dashLoading: boolean;
  fetchDashboardData: () => void;
  tiposEnvasePrimario: TipoEnvasePrimario[];
  tiposTapa?: TipoTapa[];
  getPlanDivisor: (p: Planificacion) => number;
  dashColWidths: Record<string, number>;
  hoveredResizeCol: string | null;
  setHoveredResizeCol: (c: string | null) => void;
  handleDashResizeStart: (e: React.MouseEvent, colKey: string) => void;
  historyStats: { globalAverageLitersPerDay: number; absoluteRecordLitersSingleDay: number } | null;
  statsLoading: boolean;
}

export function PlanificacionDashboard({
  dashPlans,
  products,
  theme,
  cardBg,
  borderCol,
  textMuted,
  dashStartDate,
  setDashStartDate,
  dashEndDate,
  setDashEndDate,
  selectedMonth,
  setSelectedMonth,
  selectedWeek,
  setSelectedWeek,
  selectedBrand,
  setSelectedBrand,
  dashLoading,
  fetchDashboardData,
  tiposEnvasePrimario,
  tiposTapa = [],
  getPlanDivisor,
  dashColWidths,
  hoveredResizeCol,
  setHoveredResizeCol,
  handleDashResizeStart,
  historyStats,
  statsLoading
}: PlanificacionDashboardProps) {
  const [selectedBusinessLine, setSelectedBusinessLine] = useState('');
  const [selectedFamily, setSelectedFamily] = useState('');
  const [hoveredPoint, setHoveredPoint] = useState<{ index: number; x: number; y: number } | null>(null);
  const [hoveredWeekKey, setHoveredWeekKey] = useState<string | null>(null);

  // ISO Week range helper
  const getWeekRange = useCallback((year: number, week: number) => {
    const jan4 = new Date(year, 0, 4);
    const day = jan4.getDay();
    const diff = day === 0 ? 6 : day - 1;
    const week1Monday = new Date(jan4);
    week1Monday.setDate(jan4.getDate() - diff);
    week1Monday.setHours(0, 0, 0, 0);

    const monday = new Date(week1Monday);
    monday.setDate(monday.getDate() + (week - 1) * 7);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    return { monday, sunday };
  }, []);

  // Generate last 6 months options
  const monthOptions = useMemo(() => {
    const opts = [];
    const today = new Date();
    for (let i = 0; i < 6; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      // Only include months on or after July 2026 (year >= 2026 and month >= 6)
      if (d.getFullYear() < 2026 || (d.getFullYear() === 2026 && d.getMonth() < 6)) {
        continue;
      }
      const value = d.toISOString().substring(0, 7); // YYYY-MM
      const label = d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
      opts.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) });
    }
    return opts;
  }, []);

  // Generate last 10 weeks options
  const weekOptions = useMemo(() => {
    const opts = [];
    const today = new Date();
    
    // Find the Monday of the current week
    const currentISOWeek = (d: Date) => {
      const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
      const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
      const weekNum = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
      return { week: weekNum, year: date.getUTCFullYear() };
    };

    const todayDetails = currentISOWeek(today);
    const todayRange = getWeekRange(todayDetails.year, todayDetails.week);
    
    for (let i = 0; i < 10; i++) {
      const monday = new Date(todayRange.monday);
      monday.setDate(monday.getDate() - i * 7);
      
      const sunday = new Date(monday);
      sunday.setDate(sunday.getDate() + 6);
      
      // July 1st, 2026 is 2026-07-01.
      // If the entire week ends before July 1st, 2026, do not include it.
      const july1 = new Date(2026, 6, 1);
      if (sunday < july1) {
        continue;
      }
      
      const details = currentISOWeek(monday);
      const w = details.week;
      const y = details.year;
      
      const mondayStr = monday.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
      const sundayStr = sunday.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
      
      opts.push({
        value: `${y}-W${w}`,
        label: `Semana ${w} (${mondayStr} - ${sundayStr})`,
        monday: monday.toISOString().split('T')[0],
        sunday: sunday.toISOString().split('T')[0]
      });
    }
    return opts;
  }, [getWeekRange]);

  // Business Line dropdown options
  const businessLineOptions = useMemo(() => {
    const set = new Set<string>();
    products.forEach(p => {
      if (p.business_line) set.add(p.business_line.trim());
    });
    return Array.from(set).sort();
  }, [products]);

  // Family dropdown options (cascading)
  const familyOptions = useMemo(() => {
    const set = new Set<string>();
    products.forEach(p => {
      if (selectedBusinessLine && p.business_line !== selectedBusinessLine) return;
      if (p.family) set.add(p.family.trim());
    });
    return Array.from(set).sort();
  }, [products, selectedBusinessLine]);

  // Brand dropdown options (cascading)
  const brandOptions = useMemo(() => {
    const set = new Set<string>();
    products.forEach(p => {
      if (selectedBusinessLine && p.business_line !== selectedBusinessLine) return;
      if (selectedFamily && p.family !== selectedFamily) return;
      if (p.marca) set.add(p.marca.trim().toUpperCase());
    });
    return Array.from(set).sort();
  }, [products, selectedBusinessLine, selectedFamily]);

  // Event handlers
  const handleMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedMonth(val);
    setSelectedWeek('');
    if (val) {
      const [yearStr, monthStr] = val.split('-');
      const y = parseInt(yearStr, 10);
      const m = parseInt(monthStr, 10) - 1;
      const firstDay = new Date(y, m, 1).toISOString().split('T')[0];
      const lastDay = new Date(y, m + 1, 0).toISOString().split('T')[0];
      setDashStartDate(firstDay);
      setDashEndDate(lastDay);
    }
  };

  const handleWeekChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedWeek(val);
    setSelectedMonth('');
    if (val) {
      const opt = weekOptions.find(o => o.value === val);
      if (opt) {
        setDashStartDate(opt.monday);
        setDashEndDate(opt.sunday);
      }
    }
  };

  // Previous Period bounds
  const { prevStartDate, prevEndDate } = useMemo(() => {
    if (!dashStartDate || !dashEndDate) return { prevStartDate: '', prevEndDate: '' };
    const start = new Date(dashStartDate);
    const end = new Date(dashEndDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    const prevStartDateObj = new Date(start);
    prevStartDateObj.setDate(prevStartDateObj.getDate() - diffDays);
    const prevStartDate = prevStartDateObj.toISOString().split('T')[0];

    const prevEndDateObj = new Date(start);
    prevEndDateObj.setDate(prevEndDateObj.getDate() - 1);
    const prevEndDate = prevEndDateObj.toISOString().split('T')[0];

    return { prevStartDate, prevEndDate };
  }, [dashStartDate, dashEndDate]);

  // Client-side filtering by Brand, Family, and Business Line (Current Period only)
  const filteredPlans = useMemo(() => {
    let current = dashPlans.filter(p => p.fecha >= dashStartDate && p.fecha <= dashEndDate);
    if (selectedBusinessLine) {
      current = current.filter(p => {
        const prod = products.find(pr => pr.sku === p.product_sku);
        return prod?.business_line === selectedBusinessLine;
      });
    }
    if (selectedFamily) {
      current = current.filter(p => {
        const prod = products.find(pr => pr.sku === p.product_sku);
        return prod?.family === selectedFamily;
      });
    }
    if (selectedBrand) {
      current = current.filter(p => p.product_marca?.toUpperCase() === selectedBrand.toUpperCase());
    }
    return current;
  }, [dashPlans, dashStartDate, dashEndDate, selectedBusinessLine, selectedFamily, selectedBrand, products]);

  // Previous Period plans (for WoW/MoM comparison)
  const previousPlans = useMemo(() => {
    if (!prevStartDate || !prevEndDate) return [];
    let prev = dashPlans.filter(p => p.fecha >= prevStartDate && p.fecha <= prevEndDate);
    if (selectedBusinessLine) {
      prev = prev.filter(p => {
        const prod = products.find(pr => pr.sku === p.product_sku);
        return prod?.business_line === selectedBusinessLine;
      });
    }
    if (selectedFamily) {
      prev = prev.filter(p => {
        const prod = products.find(pr => pr.sku === p.product_sku);
        return prod?.family === selectedFamily;
      });
    }
    if (selectedBrand) {
      prev = prev.filter(p => p.product_marca?.toUpperCase() === selectedBrand.toUpperCase());
    }
    return prev;
  }, [dashPlans, prevStartDate, prevEndDate, selectedBusinessLine, selectedFamily, selectedBrand, products]);

  // Previous Period KPI Calculations
  const prevTotalPallets = useMemo(() => {
    return previousPlans.reduce((sum, p) => {
      const divisor = getPlanDivisor(p);
      return divisor > 0 ? sum + (p.cantidad_programada / divisor) : sum;
    }, 0);
  }, [previousPlans, getPlanDivisor]);

  const prevTotalLiters = useMemo(() => {
    return previousPlans.reduce((sum, p) => {
      const l = parseFormatoToLiters(p.product_formato);
      return sum + (p.cantidad_programada * l);
    }, 0);
  }, [previousPlans]);

  const prevTotalEnvases = useMemo(() => {
    return previousPlans.reduce((sum, p) => sum + (p.cantidad_programada || 0), 0);
  }, [previousPlans]);

  const prevComplianceRate = useMemo(() => {
    const completed = previousPlans.filter(p => p.estado === 'completado').reduce((sum, p) => sum + (p.cantidad_programada || 0), 0);
    const total = previousPlans.reduce((sum, p) => sum + (p.cantidad_programada || 0), 0);
    return total > 0 ? (completed / total) * 100 : 0;
  }, [previousPlans]);

  // KPI Calculations
  const totalPallets = useMemo(() => {
    return filteredPlans.reduce((sum, p) => {
      const divisor = getPlanDivisor(p);
      return divisor > 0 ? sum + (p.cantidad_programada / divisor) : sum;
    }, 0);
  }, [filteredPlans, getPlanDivisor]);

  const totalLiters = useMemo(() => {
    return filteredPlans.reduce((sum, p) => {
      const l = parseFormatoToLiters(p.product_formato);
      return sum + (p.cantidad_programada * l);
    }, 0);
  }, [filteredPlans]);

  const totalEnvases = useMemo(() => {
    return filteredPlans.reduce((sum, p) => sum + (p.cantidad_programada || 0), 0);
  }, [filteredPlans]);

  const complianceRate = useMemo(() => {
    const completed = filteredPlans.filter(p => p.estado === 'completado').reduce((sum, p) => sum + (p.cantidad_programada || 0), 0);
    const total = filteredPlans.reduce((sum, p) => sum + (p.cantidad_programada || 0), 0);
    return total > 0 ? (completed / total) * 100 : 0;
  }, [filteredPlans]);

  const maxPlannedDate = useMemo(() => {
    if (!dashPlans || dashPlans.length === 0) return '';
    return dashPlans.reduce((max, p) => p.fecha > max ? p.fecha : max, '');
  }, [dashPlans]);

  const accumulatedLiters = useMemo(() => {
    return filteredPlans
      .reduce((sum, p) => {
        const l = parseFormatoToLiters(p.product_formato);
        return sum + (p.cantidad_programada * l);
      }, 0);
  }, [filteredPlans]);

  const uniqueCurrentDaysCount = useMemo(() => {
    const dates = filteredPlans.map(p => p.fecha);
    return new Set(dates).size || 1;
  }, [filteredPlans]);

  const avgCurrentSpeed = useMemo(() => {
    return accumulatedLiters / uniqueCurrentDaysCount;
  }, [accumulatedLiters, uniqueCurrentDaysCount]);

  const uniquePrevDaysCount = useMemo(() => {
    const dates = previousPlans.map(p => p.fecha);
    return new Set(dates).size || 5;
  }, [previousPlans]);

  const avgPrevSpeed = useMemo(() => {
    return prevTotalLiters / uniquePrevDaysCount;
  }, [prevTotalLiters, uniquePrevDaysCount]);

  const referenceSpeed = avgPrevSpeed;
  const referenceVolume = prevTotalLiters;

  const trendBadge = useMemo(() => {
    const hasPrev = prevTotalLiters > 0;
    if (!hasPrev) {
      return (
        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold font-mono bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-500">
          Sin ref. anterior
        </span>
      );
    }
    const rateDiff = avgCurrentSpeed - referenceSpeed;
    const ratePct = referenceSpeed > 0 ? ((rateDiff / referenceSpeed) * 100).toFixed(1) : '0';
    if (rateDiff === 0) {
      return (
        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold font-mono bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-450">
          Ritmo Estable ➡️
        </span>
      );
    } else if (rateDiff > 0) {
      return (
        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold font-mono bg-emerald-50 dark:bg-emerald-955/50 border border-emerald-100 dark:border-emerald-900/60 text-emerald-600 dark:text-emerald-450">
          Ritmo Mayor ↗️ +{ratePct}%
        </span>
      );
    } else {
      return (
        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold font-mono bg-rose-50 dark:bg-rose-955/50 border border-rose-100 dark:border-rose-900/60 text-rose-600 dark:text-rose-455">
          Ritmo Menor ↘️ {ratePct}%
        </span>
      );
    }
  }, [prevTotalLiters, avgCurrentSpeed, referenceSpeed]);

  const narrativeContent = useMemo(() => {
    if (accumulatedLiters === 0) {
      return (
        <div className="space-y-1">
          <p className="font-semibold text-slate-800 dark:text-white">Estado: Planta Parada</p>
          <p>No se registran litros planificados para el período seleccionado.</p>
        </div>
      );
    }
    const rateDiff = avgCurrentSpeed - referenceSpeed;
    const ratePct = referenceSpeed > 0 ? ((rateDiff / referenceSpeed) * 100).toFixed(1) : '0';
    const hasPrev = prevTotalLiters > 0;
    
    let compareText = "";
    if (hasPrev) {
      if (rateDiff >= 0) {
        compareText = `el ritmo promedio diario de producción para los días con actividad (${Math.round(avgCurrentSpeed).toLocaleString('es-ES')} L/día) está por encima del promedio de referencia de la semana anterior (${Math.round(referenceSpeed).toLocaleString('es-ES')} L/día) con un incremento del ${ratePct}%. Esto significa que la velocidad de planificación global es mayor.`;
      } else {
        compareText = `el ritmo promedio diario de producción para los días con actividad (${Math.round(avgCurrentSpeed).toLocaleString('es-ES')} L/día) está por debajo del promedio de referencia de la semana anterior (${Math.round(referenceSpeed).toLocaleString('es-ES')} L/día) con un déficit del ${Math.abs(parseFloat(ratePct)).toFixed(1)}%. Esto significa que la velocidad de planificación global es menor.`;
      }
    } else {
      compareText = "esta es la primera semana del período filtrado.";
    }

    return (
      <div className="space-y-2 text-slate-650 dark:text-slate-355">
        <p className="font-semibold text-slate-800 dark:text-white">Estado del Plan de Producción Global de la Planta</p>
        <p>El plan total acumulado en los días con actividad es de <strong>{Math.round(accumulatedLiters).toLocaleString('es-ES')} Litros</strong>.</p>
        <p>Comparado con la referencia de la semana anterior, {compareText}</p>
      </div>
    );
  }, [accumulatedLiters, avgCurrentSpeed, referenceSpeed, prevTotalLiters]);

  // --- Water Consumption Series Calculations (Stub to avoid compilation errors) ---
  const waterSeriesData = useMemo<any[]>(() => [], []);
  const gridLines = useMemo<any[]>(() => [], []);
  const currentPath = '';
  const previousPath = '';
  const gapPath = '';
  const points: any[] = [];
  const xStep = 0;
  const chartWidth = 0;
  const chartHeight = 0;
  const paddingTop = 0;
  const paddingLeft = 0;

  // --- Water Consumption Weekly seasonal Matrix Calculations ---
  const weeklyWaterData = useMemo(() => {
    if (!dashStartDate || !dashEndDate) return [];

    const isWaterPlan = (p: Planificacion) => {
      // En esta planta todos los productos son agua/base agua
      return true;
    };

    // Parse start and end dates
    const start = new Date(dashStartDate + 'T12:00:00');
    const end = new Date(dashEndDate + 'T12:00:00');

    // Helper to get ISO week and year (timezone-safe)
    const getWeekDetails = (d: Date) => {
      const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
      const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
      const weekNum = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
      return { week: weekNum, year: date.getUTCFullYear() };
    };

    // Helper to get Monday and Sunday of a week (timezone-safe)
    const getWeekRange = (week: number, year: number) => {
      const jan4 = new Date(year, 0, 4);
      const day = jan4.getDay();
      const diff = day === 0 ? 6 : day - 1;
      const week1Monday = new Date(jan4);
      week1Monday.setDate(jan4.getDate() - diff);
      week1Monday.setHours(0, 0, 0, 0);

      const monday = new Date(week1Monday);
      monday.setDate(monday.getDate() + (week - 1) * 7);

      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      sunday.setHours(23, 59, 59, 999);

      return { startD: monday, endD: sunday };
    };

    // Find all ISO weeks that overlap with our start/end range
    const weeksMap = new Map<string, { week: number; year: number; startD: Date; endD: Date }>();
    const current = new Date(start.getTime());
    while (current <= end) {
      const { week, year } = getWeekDetails(current);
      const key = `${year}-W${week}`;
      if (!weeksMap.has(key)) {
        const { startD, endD } = getWeekRange(week, year);
        weeksMap.set(key, { week, year, startD, endD });
      }
      current.setDate(current.getDate() + 1);
    }

    const weeks = Array.from(weeksMap.values()).sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.week - b.week;
    });

    return weeks.map(w => {
      const weekPlans = filteredPlans.filter(p => {
        const pDate = new Date(p.fecha + 'T12:00:00');
        const wStart = new Date(w.startD.getTime());
        wStart.setHours(0,0,0,0);
        const wEnd = new Date(w.endD.getTime());
        wEnd.setHours(23,59,59,999);
        return pDate >= wStart && pDate <= wEnd && isWaterPlan(p);
      });

      const totalLiters = weekPlans.reduce((sum, p) => 
        sum + (p.cantidad_programada * parseFormatoToLiters(p.product_formato)), 0
      );

      return {
        key: `${w.year}-W${w.week}`,
        week: w.week,
        year: w.year,
        startDate: w.startD,
        endDate: w.endD,
        liters: totalLiters,
      };
    });
  }, [dashStartDate, dashEndDate, filteredPlans]);

  // --- Donut Chart Segments Calculation ---
  const donutSegments = useMemo(() => {
    const totalLiters = weeklyWaterData.reduce((sum, w) => sum + w.liters, 0);
    const r = 70;
    const circumference = 2 * Math.PI * r;
    
    let currentOffset = 0;
    
    return weeklyWaterData.map(w => {
      const percentage = totalLiters > 0 ? (w.liters / totalLiters) * 100 : 0;
      const strokeLength = (percentage / 100) * circumference;
      // SVG stroke-dashoffset cumulative starting offset
      const strokeOffset = circumference - currentOffset;
      
      // Accumulate for next segment
      currentOffset += strokeLength;
      
      let strokeColor = theme === 'light' ? '#94a3b8' : '#475569'; // Default/Parada
      let labelColor = "text-slate-400";
      let statusText = "PARADA";
      let dotColor = theme === 'light' ? "bg-slate-400" : "bg-slate-600";
      let bgStyle = "";
      
      if (theme === 'light') {
        bgStyle = "bg-slate-50 border-slate-200 text-slate-700 shadow-sm";
        if (w.liters > 100000) {
          strokeColor = "#4f46e5"; // Indigo
          labelColor = "text-indigo-600 font-semibold";
          statusText = "PICO";
          dotColor = "bg-indigo-600 shadow-[0_0_8px_rgba(79,70,229,0.3)]";
          bgStyle = "bg-indigo-50/70 border-indigo-200 text-indigo-950 shadow-sm";
        } else if (w.liters > 0) {
          strokeColor = "#0284c7"; // Sky Blue
          labelColor = "text-sky-600 font-semibold";
          statusText = "MEDIO";
          dotColor = "bg-sky-600 shadow-[0_0_8px_rgba(2,132,199,0.3)]";
          bgStyle = "bg-sky-50/70 border-sky-200 text-sky-950 shadow-sm";
        }
      } else {
        bgStyle = "bg-slate-900/40 border-slate-800 text-slate-400";
        if (w.liters > 100000) {
          strokeColor = "#6366f1"; // Indigo
          labelColor = "text-indigo-400 font-semibold";
          statusText = "PICO";
          dotColor = "bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]";
          bgStyle = "bg-indigo-950/20 border-indigo-500/20 text-indigo-200";
        } else if (w.liters > 0) {
          strokeColor = "#0ea5e9"; // Sky Blue
          labelColor = "text-sky-400 font-semibold";
          statusText = "MEDIO";
          dotColor = "bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.5)]";
          bgStyle = "bg-sky-950/25 border-sky-500/20 text-sky-200";
        }
      }

      return {
        ...w,
        percentage,
        strokeLength,
        strokeOffset,
        strokeColor,
        labelColor,
        statusText,
        dotColor,
        bgStyle
      };
    });
  }, [weeklyWaterData, theme]);

  // Needle Angles and Arc Offsets (Progressive Baseline Model)
  const maxVol = useMemo(() => {
    if (prevTotalLiters > accumulatedLiters) {
      return prevTotalLiters;
    }
    const val = accumulatedLiters * 1.1;
    return val > 0 ? val : 100000; // safe fallback if both are 0
  }, [prevTotalLiters, accumulatedLiters]);

  const volRatio = maxVol > 0 ? accumulatedLiters / maxVol : 0;
  const volAngle = -135 + Math.min(volRatio, 1) * 270;
  const volPct = prevTotalLiters > 0 ? Math.round((accumulatedLiters / prevTotalLiters) * 100) : 0;

  const maxRate = useMemo(() => {
    const highest = Math.max(avgCurrentSpeed, avgPrevSpeed);
    const val = highest * 1.2;
    return val > 0 ? val : 100000; // safe fallback if both are 0
  }, [avgCurrentSpeed, avgPrevSpeed]);

  const rateRatio = maxRate > 0 ? avgCurrentSpeed / maxRate : 0;
  const rateAngle = -135 + Math.min(rateRatio, 1) * 270;

  let rateColor = "#ef4444"; // red
  let rateTextColor = "text-rose-500";
  let rateSvgTextColor = "fill-rose-600 dark:fill-rose-400";
  let ratePctText = "0%";

  if (avgPrevSpeed === 0) {
    rateColor = "#3b82f6"; // blue
    rateTextColor = "text-blue-500 font-bold";
    rateSvgTextColor = "fill-blue-600 dark:fill-blue-400";
    ratePctText = "L. Base";
  } else {
    const rateDiffRatio = avgCurrentSpeed / avgPrevSpeed;
    const pctValue = Math.round((avgCurrentSpeed / avgPrevSpeed) * 100);
    ratePctText = `${pctValue}%`;
    
    if (rateDiffRatio >= 1.0) {
      rateColor = "#10b981"; // green
      rateTextColor = "text-emerald-500 font-extrabold";
      rateSvgTextColor = "fill-emerald-600 dark:fill-emerald-400";
    } else if (rateDiffRatio >= 0.7) {
      rateColor = "#eab308"; // yellow
      rateTextColor = "text-yellow-500 font-bold";
      rateSvgTextColor = "fill-amber-600 dark:fill-amber-400";
    }
  }

  return (
    <div className="space-y-6">
      {/* Filters Card */}
      <div className={`${cardBg} rounded-xl border p-5`}>
        <div className="flex items-center gap-2 mb-4">
          <Settings className="w-4 h-4 text-blue-500" />
          <h2 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
            Filtros del Reporte
          </h2>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-7 gap-4 items-end">
          {/* Start Date */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              Fecha Inicio
            </label>
            <input
              type="date"
              value={dashStartDate}
              onChange={(e) => {
                setDashStartDate(e.target.value);
                setSelectedMonth('');
                setSelectedWeek('');
              }}
              className={`w-full rounded-lg border px-3 py-1.5 text-xs outline-none focus:ring-1 ${
                theme === 'light' 
                  ? 'border-slate-200 bg-white text-slate-800 focus:border-blue-500 focus:ring-blue-500 [color-scheme:light]'
                  : 'border-slate-750 bg-slate-900 text-white focus:border-blue-500 focus:ring-blue-500 [color-scheme:dark]'
              }`}
            />
          </div>

          {/* End Date */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              Fecha Fin
            </label>
            <input
              type="date"
              value={dashEndDate}
              onChange={(e) => {
                setDashEndDate(e.target.value);
                setSelectedMonth('');
                setSelectedWeek('');
              }}
              className={`w-full rounded-lg border px-3 py-1.5 text-xs outline-none focus:ring-1 ${
                theme === 'light' 
                  ? 'border-slate-200 bg-white text-slate-800 focus:border-blue-500 focus:ring-blue-500 [color-scheme:light]'
                  : 'border-slate-750 bg-slate-900 text-white focus:border-blue-500 focus:ring-blue-500 [color-scheme:dark]'
              }`}
            />
          </div>

          {/* Month filter */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              Filtrar por Mes
            </label>
            <select
              value={selectedMonth}
              onChange={handleMonthChange}
              className={`w-full rounded-lg border px-3 py-1.5 text-xs outline-none focus:ring-1 ${
                theme === 'light' 
                  ? 'border-slate-200 bg-white text-slate-800 focus:border-blue-500 focus:ring-blue-500'
                  : 'border-slate-750 bg-slate-900 text-white focus:border-blue-500 focus:ring-blue-500'
              }`}
            >
              <option value="">Selecciona Mes</option>
              {monthOptions.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Week filter */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              Filtrar por Semana
            </label>
            <select
              value={selectedWeek}
              onChange={handleWeekChange}
              className={`w-full rounded-lg border px-3 py-1.5 text-xs outline-none focus:ring-1 ${
                theme === 'light' 
                  ? 'border-slate-200 bg-white text-slate-800 focus:border-blue-500 focus:ring-blue-500'
                  : 'border-slate-750 bg-slate-900 text-white focus:border-blue-500 focus:ring-blue-500'
              }`}
            >
              <option value="">Selecciona Semana</option>
              {weekOptions.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Business Line filter */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              Línea Negocio
            </label>
            <select
              value={selectedBusinessLine}
              onChange={(e) => {
                setSelectedBusinessLine(e.target.value);
                setSelectedFamily('');
                setSelectedBrand('');
              }}
              className={`w-full rounded-lg border px-3 py-1.5 text-xs outline-none focus:ring-1 ${
                theme === 'light' 
                  ? 'border-slate-200 bg-white text-slate-800 focus:border-blue-500 focus:ring-blue-500'
                  : 'border-slate-750 bg-slate-900 text-white focus:border-blue-500 focus:ring-blue-500'
              }`}
            >
              <option value="">Todas</option>
              {businessLineOptions.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>

          {/* Family filter */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              Familia
            </label>
            <select
              value={selectedFamily}
              onChange={(e) => {
                setSelectedFamily(e.target.value);
                setSelectedBrand('');
              }}
              className={`w-full rounded-lg border px-3 py-1.5 text-xs outline-none focus:ring-1 ${
                theme === 'light' 
                  ? 'border-slate-200 bg-white text-slate-800 focus:border-blue-500 focus:ring-blue-500'
                  : 'border-slate-750 bg-slate-900 text-white focus:border-blue-500 focus:ring-blue-500'
              }`}
            >
              <option value="">Todas</option>
              {familyOptions.map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>

          {/* Brand Filter */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              Marca
            </label>
            <select
              value={selectedBrand}
              onChange={(e) => setSelectedBrand(e.target.value)}
              className={`w-full rounded-lg border px-3 py-1.5 text-xs outline-none focus:ring-1 ${
                theme === 'light' 
                  ? 'border-slate-200 bg-white text-slate-800 focus:border-blue-500 focus:ring-blue-500'
                  : 'border-slate-750 bg-slate-900 text-white focus:border-blue-500 focus:ring-blue-500'
              }`}
            >
              <option value="">Todas</option>
              {brandOptions.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {dashLoading && dashPlans.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <span className="text-xs font-semibold text-slate-400">Cargando dashboard...</span>
        </div>
      ) : (
        <div className={`space-y-6 ${dashLoading ? 'opacity-60 transition-opacity pointer-events-none' : ''}`}>
          {/* Main KPI Grid: Separated into Macro and Micro blocks */}
          {(() => {
            const getPctChange = (curr: number, prev: number) => {
              if (prev <= 0) return curr > 0 ? 100 : 0;
              return ((curr - prev) / prev) * 100;
            };

            const currentDailyPallets = totalPallets / uniqueCurrentDaysCount;
            const prevDailyPallets = prevTotalPallets / uniquePrevDaysCount;
            
            const currentDailyUnits = totalEnvases / uniqueCurrentDaysCount;
            const prevDailyUnits = prevTotalEnvases / uniquePrevDaysCount;

            const currentDailyLiters = totalLiters / uniqueCurrentDaysCount;
            const prevDailyLiters = prevTotalLiters / uniquePrevDaysCount;

            return (
              <div className="space-y-6">
                {/* Bloque 1: Acumulado del Período (Visión Macro) */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
                    <span className="text-[10px] uppercase font-black tracking-widest text-slate-400 dark:text-slate-500">
                      Acumulado del Período
                    </span>
                    <span className="text-[8px] font-extrabold px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Visión Macro
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {/* KPI 1.1: Pallets Totales */}
                    <div className={`${cardBg} rounded-xl border p-5 flex flex-col justify-between`}>
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Pallets Totales</span>
                          <div className="text-2xl font-bold font-mono tracking-tight text-slate-800 dark:text-slate-100">
                            {totalPallets.toFixed(1)}
                          </div>
                        </div>
                        <div className={`p-3 rounded-lg ${
                          theme === 'light' 
                            ? 'bg-blue-50 text-blue-600' 
                            : theme === 'glass' 
                              ? 'bg-blue-500/10 text-blue-300 border border-blue-500/25' 
                              : 'bg-blue-950/40 text-blue-400 border border-blue-900/50'
                        }`}>
                          <Layers className="w-5 h-5" />
                        </div>
                      </div>
                    </div>

                    {/* KPI 1.2: Litros Totales */}
                    <div className={`${cardBg} rounded-xl border p-5 flex flex-col justify-between`}>
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Litros Totales</span>
                          <div className="text-2xl font-bold font-mono tracking-tight text-slate-800 dark:text-slate-100">
                            {totalLiters.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} L
                          </div>
                        </div>
                        <div className={`p-3 rounded-lg ${
                          theme === 'light' 
                            ? 'bg-purple-50 text-purple-600' 
                            : theme === 'glass' 
                              ? 'bg-purple-500/10 text-purple-355 border border-purple-500/25' 
                              : 'bg-purple-950/40 text-purple-400 border border-purple-900/50'
                        }`}>
                          <Droplet className="w-5 h-5" />
                        </div>
                      </div>
                    </div>

                    {/* KPI 1.3: Unidades Totales */}
                    <div className={`${cardBg} rounded-xl border p-5 flex flex-col justify-between`}>
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Unidades Totales</span>
                          <div className="text-2xl font-bold font-mono tracking-tight text-slate-800 dark:text-slate-100">
                            {totalEnvases.toLocaleString()}
                          </div>
                        </div>
                        <div className={`p-3 rounded-lg ${
                          theme === 'light' 
                            ? 'bg-emerald-50 text-emerald-600' 
                            : theme === 'glass' 
                              ? 'bg-emerald-500/10 text-emerald-355 border border-emerald-500/25' 
                              : 'bg-emerald-950/40 text-emerald-400 border border-emerald-900/50'
                        }`}>
                          <Boxes className="w-5 h-5" />
                        </div>
                      </div>
                    </div>

                    {/* KPI 1.4: Tasa de Cumplimiento */}
                    <div className={`${cardBg} rounded-xl border p-5 flex flex-col justify-between`}>
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Tasa Cumplimiento</span>
                          <div className="text-2xl font-bold font-mono tracking-tight text-slate-800 dark:text-slate-100">
                            {complianceRate.toFixed(0)}%
                          </div>
                        </div>
                        <div className={`p-3 rounded-lg ${
                          theme === 'light' 
                            ? 'bg-emerald-55 text-emerald-600' 
                            : theme === 'glass' 
                              ? 'bg-emerald-500/10 text-emerald-355 border border-emerald-500/25' 
                              : 'bg-emerald-950/40 text-emerald-400 border border-emerald-900/50'
                        }`}>
                          <CheckCircle className="w-5 h-5" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                 {/* Bloque 2: Inteligencia Logística (BI) */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
                    <span className="text-[10px] uppercase font-black tracking-widest text-slate-400 dark:text-slate-500">
                      Inteligencia Logística (BI)
                    </span>
                    <span className="text-[8px] font-extrabold px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                      Métricas de Planta ({uniqueCurrentDaysCount} {uniqueCurrentDaysCount === 1 ? 'día' : 'días'} activos)
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* KPI 2.1: Radar de Inercia */}
                    <div className={`${cardBg} rounded-xl border p-5 flex flex-col justify-between`}>
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Radar de Inercia</span>
                          <div className="text-2xl font-bold font-mono tracking-tight text-slate-800 dark:text-slate-100">
                            {Math.round(avgCurrentSpeed).toLocaleString('es-ES')} L/d
                          </div>
                          {(() => {
                            if (avgPrevSpeed === 0) {
                              return (
                                <div className="flex flex-col">
                                  <span className="text-[10px] font-bold text-slate-400">
                                    Sin historial de inercia
                                  </span>
                                </div>
                              );
                            }
                            const diff = avgCurrentSpeed - avgPrevSpeed;
                            const pct = ((diff / avgPrevSpeed) * 100);
                            const isPos = diff >= 0;
                            return (
                              <div className="flex flex-col">
                                <span className={`inline-flex items-center text-[10px] font-bold ${isPos ? 'text-emerald-500' : 'text-rose-500'}`}>
                                  {isPos ? '↑ Acelerando' : '↓ Desacelerando'} ({isPos ? '+' : ''}{Math.round(diff).toLocaleString('es-ES')} L/día)
                                </span>
                                <span className="text-[9px] text-slate-400 font-medium">({isPos ? '+' : ''}{pct.toFixed(1)}% vs. ciclo anterior)</span>
                              </div>
                            );
                          })()}
                        </div>
                        <div className={`p-3 rounded-lg ${
                          theme === 'light' 
                            ? 'bg-blue-50 text-blue-600' 
                            : theme === 'glass' 
                              ? 'bg-blue-500/10 text-blue-300 border border-blue-500/25' 
                              : 'bg-blue-950/40 text-blue-400 border border-blue-900/50'
                        }`}>
                          <TrendingUp className="w-5 h-5" />
                        </div>
                      </div>
                    </div>

                    {/* KPI 2.2: Índice de Estacionalidad */}
                    <div className={`${cardBg} rounded-xl border p-5 flex flex-col justify-between`}>
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Índice Estacionalidad</span>
                          <div className="text-2xl font-bold font-mono tracking-tight text-slate-800 dark:text-slate-100">
                            {statsLoading ? (
                              <span className="text-sm font-sans font-medium text-slate-400">Cargando...</span>
                            ) : !historyStats ? (
                              <span className="text-sm font-sans font-medium text-slate-400">Sin historial</span>
                            ) : (() => {
                              const globalAvg = historyStats.globalAverageLitersPerDay;
                              const diff = avgCurrentSpeed - globalAvg;
                              const pct = globalAvg > 0 ? (diff / globalAvg) * 100 : 0;
                              return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
                            })()}
                          </div>
                          {(() => {
                            if (statsLoading || !historyStats || historyStats.globalAverageLitersPerDay === 0) {
                              return (
                                <div className="flex flex-col">
                                  <span className="text-[10px] font-bold text-slate-450">
                                    Calculando media histórica global...
                                  </span>
                                </div>
                              );
                            }
                            const globalAvg = historyStats.globalAverageLitersPerDay;
                            const diff = avgCurrentSpeed - globalAvg;
                            const pct = ((avgCurrentSpeed - globalAvg) / globalAvg) * 100;
                            const isPos = pct >= 0;
                            return (
                              <div className="flex flex-col">
                                <span className={`inline-flex items-center text-[10px] font-bold ${isPos ? 'text-emerald-500' : 'text-rose-500'}`}>
                                  {isPos ? '↑ Sobre la media' : '↓ Bajo la media'}
                                </span>
                                <span className="text-[9px] text-slate-400 font-medium">Media: {Math.round(globalAvg).toLocaleString('es-ES')} L/día</span>
                              </div>
                            );
                          })()}
                        </div>
                        <div className={`p-3 rounded-lg ${
                          theme === 'light' 
                            ? 'bg-purple-50 text-purple-600' 
                            : theme === 'glass' 
                              ? 'bg-purple-500/10 text-purple-355 border border-purple-500/25' 
                              : 'bg-purple-950/40 text-purple-400 border border-purple-900/50'
                        }`}>
                          <BarChart2 className="w-5 h-5" />
                        </div>
                      </div>
                    </div>

                    {/* KPI 2.3: Termómetro de Saturación */}
                    <div className={`${cardBg} rounded-xl border p-5 flex flex-col justify-between`}>
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Termómetro Saturación</span>
                          <div className="text-2xl font-bold font-mono tracking-tight text-slate-800 dark:text-slate-100">
                            {statsLoading ? (
                              <span className="text-sm font-sans font-medium text-slate-400">Cargando...</span>
                            ) : !historyStats || historyStats.absoluteRecordLitersSingleDay === 0 ? (
                              "0.0%"
                            ) : (() => {
                              const record = historyStats.absoluteRecordLitersSingleDay;
                              const stress = (avgCurrentSpeed / record) * 100;
                              return `${stress.toFixed(1)}%`;
                            })()}
                          </div>
                          {(() => {
                            if (statsLoading || !historyStats || historyStats.absoluteRecordLitersSingleDay === 0) {
                              return (
                                <div className="flex flex-col">
                                  <span className="text-[10px] font-bold text-slate-450">
                                    Buscando récord histórico...
                                  </span>
                                </div>
                              );
                            }
                            const record = historyStats.absoluteRecordLitersSingleDay;
                            const stress = (avgCurrentSpeed / record) * 100;
                            const isAlert = stress >= 90;
                            return (
                              <div className="flex flex-col">
                                <span className={`inline-flex items-center text-[10px] font-bold ${isAlert ? 'text-rose-500 animate-pulse' : 'text-emerald-500'}`}>
                                  {isAlert ? '⚠️ Alerta: Producción al límite histórico' : 'Operación Estable'}
                                </span>
                                <span className="text-[9px] text-slate-400 font-medium">Récord: {Math.round(record).toLocaleString('es-ES')} L/día</span>
                              </div>
                            );
                          })()}
                        </div>
                        <div className={`p-3 rounded-lg ${
                          theme === 'light' 
                            ? 'bg-rose-50 text-rose-600' 
                            : theme === 'glass' 
                              ? 'bg-rose-500/10 text-rose-300 border border-rose-500/25' 
                              : 'bg-rose-950/40 text-rose-400 border border-rose-900/50'
                        }`}>
                          <AlertCircle className="w-5 h-5" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* SECCIÓN TACÓMETROS DEPORTIVOS (RITMO Y VOLUMEN) */}
          <div className={`${cardBg} rounded-xl border p-5 space-y-6`}>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-indigo-500 animate-pulse" />
                  Rendimiento Deportivo de Ritmo y Volumen de Planta
                </h3>
                <p className="text-[10px] text-slate-400 mt-1">
                  Monitoreo de avance planificado diario y ritmo crucero de envasado
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Columna Izquierda: Cifras Clave */}
              <div className="lg:col-span-4 flex flex-col justify-between gap-6">
                
                {/* Litros Totales Planificados en el Período Seleccionado */}
                <div className="bg-slate-500/5 border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 space-y-4">
                  <div>
                    <span className="text-[9px] uppercase font-extrabold tracking-widest text-slate-400">
                      Litros Planificados (Días con Actividad)
                    </span>
                    <h2 className="text-3xl font-black font-mono text-slate-800 dark:text-white mt-1">
                      {Math.round(accumulatedLiters).toLocaleString('es-ES')} L
                    </h2>
                  </div>
                  
                  <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
                    <span className="text-[9px] uppercase font-extrabold tracking-widest text-slate-400">
                      Comparativa con Período Anterior
                    </span>
                    <div className="flex justify-between items-center text-xs mt-2">
                      <span className="text-slate-400">Litros Totales Anterior:</span>
                      <span className="font-semibold text-slate-700 dark:text-white font-mono">
                        {prevTotalLiters > 0 ? Math.round(prevTotalLiters).toLocaleString('es-ES') + ' L' : '-'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs mt-1.5">
                      <span className="text-slate-400">Porcentaje Acumulado:</span>
                      <span className="font-bold text-indigo-500 font-mono">
                        {prevTotalLiters > 0 ? Math.round((accumulatedLiters / prevTotalLiters) * 100) + '%' : '-'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Comparación de Velocidades */}
                <div className="bg-slate-500/5 border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] uppercase font-extrabold tracking-widest text-slate-400">
                      Comparación de Velocidades
                    </span>
                    {trendBadge}
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400">Velocidad Actual:</span>
                    <span className="font-semibold text-slate-700 dark:text-white font-mono">
                      {Math.round(avgCurrentSpeed).toLocaleString('es-ES')} L/día
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400">Velocidad Anterior (Ref):</span>
                    <span className="font-semibold text-slate-700 dark:text-white font-mono">
                      {Math.round(referenceSpeed).toLocaleString('es-ES')} L/día
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs border-t border-slate-200 dark:border-slate-800 pt-2.5">
                    <span className="text-slate-400">Variación del Ritmo:</span>
                    <span className={`font-bold font-mono ${
                      prevTotalLiters === 0
                        ? 'text-slate-500'
                        : avgCurrentSpeed - referenceSpeed >= 0
                          ? 'text-emerald-500'
                          : 'text-rose-500'
                    }`}>
                      {prevTotalLiters > 0
                        ? `${avgCurrentSpeed - referenceSpeed >= 0 ? '+' : ''}${Math.round(avgCurrentSpeed - referenceSpeed).toLocaleString('es-ES')} L/día (${avgCurrentSpeed - referenceSpeed >= 0 ? '+' : ''}${((avgCurrentSpeed - referenceSpeed) / referenceSpeed * 100).toFixed(1)}%)`
                        : '-'
                      }
                    </span>
                  </div>
                </div>

              </div>

              {/* Tacómetro A: Volumen Total */}
              <div className="lg:col-span-4 bg-slate-500/5 border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 flex flex-col items-center justify-between min-h-[340px] relative overflow-hidden">
                <div className="w-full text-center">
                  <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">
                    Volumen Total Planificado
                  </span>
                  <p className="text-[10px] text-slate-500 mt-1">Escala de Litros reales en el velocímetro</p>
                </div>
                
                {/* SVG del Tacómetro Deportivo 1 */}
                <div className="relative w-64 h-64 md:w-72 md:h-72 flex items-center justify-center">
                  <svg className="w-full h-full" viewBox="-18 -18 136 136">
                    <circle cx="50" cy="50" r="45" fill="rgba(0,0,0,0.08)" stroke={theme === 'light' ? '#e2e8f0' : '#1e293b'} strokeWidth="0.5" />
                    
                    {/* Fondo del Tacómetro */}
                    <path d="M 26.7 73.3 A 33 33 0 1 1 73.3 73.3" fill="none" stroke={theme === 'light' ? '#e2e8f0' : '#111827'} strokeWidth="6.5" strokeLinecap="round" />
                    
                    {/* Banda Única: Litros actuales */}
                    <path d="M 26.7 73.3 A 33 33 0 1 1 73.3 73.3" fill="none" stroke="#6366f1" strokeWidth="6.5" strokeLinecap="round" strokeDasharray="155.5" strokeDashoffset={155.5 - Math.min(volRatio, 1) * 155.5} />
                    
                    {/* Marcador de Récord: prevTotalLiters */}
                    {prevTotalLiters > 0 && (() => {
                      const recordRatio = maxVol > 0 ? prevTotalLiters / maxVol : 0;
                      const recordAngle = -135 + Math.min(recordRatio, 1) * 270;
                      const recordRad = (recordAngle - 90) * Math.PI / 180;
                      const rx1 = 50 + 29.7 * Math.cos(recordRad);
                      const ry1 = 50 + 29.7 * Math.sin(recordRad);
                      const rx2 = 50 + 36.3 * Math.cos(recordRad);
                      const ry2 = 50 + 36.3 * Math.sin(recordRad);
                      const textRad = (recordAngle - 90) * Math.PI / 180;
                      const tx = 50 + 24.5 * Math.cos(textRad);
                      const ty = 50 + 24.5 * Math.sin(textRad) + 1.2;
                      return (
                        <g key="rec-marker">
                          <line x1={rx1} y1={ry1} x2={rx2} y2={ry2} stroke="#ef4444" strokeWidth="1.2" />
                          <text x={tx} y={ty} textAnchor="middle" fill="#ef4444" className="text-[4.5px] font-black font-mono tracking-tighter">REC</text>
                        </g>
                      );
                    })()}
                    
                    {/* Ticks y Números de Volumen */}
                    {Array.from({ length: 7 }).map((_, i) => {
                      const pct = i / 6;
                      const val = pct * maxVol;
                      const label = val === 0 ? "0" : Math.round(val).toLocaleString('es-ES');
                      const angle = -135 + (pct * 270);
                      const rad = (angle - 90) * Math.PI / 180;
                      
                      const x1 = 50 + 41 * Math.cos(rad);
                      const y1 = 50 + 41 * Math.sin(rad);
                      const x2 = 50 + 44 * Math.cos(rad);
                      const y2 = 50 + 44 * Math.sin(rad);
                      
                      const strokeColor = theme === 'light' ? '#94a3b8' : '#475569';
                      const strokeWidth = "1.0";
                      const fillColor = theme === 'light' ? '#334155' : '#cbd5e1';
                      
                      const xText = 50 + 55 * Math.cos(rad);
                      const yText = 50 + 55 * Math.sin(rad) + 2.0;

                      return (
                        <g key={i}>
                          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={strokeColor} strokeWidth={strokeWidth} />
                          <text 
                            x={xText} 
                            y={yText} 
                            textAnchor="middle" 
                            style={{ fill: fillColor }}
                            className="font-bold text-[6.8px] font-mono"
                          >
                            {label}
                          </text>
                        </g>
                      );
                    })}
                    
                    {/* Aguja */}
                    <g style={{ transformOrigin: "50px 50px", transition: "transform 1.2s cubic-bezier(0.25, 0.8, 0.25, 1)", transform: `rotate(${volAngle}deg)` }}>
                      <line x1="50" y1="50" x2="50" y2="12" stroke="rgba(239, 68, 68, 0.4)" strokeWidth="2.5" strokeLinecap="round" />
                      <line x1="50" y1="50" x2="50" y2="12" stroke="#ef4444" strokeWidth="1.2" strokeLinecap="round" />
                      <circle cx="50" cy="12" r="0.8" fill="#ffffff" />
                    </g>
                    
                    <circle cx="50" cy="50" r="6" fill={theme === 'light' ? '#f8fafc' : '#090d16'} stroke="#475569" strokeWidth="1.5" />
                    <circle cx="50" cy="50" r="2.5" fill="#ef4444" />
                    <text x="50" y="65" textAnchor="middle" className="fill-slate-400 dark:fill-slate-500 text-[7px] font-bold font-mono uppercase tracking-wider">AVANCE</text>
                    <text x="50" y="76" textAnchor="middle" className="fill-slate-800 dark:fill-white text-[10px] font-black font-mono">
                      {Math.round(accumulatedLiters).toLocaleString('es-ES')} L
                    </text>
                    {prevTotalLiters > 0 ? (
                      <text x="50" y="85" textAnchor="middle" className="fill-indigo-600 dark:fill-indigo-400 text-[8px] font-extrabold font-mono">
                        {Math.round((accumulatedLiters / prevTotalLiters) * 100)}%
                      </text>
                    ) : (
                      <>
                        <text x="50" y="83.5" textAnchor="middle" className="fill-indigo-600 dark:fill-indigo-400 text-[4px] font-black uppercase tracking-wider">Construyendo</text>
                        <text x="50" y="87.5" textAnchor="middle" className="fill-indigo-600 dark:fill-indigo-400 text-[4px] font-black uppercase tracking-wider">Línea Base</text>
                      </>
                    )}
                  </svg>
                </div>

                {/* Leyenda */}
                <div className="flex justify-center gap-3 text-[9px] mt-1 border-t border-slate-200 dark:border-slate-900 pt-2 w-full text-slate-500 dark:text-slate-400">
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                    <span>Ref: <span className="font-bold text-slate-700 dark:text-white">{prevTotalLiters > 0 ? `${Math.round(referenceVolume).toLocaleString('es-ES')} L` : '-'}</span></span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                    <span>Act: <span className="font-bold text-slate-700 dark:text-white">{Math.round(accumulatedLiters).toLocaleString('es-ES')} L</span></span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                    <span>Avance: <span className="font-bold text-cyan-600 dark:text-cyan-300">{prevTotalLiters > 0 ? `${Math.round((accumulatedLiters / prevTotalLiters) * 100)}%` : 'L. Base'}</span></span>
                  </div>
                </div>
              </div>

              {/* Tacómetro B: Velocidad */}
              <div className="lg:col-span-4 bg-slate-500/5 border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 flex flex-col items-center justify-between min-h-[340px] relative overflow-hidden">
                <div className="w-full text-center">
                  <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">
                    Tacómetro de Velocidad
                  </span>
                  <p className="text-[10px] text-slate-500 mt-1">Ritmo diario de producción planificado (L/día)</p>
                </div>
                
                {/* SVG del Tacómetro Deportivo 2 */}
                <div className="relative w-64 h-64 md:w-72 md:h-72 flex items-center justify-center">
                  <svg className="w-full h-full" viewBox="-18 -18 136 136">
                    <circle cx="50" cy="50" r="45" fill="rgba(0,0,0,0.08)" stroke={theme === 'light' ? '#e2e8f0' : '#1e293b'} strokeWidth="0.5" />
                    
                    {/* Banda 1: Referencia */}
                    <path d="M 21.7 78.3 A 40 40 0 1 1 78.3 78.3" fill="none" stroke={theme === 'light' ? '#cbd5e1' : '#111827'} strokeWidth="6.5" strokeLinecap="round" />
                    {avgPrevSpeed > 0 && (() => {
                      const refRatio = maxRate > 0 ? avgPrevSpeed / maxRate : 0;
                      const offset = 188.5 - Math.min(refRatio, 1) * 188.5;
                      return (
                        <path d="M 21.7 78.3 A 40 40 0 1 1 78.3 78.3" fill="none" stroke="#3b82f6" strokeWidth="6.5" strokeLinecap="round" strokeDasharray="188.5" strokeDashoffset={offset} opacity="0.35" />
                      );
                    })()}
                    
                    {/* Banda 2: Velocidad actual */}
                    <path d="M 26.7 73.3 A 33 33 0 1 1 73.3 73.3" fill="none" stroke={theme === 'light' ? '#e2e8f0' : '#111827'} strokeWidth="6.5" strokeLinecap="round" />
                    <path d="M 26.7 73.3 A 33 33 0 1 1 73.3 73.3" fill="none" stroke={rateColor} strokeWidth="6.5" strokeLinecap="round" strokeDasharray="155.5" strokeDashoffset={155.5 - Math.min(rateRatio, 1) * 155.5} />
                    
                    {/* Ticks y Números de Velocidad */}
                    {Array.from({ length: 5 }).map((_, i) => {
                      const pct = i / 4;
                      const val = pct * maxRate;
                      const label = val === 0 ? "0" : Math.round(val).toLocaleString('es-ES');
                      const angle = -135 + (pct * 270);
                      const rad = (angle - 90) * Math.PI / 180;
                      
                      const x1 = 50 + 41 * Math.cos(rad);
                      const y1 = 50 + 41 * Math.sin(rad);
                      const x2 = 50 + 44 * Math.cos(rad);
                      const y2 = 50 + 44 * Math.sin(rad);
                      
                      const strokeColor = theme === 'light' ? '#94a3b8' : '#475569';
                      const strokeWidth = "1.0";
                      const fillColor = theme === 'light' ? '#334155' : '#cbd5e1';
                      
                      const xText = 50 + 55 * Math.cos(rad);
                      const yText = 50 + 55 * Math.sin(rad) + 2.0;

                      return (
                        <g key={i}>
                          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={strokeColor} strokeWidth={strokeWidth} />
                          <text 
                            x={xText} 
                            y={yText} 
                            textAnchor="middle" 
                            style={{ fill: fillColor }}
                            className="font-bold text-[6.8px] font-mono"
                          >
                            {label}
                          </text>
                        </g>
                      );
                    })}
                    
                    {/* Aguja */}
                    <g style={{ transformOrigin: "50px 50px", transition: "transform 1.2s cubic-bezier(0.25, 0.8, 0.25, 1)", transform: `rotate(${rateAngle}deg)` }}>
                      <line x1="50" y1="50" x2="50" y2="12" stroke="rgba(255, 255, 255, 0.3)" strokeWidth="2.5" strokeLinecap="round" />
                      <line x1="50" y1="50" x2="50" y2="12" stroke={theme === 'light' ? '#64748b' : '#ffffff'} strokeWidth="1.2" strokeLinecap="round" />
                      <circle cx="50" cy="12" r="0.8" fill="#ef4444" />
                    </g>
                    
                    <circle cx="50" cy="50" r="6" fill={theme === 'light' ? '#f8fafc' : '#090d16'} stroke="#475569" strokeWidth="1.5" />
                    <circle cx="50" cy="50" r="2.5" fill={theme === 'light' ? '#64748b' : '#ffffff'} />
                    <text x="50" y="65" textAnchor="middle" className="fill-slate-400 dark:fill-slate-500 text-[7px] font-bold font-mono uppercase tracking-wider">RITMO</text>
                    <text x="50" y="76" textAnchor="middle" className="fill-slate-800 dark:fill-white text-[10px] font-black font-mono">
                      {Math.round(avgCurrentSpeed).toLocaleString('es-ES')} L/d
                    </text>
                    <text x="50" y="85" textAnchor="middle" className={`${rateSvgTextColor} text-[8px] font-extrabold font-mono`}>
                      {ratePctText}
                    </text>
                  </svg>
                </div>

                {/* Leyenda */}
                <div className="flex justify-center gap-3 text-[9px] mt-1 border-t border-slate-200 dark:border-slate-900 pt-2 w-full text-slate-500 dark:text-slate-400">
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                    <span>Ref: <span className="font-bold text-slate-700 dark:text-white">{avgPrevSpeed > 0 ? `${Math.round(referenceSpeed).toLocaleString('es-ES')} L/d` : '-'}</span></span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-yellow-500"></span>
                    <span>Act: <span className="font-bold text-slate-700 dark:text-white">{Math.round(avgCurrentSpeed).toLocaleString('es-ES')} L/d</span></span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-white"></span>
                    <span>Eficiencia: <span className="font-bold text-slate-700 dark:text-white">{ratePctText}%</span></span>
                  </div>
                </div>
              </div>

            </div>

            {/* Diagnóstico */}
            <div className="bg-slate-500/5 border border-slate-200 dark:border-slate-800/80 rounded-xl p-5">
              <span className="text-[9px] uppercase font-extrabold tracking-widest text-slate-400">
                Análisis y Diagnóstico Directo
              </span>
              <div className="text-xs leading-relaxed text-slate-700 dark:text-slate-350 space-y-2 mt-3">
                {narrativeContent}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

