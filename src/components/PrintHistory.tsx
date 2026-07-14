import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  RefreshCw,
  Trash2,
  Download,
  Printer,
  Clock,
  CheckCircle,
  XCircle,
  Calendar,
  AlertTriangle,
  FileText,
  Tag,
  ClipboardList,
  User,
  Layers,
  Activity,
  Filter,
  Award
} from "lucide-react";

interface PrintRecord {
  id: number;
  timestamp: string;
  productName: string | null;
  productSku: string | null;
  printerName: string;
  mode: string;
  copies: number;
  status: string;
  bridgeId: string | null;
  details: string | null;
  label_type?: string | null;
  format_id?: string | null;
  labels_per_row?: number | null;
  physical_labels?: number | null;
  waste_labels?: number | null;
  operator_code?: string | null;
  process_line?: string | null;
  printed_barcodes?: string | null;
}

interface ParsedRecord extends PrintRecord {
  type: "barras" | "trazabilidad" | "libre";
  labelsPerRow: number;
  physicalLabels: number;
  waste: number;
  errorMsg: string | null;
  brand: string;
  family: string;
  businessLine: string;
  operatorName: string;
}

export function PrintHistory() {
  const [records, setRecords] = useState<PrintRecord[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [empleados, setEmpleados] = useState<any[]>([]);
  const [formats, setFormats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [filterMode, setFilterMode] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterBrand, setFilterBrand] = useState<string>("all");
  const [filterOperator, setFilterOperator] = useState<string>("all");
  const [filterLine, setFilterLine] = useState<string>("all");
  
  // Date filter
  const [dateFilterType, setDateFilterType] = useState<string>("7d");
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");

  // Chart hover point state
  const [hoveredPoint, setHoveredPoint] = useState<{
    x: number;
    y: number;
    date: string;
    requested: number;
    physical: number;
  } | null>(null);

  // Theme detection
  const [theme, setTheme] = useState<'dark' | 'light' | 'glass'>(() => {
    return (localStorage.getItem('tracelabel-theme') as any) || 'dark';
  });

  useEffect(() => {
    const handleStorage = () => {
      setTheme((localStorage.getItem('tracelabel-theme') as any) || 'dark');
    };
    window.addEventListener('storage', handleStorage);
    
    const interval = setInterval(() => {
      const isDark = document.querySelector('.app-theme-dark');
      const isGlass = document.querySelector('.app-theme-glass');
      if (isDark) setTheme('dark');
      else if (isGlass) setTheme('glass');
      else setTheme('light');
    }, 1000);

    return () => {
      window.removeEventListener('storage', handleStorage);
      clearInterval(interval);
    };
  }, []);

  // Fetch all dashboard data concurrently
  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [resHist, resProd, resEmp, resFormats] = await Promise.all([
        fetch("/api/print-history?limit=1000"),
        fetch("/api/products"),
        fetch("/api/empleados"),
        fetch("/api/label-formats"),
      ]);
      
      if (resHist.ok) {
        const data = await resHist.json();
        setRecords(data);
      }
      if (resProd.ok) {
        const data = await resProd.json();
        setProducts(data);
      }
      if (resEmp.ok) {
        const data = await resEmp.json();
        setEmpleados(data);
      }
      if (resFormats.ok) {
        const data = await resFormats.json();
        setFormats(data);
      }
    } catch (e) {
      console.error("Error fetching dashboard data:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh history silently every 15s in the background
  useEffect(() => {
    const interval = setInterval(() => {
      fetchData(true);
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const clearHistory = async () => {
    if (!confirm("¿Borrar todo el historial de impresión?")) return;
    try {
      await fetch("/api/print-history", { method: "DELETE" });
      setRecords([]);
    } catch (e) {
      console.error("Error clearing history:", e);
    }
  };

  // Cross-reference print logs with product and employee catalogs
  const parsedRecords = useMemo<ParsedRecord[]>(() => {
    const productMap = new Map<string, any>();
    products.forEach((p) => productMap.set(p.sku, p));

    const employeeMap = new Map<string, any>();
    empleados.forEach((e) => employeeMap.set(e.codigo, e));

    return records.map((r) => {
      // 1. Determine print job type
      let type: "barras" | "trazabilidad" | "libre" = "barras";
      if (r.label_type === "libre" || r.productName === "Etiqueta libre") {
        type = "libre";
      } else if (r.label_type === "trazabilidad") {
        type = "trazabilidad";
      } else if (r.label_type === "barras") {
        type = "barras";
      } else if (r.details) {
        try {
          const parsed = JSON.parse(r.details);
          if (parsed.type) type = parsed.type;
        } catch {}
      }

      // 2. Determine format dimensions and columns
      let labelsPerRow = Number(r.labels_per_row) || 1;
      let physicalLabels = Number(r.physical_labels) || r.copies || 1;
      let waste = Number(r.waste_labels) || 0;

      // Fallback for old details format if no database columns were set
      if (!r.label_type && r.details) {
        try {
          const parsed = JSON.parse(r.details);
          if (parsed.labelsPerRow) {
            labelsPerRow = Number(parsed.labelsPerRow);
            const calculatedRows = Math.ceil((r.copies || 1) / labelsPerRow);
            physicalLabels = calculatedRows * labelsPerRow;
            waste = Math.max(0, physicalLabels - (r.copies || 1));
          }
        } catch {}
      }

      const errorMsg = r.status === "error" ? (r.details || "Error de impresión") : null;

      // 3. Cross-reference SKU details
      const prod = r.productSku ? productMap.get(r.productSku) : null;
      const brand = prod?.marca || (type === "libre" ? "Diseño Libre" : "Sin Marca");
      const family = prod?.family || "Sin Familia";
      const businessLine = prod?.business_line || "Sin Línea";

      // 4. Cross-reference Operator details
      const emp = r.operator_code ? employeeMap.get(r.operator_code) : null;
      const operatorName = emp?.nombre || r.operator_code || "Sin Operador";

      return {
        ...r,
        type,
        labelsPerRow,
        physicalLabels,
        waste,
        errorMsg,
        brand,
        family,
        businessLine,
        operatorName,
      };
    });
  }, [records, products, empleados]);

  // Unique filter lists
  const filterDropdownOptions = useMemo(() => {
    const brandsSet = new Set<string>();
    const operatorsMap = new Map<string, string>();
    const linesSet = new Set<string>();

    parsedRecords.forEach((r) => {
      if (r.brand && r.brand !== "Sin Marca" && r.brand !== "Diseño Libre") {
        brandsSet.add(r.brand);
      }
      if (r.operator_code) {
        operatorsMap.set(r.operator_code, r.operatorName);
      }
      if (r.process_line) {
        linesSet.add(r.process_line);
      }
    });

    return {
      brands: Array.from(brandsSet).sort(),
      operators: Array.from(operatorsMap.entries()).map(([code, name]) => ({ code, name })),
      lines: Array.from(linesSet).sort(),
    };
  }, [parsedRecords]);

  // Apply filters
  const filteredRecords = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    return parsedRecords.filter((r) => {
      // Search text
      if (searchTerm) {
        const s = searchTerm.toLowerCase();
        const matches =
          (r.productName || "").toLowerCase().includes(s) ||
          (r.productSku || "").toLowerCase().includes(s) ||
          (r.brand || "").toLowerCase().includes(s) ||
          (r.operatorName || "").toLowerCase().includes(s) ||
          (r.process_line || "").toLowerCase().includes(s) ||
          (r.printed_barcodes || "").toLowerCase().includes(s) ||
          r.printerName.toLowerCase().includes(s);
        if (!matches) return false;
      }

      // Dropdowns
      if (filterMode !== "all" && r.mode !== filterMode) return false;
      if (filterStatus !== "all" && r.status !== filterStatus) return false;
      if (filterType !== "all" && r.type !== filterType) return false;
      if (filterBrand !== "all" && r.brand !== filterBrand) return false;
      if (filterOperator !== "all" && r.operator_code !== filterOperator) return false;
      if (filterLine !== "all" && r.process_line !== filterLine) return false;

      // Date Range
      if (r.timestamp) {
        const rDate = new Date(r.timestamp + "Z");
        switch (dateFilterType) {
          case "hoy":
            if (rDate < today) return false;
            break;
          case "ayer":
            if (rDate < yesterday || rDate >= today) return false;
            break;
          case "7d":
            if (rDate < sevenDaysAgo) return false;
            break;
          case "30d":
            if (rDate < thirtyDaysAgo) return false;
            break;
          case "mes": {
            const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            if (rDate < startOfMonth) return false;
            break;
          }
          case "personalizado": {
            if (customStartDate) {
              const start = new Date(customStartDate);
              start.setHours(0, 0, 0, 0);
              if (rDate < start) return false;
            }
            if (customEndDate) {
              const end = new Date(customEndDate);
              end.setHours(23, 59, 59, 999);
              if (rDate > end) return false;
            }
            break;
          }
          default:
            break;
        }
      }
      return true;
    });
  }, [parsedRecords, searchTerm, filterMode, filterStatus, filterType, filterBrand, filterOperator, filterLine, dateFilterType, customStartDate, customEndDate]);

  // Main KPI Statistics
  const stats = useMemo(() => {
    let totalRequested = 0;
    let totalPhysical = 0;
    let totalWasted = 0;
    let successCount = 0;
    let errorCount = 0;

    filteredRecords.forEach((r) => {
      if (r.status === "success") {
        successCount++;
        totalRequested += r.copies || 1;
        totalPhysical += r.physicalLabels;
        totalWasted += r.waste;
      } else {
        errorCount++;
      }
    });

    const efficiency = totalPhysical > 0 ? Math.round((totalRequested / totalPhysical) * 100) : 100;
    const estimatedRolls = (totalPhysical / 1000).toFixed(1);

    return {
      totalRequested,
      totalPhysical,
      totalWasted,
      successCount,
      errorCount,
      efficiency,
      estimatedRolls,
    };
  }, [filteredRecords]);

  // Sugerencia de compra de rollos por dimensiones en mm
  const formatRollSuggester = useMemo(() => {
    const map = new Map<string, { width: number; height: number; name: string; cols: number; useful: number; physical: number; waste: number }>();

    const cleanFormatName = (nameStr: string) => {
      return nameStr.replace(/\s*\((?:EAN\s*13|DUN14|EAN13)\)/gi, "").trim();
    };

    filteredRecords.forEach((r) => {
      if (r.status !== "success") return;

      // Determine dimensions
      let width = 31;
      let height = 22;
      let name = "Estándar 30x22mm";
      let cols = r.labelsPerRow || 1;

      const fmt = formats.find(f => f.id === r.format_id);
      if (fmt) {
        width = fmt.width;
        height = fmt.height;
        name = cleanFormatName(fmt.name);
        cols = fmt.labelsPerRow;
      } else if (r.format_id === "1781023301687") {
        width = 50;
        height = 50;
        name = "Estándar 50x50mm";
        cols = 2;
      } else if (r.type === "libre") {
        width = 50;
        height = 25;
        name = "Diseño Libre 50x25mm";
        cols = 1;
      }

      const key = `${width}x${height}`;
      const existing = map.get(key) || { width, height, name, cols, useful: 0, physical: 0, waste: 0 };
      existing.useful += r.copies || 1;
      existing.physical += r.physicalLabels;
      existing.waste += r.waste;
      map.set(key, existing);
    });

    return Array.from(map.values()).map((item) => {
      const efficiency = item.physical > 0 ? Math.round((item.useful / item.physical) * 100) : 100;
      const suggestedRolls = Math.ceil(item.physical / 1000 * 10) / 10;
      return {
        ...item,
        efficiency,
        suggestedRolls,
      };
    });
  }, [filteredRecords, formats]);

  // Carga de Trabajo de Impresoras
  const printerStats = useMemo(() => {
    const map = new Map<string, { name: string; copies: number; jobs: number }>();
    filteredRecords.forEach((r) => {
      if (r.status !== "success") return;
      const existing = map.get(r.printerName) || { name: r.printerName, copies: 0, jobs: 0 };
      existing.copies += r.physicalLabels;
      existing.jobs += 1;
      map.set(r.printerName, existing);
    });
    const items = Array.from(map.values());
    const totalCopies = items.reduce((acc, i) => acc + i.copies, 0);
    return items.map((i) => ({
      ...i,
      percentage: totalCopies > 0 ? Math.round((i.copies / totalCopies) * 100) : 0,
    })).sort((a, b) => b.copies - a.copies);
  }, [filteredRecords]);

  // Rendimiento de Operadores (Trazabilidad)
  const operatorStats = useMemo(() => {
    const map = new Map<string, { code: string; name: string; copies: number; jobs: number }>();
    filteredRecords.forEach((r) => {
      if (r.status !== "success" || r.type !== "trazabilidad" || !r.operator_code) return;
      const existing = map.get(r.operator_code) || { code: r.operator_code, name: r.operatorName, copies: 0, jobs: 0 };
      existing.copies += r.copies || 1;
      existing.jobs += 1;
      map.set(r.operator_code, existing);
    });
    return Array.from(map.values()).sort((a, b) => b.copies - a.copies);
  }, [filteredRecords]);

  // Rendimiento por Línea de Envasado (Trazabilidad)
  const lineStats = useMemo(() => {
    const map = new Map<string, { line: string; copies: number; jobs: number }>();
    filteredRecords.forEach((r) => {
      if (r.status !== "success" || r.type !== "trazabilidad" || !r.process_line) return;
      const existing = map.get(r.process_line) || { line: r.process_line, copies: 0, jobs: 0 };
      existing.copies += r.copies || 1;
      existing.jobs += 1;
      map.set(r.process_line, existing);
    });
    const items = Array.from(map.values());
    const totalCopies = items.reduce((acc, i) => acc + i.copies, 0);
    return items.map((i) => ({
      ...i,
      percentage: totalCopies > 0 ? Math.round((i.copies / totalCopies) * 100) : 0,
    })).sort((a, b) => b.copies - a.copies);
  }, [filteredRecords]);

  // Consumo por Marca
  const brandStats = useMemo(() => {
    const map = new Map<string, { brand: string; copies: number; jobs: number }>();
    filteredRecords.forEach((r) => {
      if (r.status !== "success" || !r.brand) return;
      const existing = map.get(r.brand) || { brand: r.brand, copies: 0, jobs: 0 };
      existing.copies += r.copies || 1;
      existing.jobs += 1;
      map.set(r.brand, existing);
    });
    const items = Array.from(map.values());
    const totalCopies = items.reduce((acc, i) => acc + i.copies, 0);
    return items.map((i) => ({
      ...i,
      percentage: totalCopies > 0 ? Math.round((i.copies / totalCopies) * 100) : 0,
    })).sort((a, b) => b.copies - a.copies);
  }, [filteredRecords]);

  // Consumo por Tipo de Código de Barras / Etiqueta
  const codeStats = useMemo(() => {
    let eanCount = 0;
    let dunCount = 0;
    let skuCount = 0;
    let loteCount = 0;
    let libreCount = 0;

    filteredRecords.forEach((r) => {
      if (r.status !== "success") return;
      if (r.type === "trazabilidad") {
        loteCount += r.copies || 1;
      } else if (r.type === "libre") {
        libreCount += r.copies || 1;
      } else {
        const codes = (r.printed_barcodes || "").split(",");
        if (codes.includes("EAN13")) eanCount += r.copies || 1;
        if (codes.includes("DUN14")) dunCount += r.copies || 1;
        if (codes.includes("SKU")) skuCount += r.copies || 1;
      }
    });

    const total = eanCount + dunCount + skuCount + loteCount + libreCount;
    return [
      { name: "EAN-13 (Individual)", copies: eanCount, percentage: total > 0 ? Math.round((eanCount / total) * 100) : 0, colorBg: "bg-blue-500" },
      { name: "DUN-14 (Cajas)", copies: dunCount, percentage: total > 0 ? Math.round((dunCount / total) * 100) : 0, colorBg: "bg-amber-500" },
      { name: "Lote Trazabilidad", copies: loteCount, percentage: total > 0 ? Math.round((loteCount / total) * 100) : 0, colorBg: "bg-emerald-500" },
      { name: "SKU (Código 128)", copies: skuCount, percentage: total > 0 ? Math.round((skuCount / total) * 100) : 0, colorBg: "bg-red-500" },
      { name: "Diseño Libre", copies: libreCount, percentage: total > 0 ? Math.round((libreCount / total) * 100) : 0, colorBg: "bg-slate-500" },
    ];
  }, [filteredRecords]);

  // Trend Chart Data (Last 7 days or custom range)
  const dailyChartData = useMemo(() => {
    const dailyMap = new Map<string, { dateStr: string; requested: number; physical: number }>();
    
    if (dateFilterType === "7d") {
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
        dailyMap.set(key, { dateStr: key, requested: 0, physical: 0 });
      }
    }

    filteredRecords.forEach((r) => {
      if (r.status !== "success" || !r.timestamp) return;
      const d = new Date(r.timestamp + "Z");
      const key = d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
      
      const existing = dailyMap.get(key) || { dateStr: key, requested: 0, physical: 0 };
      existing.requested += r.copies || 1;
      existing.physical += r.physicalLabels;
      dailyMap.set(key, existing);
    });

    return Array.from(dailyMap.values());
  }, [filteredRecords, dateFilterType]);

  // SVG Area Chart parameters
  const chartSvg = useMemo(() => {
    const width = 600;
    const height = 180;
    const paddingLeft = 40;
    const paddingRight = 20;
    const paddingTop = 15;
    const paddingBottom = 25;

    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;

    if (dailyChartData.length === 0) return null;

    const maxVal = Math.max(...dailyChartData.map((d) => d.physical), 10);
    const yMax = Math.ceil(maxVal / 10) * 10;

    const points = dailyChartData.map((d, index) => {
      const x = paddingLeft + (index / Math.max(1, dailyChartData.length - 1)) * chartWidth;
      const yPhysical = paddingTop + chartHeight - (d.physical / yMax) * chartHeight;
      const yRequested = paddingTop + chartHeight - (d.requested / yMax) * chartHeight;
      return { x, yPhysical, yRequested, raw: d };
    });

    let areaPath = "";
    let linePath = "";
    let reqLinePath = "";

    if (points.length > 0) {
      areaPath = `M ${points[0].x} ${paddingTop + chartHeight} `;
      points.forEach((p) => {
        areaPath += `L ${p.x} ${p.yPhysical} `;
      });
      areaPath += `L ${points[points.length - 1].x} ${paddingTop + chartHeight} Z`;

      linePath = `M ${points[0].x} ${points[0].yPhysical} `;
      points.forEach((p) => {
        linePath += `L ${p.x} ${p.yPhysical} `;
      });

      reqLinePath = `M ${points[0].x} ${points[0].yRequested} `;
      points.forEach((p) => {
        reqLinePath += `L ${p.x} ${p.yRequested} `;
      });
    }

    return {
      width, height, paddingLeft, paddingRight, paddingTop, paddingBottom,
      chartWidth, chartHeight, yMax, points, areaPath, linePath, reqLinePath
    };
  }, [dailyChartData]);



  // CSV Export
  const exportHistory = () => {
    const header = "Fecha,Hora,Producto,SKU,Marca,Tipo,Copias_Solicitadas,Etiquetas_Fisicas,Desperdicio,Operador,Linea,Impresora,Modo,Estado\n";
    const rows = filteredRecords
      .map((r) => {
        const d = new Date(r.timestamp + "Z");
        return `${d.toLocaleDateString("es")},${d.toLocaleTimeString("es")},"${(r.productName || "Etiqueta libre").replace(/"/g, '""')}",${r.productSku || ""},"${r.brand}",${r.type},${r.copies},${r.physicalLabels},${r.waste},"${r.operatorName}","${r.process_line || ""}","${r.printerName}",${r.mode},${r.status}`;
      })
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `historial-analitico-etiquetas-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Group detailed records by date for list rendering
  const groupByDate = (items: ParsedRecord[]) => {
    const groups: { [key: string]: ParsedRecord[] } = {};
    items.forEach((item) => {
      if (!item.timestamp) return;
      const d = new Date(item.timestamp + "Z");
      const key = d.toLocaleDateString("es", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });
    return groups;
  };

  const groupedRecords = groupByDate(filteredRecords);

  // Styling based on theme
  const cardBg =
    theme === 'dark' ? 'bg-slate-800/80 border-slate-700/60 shadow-lg text-slate-100' :
    theme === 'glass' ? 'bg-white/5 backdrop-blur-md border-white/10 shadow-[0_8px_32px_0_rgba(0,0,0,0.25)] text-white' :
    'bg-white border-slate-200 shadow-sm text-slate-800';

  const subText = theme === 'light' ? 'text-slate-500' : 'text-slate-400';
  const innerHeaderBg =
    theme === 'dark' ? 'bg-slate-900 border-slate-800' :
    theme === 'glass' ? 'bg-slate-950/20 border-white/5' :
    'bg-slate-50 border-slate-200';

  return (
    <div className="space-y-6">
      {/* 1. KPIs Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className={`rounded-xl border p-4 transition-all ${cardBg}`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-500">Etiquetas Físicas</span>
            <Printer className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-3xl font-extrabold tracking-tight mt-1.5 tabular-nums">
            {stats.totalPhysical}
          </div>
          <div className={`text-[10px] mt-1 ${subText}`}>
            Consumidas ({stats.totalRequested} útiles)
          </div>
        </div>

        <div className={`rounded-xl border p-4 transition-all ${cardBg}`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-500">Eficiencia Papel</span>
            <Activity className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-3xl font-extrabold tracking-tight mt-1.5 text-amber-500 tabular-nums">
            {stats.efficiency}%
          </div>
          <div className={`text-[10px] mt-1 ${subText}`}>
            Etiquetas útiles del total físico
          </div>
        </div>

        <div className={`rounded-xl border p-4 transition-all ${cardBg}`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-red-500">Desperdicio</span>
            <AlertTriangle className="w-4 h-4 text-red-500" />
          </div>
          <div className="text-3xl font-extrabold tracking-tight mt-1.5 text-red-400 tabular-nums">
            {stats.totalWasted}
          </div>
          <div className={`text-[10px] mt-1 ${subText}`}>
            Espacios vacíos en bobinas
          </div>
        </div>

        <div className={`rounded-xl border p-4 transition-all ${cardBg}`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-500">Rollos Estimados</span>
            <Layers className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-3xl font-extrabold tracking-tight mt-1.5 text-emerald-500 tabular-nums">
            {stats.estimatedRolls}
          </div>
          <div className={`text-[10px] mt-1 ${subText}`}>
            Rollos de 1,000 unidades
          </div>
        </div>
      </div>

      {/* 2. Visual Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Trend Area Chart */}
        <div className={`lg:col-span-2 rounded-xl border p-4 flex flex-col relative transition-all ${cardBg}`}>
          <h4 className="text-xs font-bold uppercase tracking-wider mb-3">Historial de Consumo Diario (Bobina vs Útil)</h4>
          {dailyChartData.length === 0 ? (
            <div className="flex-1 flex items-center justify-center min-h-[160px] text-xs text-slate-400">
              Sin datos suficientes para graficar
            </div>
          ) : chartSvg ? (
            <div className="relative flex-1">
              <svg viewBox={`0 0 ${chartSvg.width} ${chartSvg.height}`} className="w-full h-auto overflow-visible select-none">
                <defs>
                  <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                <line x1={chartSvg.paddingLeft} y1={chartSvg.paddingTop} x2={chartSvg.width - chartSvg.paddingRight} y2={chartSvg.paddingTop} stroke={theme === 'light' ? '#e2e8f0' : 'rgba(255,255,255,0.06)'} strokeDasharray="3 3" />
                <line x1={chartSvg.paddingLeft} y1={chartSvg.paddingTop + chartSvg.chartHeight / 2} x2={chartSvg.width - chartSvg.paddingRight} y2={chartSvg.paddingTop + chartSvg.chartHeight / 2} stroke={theme === 'light' ? '#e2e8f0' : 'rgba(255,255,255,0.06)'} strokeDasharray="3 3" />
                <line x1={chartSvg.paddingLeft} y1={chartSvg.paddingTop + chartSvg.chartHeight} x2={chartSvg.width - chartSvg.paddingRight} y2={chartSvg.paddingTop + chartSvg.chartHeight} stroke={theme === 'light' ? '#cbd5e1' : 'rgba(255,255,255,0.12)'} />
                <text x={chartSvg.paddingLeft - 8} y={chartSvg.paddingTop + 4} textAnchor="end" className="text-[9px] fill-slate-400 font-mono">{chartSvg.yMax}</text>
                <text x={chartSvg.paddingLeft - 8} y={chartSvg.paddingTop + chartSvg.chartHeight / 2 + 4} textAnchor="end" className="text-[9px] fill-slate-400 font-mono">{Math.round(chartSvg.yMax / 2)}</text>
                <text x={chartSvg.paddingLeft - 8} y={chartSvg.paddingTop + chartSvg.chartHeight + 4} textAnchor="end" className="text-[9px] fill-slate-400 font-mono">0</text>
                <path d={chartSvg.areaPath} fill="url(#chartGradient)" />
                <path d={chartSvg.linePath} fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d={chartSvg.reqLinePath} fill="none" stroke="#10b981" strokeWidth="1.5" strokeDasharray="3 3" strokeLinecap="round" strokeLinejoin="round" />
                {chartSvg.points.map((p, i) => (
                  <g key={i} className="group/dot">
                    <text x={p.x} y={chartSvg.paddingTop + chartSvg.chartHeight + 15} textAnchor="middle" className="text-[9px] fill-slate-400 font-medium">{p.raw.dateStr}</text>
                    <circle
                      cx={p.x} cy={p.yPhysical} r="4" className="fill-white stroke-blue-500 cursor-pointer transition-all hover:scale-150" strokeWidth="2.5"
                      onMouseEnter={(e) => {
                        const bounds = e.currentTarget.getBoundingClientRect();
                        const parentBounds = e.currentTarget.parentElement?.parentElement?.getBoundingClientRect();
                        if (parentBounds) {
                          setHoveredPoint({
                            x: bounds.left - parentBounds.left + 5,
                            y: bounds.top - parentBounds.top - 65,
                            date: p.raw.dateStr,
                            requested: p.raw.requested,
                            physical: p.raw.physical
                          });
                        }
                      }}
                      onMouseLeave={() => setHoveredPoint(null)}
                    />
                  </g>
                ))}
              </svg>
              {hoveredPoint && (
                <div className="absolute pointer-events-none bg-slate-900 border border-slate-700/60 p-2 rounded-lg text-white shadow-xl z-50 text-[10px] space-y-0.5" style={{ left: hoveredPoint.x, top: hoveredPoint.y }}>
                  <div className="font-bold text-slate-300">{hoveredPoint.date}</div>
                  <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block"></span><span>Bobina Física: <strong>{hoveredPoint.physical}</strong></span></div>
                  <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span><span>Etiquetas Útiles: <strong>{hoveredPoint.requested}</strong></span></div>
                </div>
              )}
            </div>
          ) : null}
          <div className="flex gap-4 mt-2 justify-end text-[9px] font-bold text-slate-400">
            <div className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500 inline-block"></span><span>Bobina Física (Total)</span></div>
            <div className="flex items-center gap-1"><span className="w-3 h-0.5 bg-emerald-500 border-t border-dashed inline-block"></span><span>Solicitadas (Útiles)</span></div>
          </div>
        </div>

        {/* Print Distribution by Code / Label Type Card */}
        <div className={`rounded-xl border p-4 flex flex-col transition-all ${cardBg}`}>
          <div className="flex items-center gap-2 border-b border-slate-700/10 pb-2 mb-3">
            <Layers className="w-4 h-4 text-indigo-500" />
            <h4 className="text-xs font-bold uppercase tracking-wider">Distribución por Tipo de Código</h4>
          </div>
          <div className="space-y-3.5 flex-1 flex flex-col justify-center">
            {codeStats.map((item, idx) => (
              <div key={idx} className="space-y-1">
                <div className="flex text-xs font-semibold">
                  <span>{item.name}</span>
                  <span className="ml-auto font-mono tabular-nums">{item.copies} u. ({item.percentage}%)</span>
                </div>
                <div className="w-full bg-slate-500/10 rounded-full h-2 overflow-hidden">
                  <div className={`${item.colorBg} h-full rounded-full transition-all`} style={{ width: `${item.percentage}%` }}></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 3. Insumos and Purchase Suggestion Table */}
      <div className={`rounded-xl border overflow-hidden transition-all ${cardBg}`}>
        <div className={`px-4 py-3 border-b flex items-center gap-2 ${innerHeaderBg}`}>
          <Layers className="w-4 h-4 text-blue-500" />
          <h4 className="text-xs font-bold uppercase tracking-wider">Consumo de Insumos Físicos y Compra de Rollos</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-700/30 text-[10px] font-bold uppercase text-slate-400 bg-slate-500/5">
                <th className="px-4 py-3">Nombre del Formato</th>
                <th className="px-4 py-3">Medida Física</th>
                <th className="px-4 py-3 text-right">Columnas</th>
                <th className="px-4 py-3 text-right">Etq. Útiles</th>
                <th className="px-4 py-3 text-right">Etq. Físicas (Bobina)</th>
                <th className="px-4 py-3 text-right">Desperdicio</th>
                <th className="px-4 py-3 text-right">Eficiencia</th>
                <th className="px-4 py-3 text-right text-emerald-500">Sugerencia Compra (Rollos 1000 u.)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/10">
              {formatRollSuggester.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-slate-400">
                    No se han registrado impresiones exitosas en este período
                  </td>
                </tr>
              ) : (
                formatRollSuggester.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-500/5">
                    <td className="px-4 py-3 font-semibold">{item.name}</td>
                    <td className="px-4 py-3 font-mono">{item.width} × {item.height} mm</td>
                    <td className="px-4 py-3 text-right font-mono">{item.cols} col</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">{item.useful}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">{item.physical}</td>
                    <td className={`px-4 py-3 text-right font-mono tabular-nums ${item.waste > 0 ? "text-red-400 font-semibold" : subText}`}>
                      {item.waste} ({100 - item.efficiency}%)
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`px-2 py-0.5 rounded font-bold ${
                        item.efficiency > 95 ? "bg-emerald-500/10 text-emerald-500" :
                        item.efficiency > 80 ? "bg-amber-500/10 text-amber-500" :
                        "bg-red-500/10 text-red-500"
                      }`}>
                        {item.efficiency}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-emerald-500 font-mono tabular-nums">
                      {item.suggestedRolls} rollos <span className="text-[10px] text-slate-400">({Math.ceil(item.suggestedRolls)} entero)</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. Cross-Reference Metrics: Printers, Brands, Operators, Lines */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Printers workload */}
        <div className={`rounded-xl border p-4 flex flex-col transition-all ${cardBg}`}>
          <div className="flex items-center gap-2 border-b border-slate-700/10 pb-2 mb-3">
            <Printer className="w-4 h-4 text-blue-500" />
            <h4 className="text-xs font-bold uppercase tracking-wider">Carga de Impresoras</h4>
          </div>
          <div className="space-y-3 flex-1">
            {printerStats.length === 0 ? (
              <div className="text-xs text-slate-400 text-center py-4">Sin datos de impresoras</div>
            ) : (
              printerStats.map((item, idx) => (
                <div key={idx} className="space-y-1">
                  <div className="flex text-xs font-semibold">
                    <span className="truncate max-w-[120px]">{item.name}</span>
                    <span className="ml-auto font-mono tabular-nums">{item.copies} u. ({item.percentage}%)</span>
                  </div>
                  <div className="w-full bg-slate-500/10 rounded-full h-2 overflow-hidden">
                    <div className="bg-blue-500 h-full rounded-full transition-all" style={{ width: `${item.percentage}%` }}></div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Brands consumption */}
        <div className={`rounded-xl border p-4 flex flex-col transition-all ${cardBg}`}>
          <div className="flex items-center gap-2 border-b border-slate-700/10 pb-2 mb-3">
            <Tag className="w-4 h-4 text-indigo-500" />
            <h4 className="text-xs font-bold uppercase tracking-wider">Gasto por Marca</h4>
          </div>
          <div className="space-y-3 flex-1">
            {brandStats.length === 0 ? (
              <div className="text-xs text-slate-400 text-center py-4">Sin datos de marcas</div>
            ) : (
              brandStats.map((item, idx) => (
                <div key={idx} className="space-y-1">
                  <div className="flex text-xs font-semibold">
                    <span className="truncate max-w-[120px]">{item.brand}</span>
                    <span className="ml-auto font-mono tabular-nums">{item.copies} u. ({item.percentage}%)</span>
                  </div>
                  <div className="w-full bg-slate-500/10 rounded-full h-2 overflow-hidden">
                    <div className="bg-indigo-500 h-full rounded-full transition-all" style={{ width: `${item.percentage}%` }}></div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Operator productivity */}
        <div className={`rounded-xl border p-4 flex flex-col transition-all ${cardBg}`}>
          <div className="flex items-center gap-2 border-b border-slate-700/10 pb-2 mb-3">
            <Award className="w-4 h-4 text-emerald-500" />
            <h4 className="text-xs font-bold uppercase tracking-wider">Productividad de Operadores</h4>
          </div>
          <div className="space-y-1.5 flex-1 max-h-[220px] overflow-y-auto pr-1">
            {operatorStats.length === 0 ? (
              <div className="text-xs text-slate-400 text-center py-4">Ningún operador registrado aún</div>
            ) : (
              operatorStats.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs py-1 hover:bg-slate-500/5 px-2 rounded">
                  <span className="w-4 font-bold text-emerald-500 font-mono">#{idx + 1}</span>
                  <User className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                  <span className="font-semibold truncate max-w-[100px]">{item.name}</span>
                  <span className="text-[9px] font-bold font-mono bg-slate-500/15 text-slate-400 px-1 py-0.2 rounded">Cód. {item.code}</span>
                  <span className="ml-auto font-mono font-bold text-emerald-500 tabular-nums">{item.copies} etq.</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Process lines workload */}
        <div className={`rounded-xl border p-4 flex flex-col transition-all ${cardBg}`}>
          <div className="flex items-center gap-2 border-b border-slate-700/10 pb-2 mb-3">
            <Layers className="w-4 h-4 text-purple-500" />
            <h4 className="text-xs font-bold uppercase tracking-wider">Carga por Línea de Envasado</h4>
          </div>
          <div className="space-y-3 flex-1">
            {lineStats.length === 0 ? (
              <div className="text-xs text-slate-400 text-center py-4">Sin datos de líneas</div>
            ) : (
              lineStats.map((item, idx) => (
                <div key={idx} className="space-y-1">
                  <div className="flex text-xs font-semibold">
                    <span className="truncate max-w-[120px]">{item.line}</span>
                    <span className="ml-auto font-mono tabular-nums">{item.copies} u. ({item.percentage}%)</span>
                  </div>
                  <div className="w-full bg-slate-500/10 rounded-full h-2 overflow-hidden">
                    <div className="bg-purple-500 h-full rounded-full transition-all" style={{ width: `${item.percentage}%` }}></div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 5. Toolbar & Advanced Filters */}
      <div className={`rounded-xl border overflow-hidden transition-all ${cardBg}`}>
        <div className={`px-4 py-3 border-b ${innerHeaderBg}`}>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <Filter className="w-4 h-4 text-blue-500" />
                <h3 className="text-sm font-bold">Filtros y Búsqueda Avanzada</h3>
                <span className="text-xs text-slate-400">({filteredRecords.length} trabajos filtrados)</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={exportHistory} className="p-1.5 text-slate-400 hover:text-blue-500 transition-colors cursor-pointer" title="Exportar reporte CSV analítico">
                  <Download className="w-4 h-4" />
                </button>
                <button onClick={clearHistory} className="p-1.5 text-slate-400 hover:text-red-500 transition-colors cursor-pointer" title="Borrar historial completo">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Grid of filters */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 items-end">
              {/* Search text */}
              <div className="flex flex-col">
                <label htmlFor="search-input" className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1">Buscar</label>
                <input
                  id="search-input" type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="SKU, producto, operador..." className="text-xs border border-slate-200 dark:border-slate-700/60 rounded px-2.5 py-1.5 bg-white text-slate-800 outline-none focus:border-blue-500"
                />
              </div>

              {/* Date Presets */}
              <div className="flex flex-col">
                <label htmlFor="date-preset" className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1">Fecha</label>
                <select
                  id="date-preset" value={dateFilterType} onChange={(e) => setDateFilterType(e.target.value)}
                  className="text-xs border border-slate-200 dark:border-slate-700/60 rounded px-2 py-1.5 bg-white text-slate-800 outline-none"
                >
                  <option value="all">Todo el historial</option>
                  <option value="hoy">Hoy</option>
                  <option value="ayer">Ayer</option>
                  <option value="7d">Últimos 7 días</option>
                  <option value="30d">Últimos 30 días</option>
                  <option value="mes">Mes en curso</option>
                  <option value="personalizado">Rango Personalizado</option>
                </select>
              </div>

              {/* Format type */}
              <div className="flex flex-col">
                <label htmlFor="format-filter" className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1">Tipo Formato</label>
                <select
                  id="format-filter" value={filterType} onChange={(e) => setFilterType(e.target.value)}
                  className="text-xs border border-slate-200 dark:border-slate-700/60 rounded px-2 py-1.5 bg-white text-slate-800 outline-none"
                >
                  <option value="all">Todos los tipos</option>
                  <option value="barras">Código de Barras</option>
                  <option value="trazabilidad">Trazabilidad</option>
                  <option value="libre">Diseño Libre</option>
                </select>
              </div>

              {/* Connection Mode */}
              <div className="flex flex-col">
                <label htmlFor="mode-filter" className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1">Modo</label>
                <select
                  id="mode-filter" value={filterMode} onChange={(e) => setFilterMode(e.target.value)}
                  className="text-xs border border-slate-200 dark:border-slate-700/60 rounded px-2 py-1.5 bg-white text-slate-800 outline-none"
                >
                  <option value="all">Todos los modos</option>
                  <option value="local">Local (USB)</option>
                  <option value="cloud">Nube (LAN)</option>
                </select>
              </div>

              {/* Brand Filter */}
              <div className="flex flex-col">
                <label htmlFor="brand-filter" className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1">Marca</label>
                <select
                  id="brand-filter" value={filterBrand} onChange={(e) => setFilterBrand(e.target.value)}
                  className="text-xs border border-slate-200 dark:border-slate-700/60 rounded px-2 py-1.5 bg-white text-slate-800 outline-none"
                >
                  <option value="all">Todas las marcas</option>
                  {filterDropdownOptions.brands.map((b, i) => <option key={i} value={b}>{b}</option>)}
                </select>
              </div>

              {/* Operator Filter */}
              <div className="flex flex-col">
                <label htmlFor="operator-filter" className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1">Operador</label>
                <select
                  id="operator-filter" value={filterOperator} onChange={(e) => setFilterOperator(e.target.value)}
                  className="text-xs border border-slate-200 dark:border-slate-700/60 rounded px-2 py-1.5 bg-white text-slate-800 outline-none"
                >
                  <option value="all">Todos los operadores</option>
                  {filterDropdownOptions.operators.map((op, i) => <option key={i} value={op.code}>{op.name}</option>)}
                </select>
              </div>

              {/* Process Line Filter */}
              <div className="flex flex-col">
                <label htmlFor="line-filter" className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1">Línea</label>
                <select
                  id="line-filter" value={filterLine} onChange={(e) => setFilterLine(e.target.value)}
                  className="text-xs border border-slate-200 dark:border-slate-700/60 rounded px-2 py-1.5 bg-white text-slate-800 outline-none"
                >
                  <option value="all">Todas las líneas</option>
                  {filterDropdownOptions.lines.map((l, i) => <option key={i} value={l}>{l}</option>)}
                </select>
              </div>
            </div>

            {/* Custom Dates */}
            {dateFilterType === "personalizado" && (
              <div className="flex gap-4 p-3 bg-slate-500/5 rounded-lg border border-slate-500/10 max-w-md animate-fadeIn">
                <div className="flex-1 flex flex-col">
                  <label htmlFor="start-date" className="text-[9px] font-bold uppercase text-slate-400 mb-1">Fecha Inicio</label>
                  <input
                    id="start-date" type="date" value={customStartDate} onChange={(e) => setCustomStartDate(e.target.value)}
                    className="text-xs border border-slate-200 dark:border-slate-700/60 rounded px-2 py-1 bg-white text-slate-800 outline-none"
                  />
                </div>
                <div className="flex-1 flex flex-col">
                  <label htmlFor="end-date" className="text-[9px] font-bold uppercase text-slate-400 mb-1">Fecha Término</label>
                  <input
                    id="end-date" type="date" value={customEndDate} onChange={(e) => setCustomEndDate(e.target.value)}
                    className="text-xs border border-slate-200 dark:border-slate-700/60 rounded px-2 py-1 bg-white text-slate-800 outline-none"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Detailed records list table */}
        <div className={`max-h-[450px] overflow-y-auto ${loading && records.length > 0 ? 'opacity-60 transition-opacity pointer-events-none' : ''}`}>
          {loading && records.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" />
              Cargando historial analítico...
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 text-center">
              <Clock className="w-10 h-10 mb-2 opacity-35" />
              <p className="text-sm font-semibold">No se encontraron impresiones</p>
              <p className="text-xs mt-1">Intenta ajustando los filtros seleccionados</p>
            </div>
          ) : (
            Object.entries(groupedRecords).map(([dateLabel, items]) => (
              <div key={dateLabel}>
                <div className={`px-4 py-2 border-b border-t first:border-t-0 sticky top-0 z-10 flex justify-between items-center ${innerHeaderBg}`}>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{dateLabel}</span>
                  <span className="text-[10px] font-bold text-slate-400">({items.length} trabajos)</span>
                </div>
                <div className="divide-y divide-slate-700/10">
                  {items.map((r) => {
                    const d = new Date(r.timestamp + "Z");
                    const isError = r.status === "error";
                    const TypeIcon = r.type === "libre" ? FileText : r.type === "trazabilidad" ? ClipboardList : Tag;
                    const typeColors =
                      r.type === "libre" ? "bg-emerald-500/10 text-emerald-500" :
                      r.type === "trazabilidad" ? "bg-amber-500/10 text-amber-500" :
                      "bg-blue-500/10 text-blue-500";

                    return (
                      <div key={r.id} className={`px-4 py-3 hover:bg-slate-500/5 transition-colors ${isError ? "bg-red-500/5" : ""}`}>
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${typeColors} flex-shrink-0`}><TypeIcon className="w-4 h-4" /></div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-bold truncate">{r.productName || "Diseño libre"}</span>
                              {r.productSku && (
                                <span className="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded bg-slate-500/15 text-slate-400">
                                  {r.productSku}
                                </span>
                              )}
                              {r.brand && r.brand !== "Sin Marca" && r.brand !== "Diseño Libre" && (
                                <span className="text-[9px] font-semibold text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded">
                                  {r.brand}
                                </span>
                              )}
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[10px] font-bold text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded">Útiles: {r.copies}</span>
                                {r.physicalLabels !== r.copies && (
                                  <span className="text-[10px] font-bold text-slate-400 bg-slate-500/15 px-2 py-0.5 rounded" title="Consumo real de papel (Filas * Columnas)">
                                    Físicas: {r.physicalLabels} (desperdicio: {r.waste})
                                  </span>
                                )}
                                {r.printed_barcodes && r.printed_barcodes.split(",").map((code, cIdx) => {
                                  const trimmedCode = code.trim();
                                  if (!trimmedCode) return null;
                                  return (
                                    <span key={cIdx} className="text-[9px] font-extrabold text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20 uppercase tracking-wider">
                                      {trimmedCode}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400 flex-wrap">
                              <Printer className="w-3 h-3 flex-shrink-0" />
                              <span className="truncate max-w-[150px]">{r.printerName}</span>
                              <span className="opacity-50">·</span>
                              <span>{r.mode === "cloud" ? "Nube (LAN)" : "Local (Bypass)"}</span>
                              
                              {r.type === "trazabilidad" && (
                                <>
                                  <span className="opacity-50">·</span>
                                  <span className="text-amber-500 font-medium">Operador: {r.operatorName}</span>
                                  {r.process_line && (
                                    <>
                                      <span className="opacity-30">|</span>
                                      <span className="text-amber-500/80 font-medium">{r.process_line}</span>
                                    </>
                                  )}
                                </>
                              )}

                              {isError && r.errorMsg && (
                                <><span className="text-red-500 font-bold">·</span><span className="text-red-500 font-medium truncate max-w-[250px]" title={r.errorMsg}>Error: {r.errorMsg}</span></>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                            {r.status === "success" ? (
                              <span className="inline-flex items-center gap-1 text-[8px] font-black uppercase bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded-full"><CheckCircle className="w-2.5 h-2.5" /> Éxito</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[8px] font-black uppercase bg-red-500/10 text-red-500 px-2 py-0.5 rounded-full"><XCircle className="w-2.5 h-2.5" /> Fallo</span>
                            )}
                            <span className="text-[10px] text-slate-400 font-mono tabular-nums">{d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
