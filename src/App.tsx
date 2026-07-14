import React, { useState, useEffect, useRef, useMemo } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  Plus,
  Search,
  Upload,
  Printer,
  Download,
  Trash2,
  Edit,
  Package,
  Tag,
  FileText,
  Settings,
  Filter,
  ClipboardList,
  Users,
  PenTool,
  Monitor,
  Globe,
  Copy,
  Terminal,
  Calendar,
  Cpu,
  Send,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
} from "lucide-react";
import { Product, LabelFormat, TipoEmpaqueSecundario, TipoEnvasePrimario } from "./types";
import { ProductForm } from "./components/ProductForm";
import { PrintModal } from "./components/PrintModal";
import { TracePrintModal } from "./components/TracePrintModal";
import { LabelPreview } from "./components/LabelPreview";
import { EmpleadosManager } from "./components/EmpleadosManager";
import { SystemConsole } from "./components/SystemConsole";
import { PrintHistory } from "./components/PrintHistory";
import { PrinterManager } from "./components/PrinterManager";
import { FreeLabelCreator } from "./components/FreeLabelCreator";
import { LineasProcesoManager } from "./components/LineasProcesoManager";
import { PlanificacionManager } from "./components/PlanificacionManager";
import { WhatsAppConfigTab } from "./components/WhatsAppConfigTab";

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light' | 'glass'>(() => (localStorage.getItem('tracelabel-theme') as any) || 'dark');
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [filterBusinessLine, setFilterBusinessLine] = useState("");
  const [filterFamily, setFilterFamily] = useState("");
  const [filterMarca, setFilterMarca] = useState("");
  const [filterFormato, setFilterFormato] = useState("");
  const [filterStatus, setFilterStatus] = useState("activo"); // 'todos', 'activo', 'inactivo'
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 50;

  const [sortColumn, setSortColumn] = useState<string>("sku");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const defaultColumnOrder = [
    "sku", "item_name", "ean13", "dun14", "isp", "marca", "caducidad", 
    "envase_primario_tipo", "envase_secundario_tipo", "tapa_tipo", "cant_grupal", "cant_individual", "formato", 
    "barras", "trazab", "editar", "eliminar"
  ];

  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem("tracelabel-column-order");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const existing = parsed.filter(id => defaultColumnOrder.includes(id));
          const missing = defaultColumnOrder.filter(id => !existing.includes(id));
          if (existing.length > 0) {
            return [...existing, ...missing];
          }
        }
      } catch (e) {}
    }
    return defaultColumnOrder;
  });

  // Save column order to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem("tracelabel-column-order", JSON.stringify(columnOrder));
  }, [columnOrder]);

  const [hiddenColumns, setHiddenColumns] = useState<string[]>(() => {
    const saved = localStorage.getItem("tracelabel-hidden-columns");
    return saved ? JSON.parse(saved) : [];
  });

  const [isColumnDropdownOpen, setIsColumnDropdownOpen] = useState(false);
  const columnDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem("tracelabel-hidden-columns", JSON.stringify(hiddenColumns));
  }, [hiddenColumns]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (columnDropdownRef.current && !columnDropdownRef.current.contains(event.target as Node)) {
        setIsColumnDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const defaultWidths: Record<string, number> = {
    sku: 95,
    item_name: 270,
    ean13: 130,
    dun14: 140,
    isp: 90,
    marca: 110,
    caducidad: 80,
    envase_primario_tipo: 90,
    envase_secundario_tipo: 90,
    tapa_tipo: 90,
    cant_grupal: 100,
    cant_individual: 100,
    formato: 100,
    barras: 70,
    trazab: 75,
    editar: 70,
    eliminar: 75
  };

  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem("tracelabel-column-widths");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === "object") {
          return { ...defaultWidths, ...parsed };
        }
      } catch (e) {}
    }
    return defaultWidths;
  });

  // Save widths to localStorage
  useEffect(() => {
    localStorage.setItem("tracelabel-column-widths", JSON.stringify(columnWidths));
  }, [columnWidths]);

  const [hoveredResizeCol, setHoveredResizeCol] = useState<string | null>(null);

  const handleResizeStart = (e: React.MouseEvent, colId: string) => {
    e.stopPropagation();
    e.preventDefault();

    const startX = e.clientX;
    const startWidth = columnWidths[colId] || defaultWidths[colId] || 100;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const newWidth = Math.max(50, startWidth + deltaX); // Limit min width to 50px
      setColumnWidths((prev) => ({
        ...prev,
        [colId]: newWidth
      }));
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const draggedColIdRef = useRef<string | null>(null);
  const isDragActiveRef = useRef<boolean>(false);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);
  const [dragDirection, setDragDirection] = useState<"left" | "right" | null>(null);

  const handleDragStart = (e: React.DragEvent<HTMLTableHeaderCellElement>, id: string) => {
    draggedColIdRef.current = id;
    isDragActiveRef.current = true;
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent<HTMLTableHeaderCellElement>, targetId: string) => {
    e.preventDefault();
    if (draggedColIdRef.current === targetId) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const isLeft = mouseX < rect.width / 2;

    setDragOverColId(targetId);
    setDragDirection(isLeft ? "left" : "right");
  };

  const handleDragEnd = () => {
    draggedColIdRef.current = null;
    setDragOverColId(null);
    setDragDirection(null);
    setTimeout(() => {
      isDragActiveRef.current = false;
    }, 100);
  };

  const handleDrop = (e: React.DragEvent<HTMLTableHeaderCellElement>, targetId: string) => {
    e.preventDefault();
    const draggedId = draggedColIdRef.current;
    if (!draggedId || draggedId === targetId) return;

    setColumnOrder((prevOrder) => {
      const filtered = prevOrder.filter((id) => id !== draggedId);
      const targetIdx = filtered.indexOf(targetId);
      
      let nextOrder = [...filtered];
      if (dragDirection === "left") {
        nextOrder.splice(targetIdx, 0, draggedId);
      } else {
        nextOrder.splice(targetIdx + 1, 0, draggedId);
      }
      return nextOrder;
    });

    setDragOverColId(null);
    setDragDirection(null);
  };

  const handleSort = (columnId: string) => {
    if (isDragActiveRef.current) return;
    
    const col = columnsConfig[columnId];
    if (!col || !col.sortable) return;

    if (sortColumn === columnId) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(columnId);
      setSortDirection("asc");
    }
  };

  // Reset pagination when filters, search, or sorting change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, filterBusinessLine, filterFamily, filterMarca, filterFormato, filterStatus, sortColumn, sortDirection]);

  const [currentView, setCurrentView] = useState<
    "maestro" | "formatos" | "historial" | "configuracion" | "disenador" | "planificacion"
  >(() => {
    return (localStorage.getItem("tracelabel-current-view") as any) || "maestro";
  });
  const [configTab, setConfigTab] = useState<"basedatos" | "operadores" | "lineas" | "whatsapp" | "impresoras" | "instalacion" | "consola" | "empaques">(() => {
    return (localStorage.getItem("tracelabel-config-tab") as any) || "operadores";
  });
  const [envaseSubTab, setEnvaseSubTab] = useState<"primarios" | "secundarios" | "tapas">("primarios");

  useEffect(() => {
    localStorage.setItem("tracelabel-current-view", currentView);
  }, [currentView]);

  useEffect(() => {
    localStorage.setItem("tracelabel-config-tab", configTab);
  }, [configTab]);
  const [dbStatus, setDbStatus] = useState<{ dbType: string; dbUrl: string }>({
    dbType: "local-sqlite",
    dbUrl: "file:local.db",
  });

  // Label Formating State
  const [labelFormats, setLabelFormats] = useState<LabelFormat[]>([
    {
      id: "default",
      name: "Estándar 50x25mm (1 Col)",
      width: 50,
      height: 25,
      dpi: 203,
      darkness: 15,
      printSpeed: 3,
      orientation: "N",
      marginTop: 2,
      marginBottom: 2,
      marginLeft: 2,
      marginRight: 2,
      labelsPerRow: 1,
      labelsPerColumn: 1,
      horizontalGap: 2,
      verticalGap: 2,
      showName: true,
      showSku: true,
      showEan13: true,
      showDun14: true,
    },
  ]);

  const [activeFormatId, setActiveFormatId] = useState<string>("default");

  const labelFormat =
    labelFormats.find((f) => f.id === activeFormatId) || labelFormats[0];

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const updateCurrentFormat = (updates: Partial<LabelFormat>) => {
    const formatToUpdate = labelFormats.find((f) => f.id === activeFormatId);
    if (!formatToUpdate) return;
    const updatedFormat = { ...formatToUpdate, ...updates };

    setLabelFormats((prev) =>
      prev.map((f) => (f.id === activeFormatId ? updatedFormat : f)),
    );
    setHasUnsavedChanges(true);
  };

  const saveCurrentFormat = async () => {
    const formatToUpdate = labelFormats.find((f) => f.id === activeFormatId);
    if (!formatToUpdate) return;
    try {
      await fetch(`/api/label-formats/${activeFormatId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formatToUpdate),
      });
      setHasUnsavedChanges(false);
      showToast("Formato guardado exitosamente", "success");
    } catch (e) {
      console.error("Failed to update format saving database", e);
      showToast("Error al guardar formato en la base de datos", "error");
    }
  };

  const createNewFormat = async () => {
    const newId = Date.now().toString();
    const newFormat: LabelFormat = {
      id: newId,
      name: `Nuevo Formato`,
      width: 50,
      height: 25,
      dpi: 203,
      darkness: 15,
      printSpeed: 3,
      orientation: "N",
      marginTop: 2,
      marginBottom: 2,
      marginLeft: 2,
      marginRight: 2,
      labelsPerRow: 1,
      labelsPerColumn: 1,
      horizontalGap: 2,
      verticalGap: 2,
      showName: true,
      showSku: true,
      showEan13: true,
      showDun14: true,
    };

    setLabelFormats([...labelFormats, newFormat]);
    setActiveFormatId(newId);
    setHasUnsavedChanges(false);

    try {
      await fetch("/api/label-formats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newFormat),
      });
      showToast("Nuevo formato creado", "success");
    } catch (e) {
      console.error(e);
      showToast("Error al crear formato en la base de datos", "error");
    }
  };

  const deleteCurrentFormat = async () => {
    if (labelFormats.length <= 1) {
      showToast("No puedes eliminar el último formato.", "error");
      return;
    }
    const filtered = labelFormats.filter((f) => f.id !== activeFormatId);
    setLabelFormats(filtered);
    setActiveFormatId(filtered[0].id);

    try {
      await fetch(`/api/label-formats/${activeFormatId}`, {
        method: "DELETE",
      });
      showToast("Formato eliminado", "success");
    } catch (e) {
      console.error(e);
    }
  };

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  // Modals state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | undefined>();
  const [printingProduct, setPrintingProduct] = useState<Product | undefined>();
  const [tracePrintingProduct, setTracePrintingProduct] = useState<Product | undefined>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tiposEmpaque, setTiposEmpaque] = useState<TipoEmpaqueSecundario[]>([]);
  const [tiposEnvasePrimario, setTiposEnvasePrimario] = useState<TipoEnvasePrimario[]>([]);
  const [tiposTapa, setTiposTapa] = useState<TipoTapa[]>([]);

  // Inline editing states for packaging types
  const [editingEnvasePrimarioId, setEditingEnvasePrimarioId] = useState<number | null>(null);
  const [editingEnvasePrimarioCode, setEditingEnvasePrimarioCode] = useState<string>("");
  const [editingEnvasePrimarioName, setEditingEnvasePrimarioName] = useState<string>("");
  const [editingEnvaseSecundarioId, setEditingEnvaseSecundarioId] = useState<number | null>(null);
  const [editingEnvaseSecundarioName, setEditingEnvaseSecundarioName] = useState<string>("");
  const [editingEnvaseSecundarioGrupal, setEditingEnvaseSecundarioGrupal] = useState<boolean>(false);

  // Tapas states
  const [editingTapaId, setEditingTapaId] = useState<number | null>(null);
  const [editingTapaCode, setEditingTapaCode] = useState<string>("");
  const [editingTapaName, setEditingTapaName] = useState<string>("");
  const [tapaSearch, setTapaSearch] = useState<string>("");
  const [tapaSort, setTapaSort] = useState<{ column: 'codigo' | 'nombre'; direction: 'asc' | 'desc' }>({ column: 'nombre', direction: 'asc' });

  const [envasePrimarioSearch, setEnvasePrimarioSearch] = useState<string>("");
  const [envasePrimarioSort, setEnvasePrimarioSort] = useState<{ column: 'codigo' | 'nombre'; direction: 'asc' | 'desc' }>({ column: 'nombre', direction: 'asc' });

  const fetchTiposEmpaque = async () => {
    try {
      const res = await fetch("/api/tipos-empaque-secundario");
      if (res.ok) {
        const data = await res.json();
        setTiposEmpaque(data);
      }
    } catch (err) {
      console.error("Error fetching tipos empaque:", err);
    }
  };

  const fetchTiposEnvasePrimario = async () => {
    try {
      const res = await fetch("/api/tipos-envase-primario");
      if (res.ok) {
        const data = await res.json();
        setTiposEnvasePrimario(data);
      }
    } catch (err) {
      console.error("Error fetching tipos envase primario:", err);
    }
  };

  const fetchTiposTapa = async () => {
    try {
      const res = await fetch("/api/tipos-tapa");
      if (res.ok) {
        const data = await res.json();
        setTiposTapa(data);
      }
    } catch (err) {
      console.error("Error fetching tipos tapa:", err);
    }
  };

  useEffect(() => {
    fetchProducts();
    fetchConfig();
    fetchLabelFormats();
    fetchTiposEmpaque();
    fetchTiposEnvasePrimario();
    fetchTiposTapa();
  }, []);

  // Auto-refresh every 30s for real-time sync between PCs
  useEffect(() => {
    const interval = setInterval(() => {
      fetchProducts();
      fetchLabelFormats();
      fetchConfig();
      fetchTiposEmpaque();
      fetchTiposEnvasePrimario();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchLabelFormats = async () => {
    try {
      const res = await fetch("/api/label-formats");
      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0) {
          setLabelFormats(data);
          // Only set active to first if it's not already in the list
          if (!data.find((f: any) => f.id === activeFormatId)) {
            setActiveFormatId(data[0].id);
          }
        }
      }
    } catch (e) {}
  };

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/config");
      if (res.ok) {
        setDbStatus(await res.json());
      }
    } catch (e) {}
  };



  const fetchProducts = async () => {
    try {
      const res = await fetch("/api/products");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setProducts(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProduct = async (productData: Omit<Product, "id">) => {
    const isEdit = !!editingProduct;
    const url = isEdit ? `/api/products/${editingProduct.id}` : "/api/products";
    const method = isEdit ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(productData),
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Error saving product");
    }

    fetchProducts();
  };

  const handleDelete = async (id: number) => {
    if (!confirm("¿Estás seguro de eliminar este producto?")) return;
    try {
      const res = await fetch(`/api/products/${id}`, { method: "DELETE" });
      if (res.ok) {
        setProducts((p) => p.filter((prod) => prod.id !== id));
        showToast("Producto eliminado", "success");
      }
    } catch (error) {
      console.error(error);
      showToast("Error eliminando producto", "error");
    }
  };

  const processImportedData = async (rows: any[]) => {
    setImporting(true);

    const normalizedRows = rows.map((r) => {
      const normalizedMap: Record<string, any> = {};
      Object.keys(r).forEach((k) => {
        // Strip spaces, underscores, and make uppercase for easier matching
        const cleanKey = k.trim().replace(/[_ ]/g, "").toUpperCase();
        normalizedMap[cleanKey] = r[k];
      });
      return normalizedMap;
    });

    const formattedProducts = normalizedRows
      .map((r, index) => {
        return {
          sku: (
            r["SKU"] ||
            r["SKUPRC"] ||
            r["SKUPROV"] ||
            r["ID"] ||
            r["CODIGO"] ||
            r["COD"] ||
            r["ARTICULO"] ||
            ""
          )
            .toString()
            .trim(),
          item_name: (
            r["ITEMNAME"] ||
            r["DESCRIPCION"] ||
            r["NOMBRE"] ||
            r["PRODUCTO"] ||
            r["DETALLE"] ||
            ""
          )
            .toString()
            .trim(),
          ean13: (
            r["EAN13"] ||
            r["EAN"] ||
            r["CODDEBARRA"] ||
            r["BARRAS"] ||
            ""
          )
            .toString()
            .trim(),
          dun14: (r["DUN14"] || r["DUN"] || r["DUN14CAJA"] || "")
            .toString()
            .trim(),
          marca: (r["MARCA"] || "").toString().trim().toUpperCase(),
          isp: (r["ISP"] || r["CODIGOISP"] || "").toString().trim(),
          caducidad: r["CADUCIDAD"] ? parseInt(r["CADUCIDAD"].toString().trim(), 10) : undefined,
          activo: r["ACTIVO"] !== undefined ? (String(r["ACTIVO"]).toUpperCase() === 'NO' || String(r["ACTIVO"]).toUpperCase() === 'FALSO' || String(r["ACTIVO"]) === '0' || String(r["ACTIVO"]).toUpperCase() === 'INACTIVO' ? false : true) : true,
          business_line: (r["LINEADENEGOCIO"] || r["LINEA"] || r["NEGOCIO"] || "").toString().trim(),
          family: (r["FAMILIA"] || r["CATEGORIA"] || "").toString().trim(),
        };
      })
      .filter((p) => p.sku && p.item_name);

    if (formattedProducts.length === 0) {
      const foundCols =
        normalizedRows.length > 0
          ? Object.keys(normalizedRows[0]).join(", ")
          : "Ninguna";
      showToast(
        `No se detectaron columnas válidas. Encontramos: [${foundCols}]. Verifica tu archivo.`,
        "error",
      );
      setImporting(false);
      return;
    }

    try {
      const res = await fetch("/api/products/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ products: formattedProducts }),
      });
      if (res.ok) {
        showToast(
          `¡Se importaron ${formattedProducts.length} productos correctamente!`,
          "success",
        );
        fetchProducts();
      } else {
        const data = await res.json();
        showToast("Error importando: " + data.error, "error");
      }
    } catch (error) {
      console.error(error);
      showToast("Error de conexión al importar batch.", "error");
    } finally {
      setImporting(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      // 10MB sanity check
      showToast("El archivo es demasiado grande.", "error");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const fileExt = file.name.split(".").pop()?.toLowerCase();

    if (fileExt === "csv") {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
          processImportedData(results.data as any[]);
        },
      });
    } else {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = evt.target?.result;
          const wb = XLSX.read(data, { type: "array" });
          const wsname = wb.SheetNames[0];
          const ws = wb.Sheets[wsname];
          const jsonData = XLSX.utils.sheet_to_json(ws);
          processImportedData(jsonData);
        } catch (error) {
          console.error("Error reading Excel", error);
          showToast(
            "Error al leer el archivo Excel. Asegúrate de que el formato sea válido.",
            "error",
          );
        }
      };
      reader.readAsArrayBuffer(file);
    }

    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const triggerFileUpload = () => {
    fileInputRef.current?.click();
  };



  const businessLines = Array.from(new Set(products.map(p => p.business_line).filter(Boolean))).sort((a: any, b: any) => a.localeCompare(b)) as string[];
  const families = Array.from(new Set(
    products
      .filter(p => filterBusinessLine === "" || p.business_line === filterBusinessLine)
      .map(p => p.family)
      .filter(Boolean)
  )).sort((a: any, b: any) => a.localeCompare(b)) as string[];

  const marcas = Array.from(new Set(
    products
      .filter(p => filterBusinessLine === "" || p.business_line === filterBusinessLine)
      .filter(p => filterFamily === "" || p.family === filterFamily)
      .map(p => p.marca)
      .filter(Boolean)
  )).sort((a: any, b: any) => a.localeCompare(b)) as string[];

  const formatos = Array.from(new Set(
    products
      .filter(p => filterBusinessLine === "" || p.business_line === filterBusinessLine)
      .filter(p => filterFamily === "" || p.family === filterFamily)
      .filter(p => filterMarca === "" || p.marca === filterMarca)
      .map(p => p.formato)
      .filter(Boolean)
  )).sort((a: any, b: any) => a.localeCompare(b)) as string[];

  const filteredProducts = products.filter(
    (p) => {
      const matchBusinessLine = filterBusinessLine === "" || p.business_line === filterBusinessLine;
      const matchFamily = filterFamily === "" || p.family === filterFamily;
      const matchMarca = filterMarca === "" || p.marca === filterMarca;
      const matchFormato = filterFormato === "" || p.formato === filterFormato;
      
      let matchStatus = true;
      if (filterStatus === "activo") matchStatus = p.activo !== false; // handle true or undefined
      if (filterStatus === "inactivo") matchStatus = p.activo === false;

      const matchSearch = p.sku.toLowerCase().includes(search.toLowerCase()) ||
        p.item_name.toLowerCase().includes(search.toLowerCase()) ||
        (p.business_line && p.business_line.toLowerCase().includes(search.toLowerCase())) ||
        (p.family && p.family.toLowerCase().includes(search.toLowerCase())) ||
        (p.marca && p.marca.toLowerCase().includes(search.toLowerCase())) ||
        (p.formato && p.formato.toLowerCase().includes(search.toLowerCase()));

      return matchBusinessLine && matchFamily && matchMarca && matchFormato && matchStatus && matchSearch;
    }
  );

  const columnsConfig: Record<string, {
    label: string;
    minWidth?: string;
    className?: string;
    sortable: boolean;
    getValue: (p: Product) => any;
    render: (p: Product) => React.ReactNode;
  }> = {
    sku: {
      label: 'SKU',
      minWidth: '90px',
      sortable: true,
      getValue: (p) => p.sku,
      render: (p) => <td className="px-3 py-3.5 whitespace-nowrap text-sm font-bold text-slate-900">{p.sku}</td>
    },
    item_name: {
      label: 'Nombre',
      minWidth: '250px',
      sortable: true,
      getValue: (p) => p.item_name,
      render: (p) => (
        <td className="px-3 py-3.5 text-sm font-medium text-slate-800 min-w-[250px]" title={p.item_name}>
          <div className="line-clamp-2 break-words leading-relaxed">{p.item_name}</div>
        </td>
      )
    },
    ean13: {
      label: 'EAN-13',
      minWidth: '130px',
      sortable: true,
      getValue: (p) => p.ean13,
      render: (p) => (
        <td className="px-3 py-3.5 whitespace-nowrap">
          {p.ean13 ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">{p.ean13}</span>
          ) : (
            <span className="text-xs text-slate-400 font-mono">-</span>
          )}
        </td>
      )
    },
    dun14: {
      label: 'DUN-14',
      minWidth: '140px',
      sortable: true,
      getValue: (p) => p.dun14,
      render: (p) => (
        <td className="px-3 py-3.5 whitespace-nowrap">
          {p.dun14 ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">{p.dun14}</span>
          ) : (
            <span className="text-xs text-slate-400 font-mono">-</span>
          )}
        </td>
      )
    },
    isp: {
      label: 'ISP',
      minWidth: '90px',
      sortable: true,
      getValue: (p) => p.isp,
      render: (p) => <td className="px-3 py-3.5 whitespace-nowrap text-xs text-slate-600 font-mono" translate="no">{p.isp || "-"}</td>
    },
    marca: {
      label: 'Marca',
      minWidth: '110px',
      sortable: true,
      getValue: (p) => p.marca,
      render: (p) => <td className="px-3 py-3.5 text-xs text-slate-600 font-medium">{p.marca || "-"}</td>
    },
    caducidad: {
      label: 'Cad.',
      minWidth: '80px',
      sortable: true,
      getValue: (p) => p.caducidad,
      render: (p) => <td className="px-3 py-3.5 whitespace-nowrap text-xs text-slate-600 font-mono font-medium">{p.caducidad !== undefined && p.caducidad !== null ? `${p.caducidad}d` : "-"}</td>
    },
    envase_primario_tipo: {
      label: 'Env. Pri.',
      minWidth: '90px',
      sortable: true,
      getValue: (p) => {
        const val = p.envase_primario_tipo || 'BOTELLA';
        const found = tiposEnvasePrimario.find(t => t.nombre === val);
        return found && found.codigo ? `${found.codigo} ${found.nombre}` : val;
      },
      render: (p) => {
        const val = p.envase_primario_tipo || 'BOTELLA';
        const found = tiposEnvasePrimario.find(t => t.nombre === val);
        const displayVal = found && found.codigo ? `${found.codigo} ${found.nombre}` : val;
        return (
          <td className="px-3 py-3.5 whitespace-nowrap">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-800 border border-blue-200">
              {displayVal}
            </span>
          </td>
        );
      }
    },
    envase_secundario_tipo: {
      label: 'Env. Sec.',
      minWidth: '90px',
      sortable: true,
      getValue: (p) => p.envase_secundario_tipo || (p.envase_secundario_default || p.termocontraible_default ? 'TERMOCONTRAIBLE' : 'NO APLICA'),
      render: (p) => (
        <td className="px-3 py-3.5 whitespace-nowrap">
          {p.envase_secundario_tipo && p.envase_secundario_tipo !== 'NO APLICA' ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-800 border border-purple-200">
              {p.envase_secundario_tipo}
            </span>
          ) : (p.envase_secundario_default || p.termocontraible_default) ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-800 border border-purple-200">
              TERMOCONTRAIBLE
            </span>
          ) : (
            <span className="text-xs text-slate-400 font-mono">-</span>
          )}
        </td>
      )
    },
    tapa_tipo: {
      label: 'Tapa',
      minWidth: '90px',
      sortable: true,
      getValue: (p) => {
        const val = p.tapa_tipo;
        if (!val || val === 'NO APLICA' || val === '-') return '';
        const found = tiposTapa.find(t => t.nombre === val);
        return found && found.codigo ? `${found.codigo} ${found.nombre}` : val;
      },
      render: (p) => {
        const val = p.tapa_tipo;
        if (!val || val === 'NO APLICA' || val === '-') {
          return (
            <td className="px-3 py-3.5 whitespace-nowrap">
              <span className="text-xs text-slate-400 font-mono">-</span>
            </td>
          );
        }
        const found = tiposTapa.find(t => t.nombre === val);
        const displayVal = found && found.codigo ? `${found.codigo} ${found.nombre}` : val;
        return (
          <td className="px-3 py-3.5 whitespace-nowrap">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-violet-50 text-violet-800 border border-violet-200">
              {displayVal}
            </span>
          </td>
        );
      }
    },
    cant_grupal: {
      label: 'Cant. Grup.',
      minWidth: '100px',
      sortable: true,
      getValue: (p) => p.cant_grupal,
      render: (p) => <td className="px-3 py-3.5 whitespace-nowrap text-xs text-slate-600 font-mono font-semibold">{p.cant_grupal || 0}</td>
    },
    cant_individual: {
      label: 'Cant. Ind.',
      minWidth: '100px',
      sortable: true,
      getValue: (p) => p.cant_individual,
      render: (p) => <td className="px-3 py-3.5 whitespace-nowrap text-xs text-slate-600 font-mono font-semibold">{p.cant_individual || 0}</td>
    },
    formato: {
      label: 'Formato',
      minWidth: '100px',
      sortable: true,
      getValue: (p) => p.formato,
      render: (p) => <td className="px-3 py-3.5 whitespace-nowrap text-xs text-slate-600 font-medium">{p.formato || "-"}</td>
    },
    barras: {
      label: 'Barras',
      minWidth: '70px',
      sortable: false,
      getValue: () => '',
      render: (p) => (
        <td className="px-2 py-3.5 whitespace-nowrap text-center">
          <button onClick={() => setPrintingProduct(p)} title="Imprimir Código de Barras" className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors cursor-pointer">
            <Printer className="w-4 h-4" />
          </button>
        </td>
      )
    },
    trazab: {
      label: 'Trazab.',
      minWidth: '75px',
      sortable: false,
      getValue: () => '',
      render: (p) => (
        <td className="px-2 py-3.5 whitespace-nowrap text-center">
          <button onClick={() => setTracePrintingProduct(p)} title="Imprimir Trazabilidad" className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-md transition-colors cursor-pointer">
            <ClipboardList className="w-4 h-4" />
          </button>
        </td>
      )
    },
    editar: {
      label: 'Editar',
      minWidth: '70px',
      sortable: false,
      getValue: () => '',
      render: (p) => (
        <td className="px-2 py-3.5 whitespace-nowrap text-center">
          <button onClick={() => { setEditingProduct(p); setIsFormOpen(true); }} title="Editar" className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors cursor-pointer">
            <Edit className="w-4 h-4" />
          </button>
        </td>
      )
    },
    eliminar: {
      label: 'Eliminar',
      minWidth: '75px',
      sortable: false,
      getValue: () => '',
      render: (p) => (
        <td className="px-2 py-3.5 whitespace-nowrap text-center">
          <button onClick={() => handleDelete(p.id!)} title="Eliminar" className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors cursor-pointer">
            <Trash2 className="w-4 h-4" />
          </button>
        </td>
      )
    }
  };

  const visibleColumns = useMemo(() => {
    return columnOrder.filter((colId) => !hiddenColumns.includes(colId));
  }, [columnOrder, hiddenColumns]);

  const sortedProducts = useMemo(() => {
    if (!sortColumn) return filteredProducts;
    const col = columnsConfig[sortColumn];
    if (!col || !col.sortable) return filteredProducts;

    const sorted = [...filteredProducts];
    sorted.sort((a, b) => {
      const valA = col.getValue(a);
      const valB = col.getValue(b);

      const isEmptyA = valA === undefined || valA === null || valA === "";
      const isEmptyB = valB === undefined || valB === null || valB === "";

      if (isEmptyA && isEmptyB) return 0;
      if (isEmptyA) return 1; // Always send empty values to the bottom
      if (isEmptyB) return -1;

      // Numeric comparison
      if (typeof valA === "number" && typeof valB === "number") {
        return sortDirection === "asc" ? valA - valB : valB - valA;
      }

      // Default string comparison
      const strA = String(valA).toLowerCase();
      const strB = String(valB).toLowerCase();
      return sortDirection === "asc"
        ? strA.localeCompare(strB)
        : strB.localeCompare(strA);
    });

    return sorted;
  }, [filteredProducts, sortColumn, sortDirection]);

  const totalPages = Math.ceil(sortedProducts.length / ITEMS_PER_PAGE) || 1;
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedProducts = useMemo(() => {
    return sortedProducts.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [sortedProducts, currentPage, startIndex]);

  return (
    <div className={`flex h-screen bg-slate-100 text-slate-700 font-sans overflow-hidden app-theme-${theme}`}>
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-white flex flex-col flex-shrink-0">
        <div className="p-5 border-b border-slate-800 flex flex-col items-center gap-2 bg-slate-950/40">
          <img 
            src="/aquaops-logo.png" 
            alt="AquaOps Logo" 
            className="w-16 h-16 object-contain" 
          />
          <div className="text-center">
            <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent font-extrabold tracking-widest text-lg block">
              AquaOps
            </span>
            <span className="text-[9px] text-slate-500 tracking-wider uppercase font-medium block -mt-0.5">
              Production Operations
            </span>
          </div>
        </div>
        <nav className="flex-1 mt-4 space-y-1">
          <div
            onClick={() => setCurrentView("maestro")}
            className={`px-6 py-3 flex items-center gap-3 cursor-pointer text-sm font-medium transition-colors ${currentView === "maestro" ? "bg-blue-600 text-white" : "hover:bg-slate-800 text-slate-300"}`}
          >
            <Package className="w-4 h-4" />
            Códigos y Trazabilidad
          </div>
          <div
            onClick={() => setCurrentView("disenador")}
            className={`px-6 py-3 flex items-center gap-3 cursor-pointer text-sm font-medium transition-colors ${currentView === "disenador" ? "bg-blue-600 text-white" : "hover:bg-slate-800 text-slate-300"}`}
          >
            <PenTool className="w-4 h-4" />
            Diseñador de Etiquetas
          </div>
          <div
            onClick={() => setCurrentView("formatos")}
            className={`px-6 py-3 flex items-center gap-3 cursor-pointer text-sm font-medium transition-colors ${currentView === "formatos" ? "bg-blue-600 text-white" : "hover:bg-slate-800 text-slate-300"}`}
          >
            <Tag className="w-4 h-4" />
            Formatos de Etiqueta
          </div>
          <div
            onClick={() => setCurrentView("historial")}
            className={`px-6 py-3 flex items-center gap-3 cursor-pointer text-sm font-medium transition-colors ${currentView === "historial" ? "bg-blue-600 text-white" : "hover:bg-slate-800 text-slate-300"}`}
          >
            <FileText className="w-4 h-4" />
            Historial de Impresión
          </div>
          <div
            onClick={() => setCurrentView("planificacion")}
            className={`px-6 py-3 flex items-center gap-3 cursor-pointer text-sm font-medium transition-colors ${currentView === "planificacion" ? "bg-blue-600 text-white" : "hover:bg-slate-800 text-slate-300"}`}
          >
            <Calendar className="w-4 h-4" />
            Planificación
          </div>
          <div
            onClick={() => setCurrentView("configuracion")}
            className={`px-6 py-3 flex items-center gap-3 cursor-pointer text-sm font-medium transition-colors ${currentView === "configuracion" ? "bg-blue-600 text-white" : "hover:bg-slate-800 text-slate-300"}`}
          >
            <Settings className="w-4 h-4" />
            Configuración
          </div>
        </nav>

        {/* DB Connection Status */}
        <div className="p-6 border-t border-slate-800">
          <div className="text-[10px] text-slate-500 break-all leading-tight">
            {dbStatus.dbType === "turso-cloud" ? "☁️ Nube" : "💾 Local"}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50">
        {/* Top Header */}
        <header className="bg-white border-b border-slate-200 h-16 flex items-center justify-between px-8 flex-shrink-0">
          <div>
            <h1 className="text-lg font-bold text-slate-800 tracking-tight">
              {currentView === "maestro" ? "Códigos y Trazabilidad"
                : currentView === "formatos" ? "Formatos de Etiqueta"
                : currentView === "disenador" ? "Diseñador de Etiquetas"
                : currentView === "historial" ? "Historial de Impresión"
                : currentView === "planificacion" ? "Planificación de Producción"
                : "Configuración"}
            </h1>
            <p className="text-xs text-slate-500">
              {currentView === "maestro" ? "Gestión de SKU, códigos GS1 y etiquetas de trazabilidad"
                : currentView === "formatos" ? "Configuración de etiquetas ZPL"
                : currentView === "disenador" ? "Crea etiquetas personalizadas con texto libre"
                : currentView === "historial" ? "Registro de impresiones enviadas"
                : currentView === "planificacion" ? "Asigna productos y programa la producción diaria"
                : "Configuración del sistema"}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1 bg-slate-700/10 p-0.5 rounded-lg border border-slate-200 mr-2">
              {(['dark', 'light', 'glass'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setTheme(t);
                    localStorage.setItem('tracelabel-theme', t);
                  }}
                  className={`px-2 py-1 rounded text-[10px] font-bold uppercase transition-all cursor-pointer ${
                    theme === t
                      ? 'bg-blue-600 text-white shadow'
                      : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'
                  }`}
                >
                  {t === 'glass' ? 'Vidrio' : t === 'dark' ? 'Oscuro' : 'Claro'}
                </button>
              ))}
            </div>
            {dbStatus.dbType === "turso-cloud" ? (
              <div className="flex items-center gap-2 bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-full text-xs font-semibold border border-emerald-200">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                ☁️ Base de datos en la nube
              </div>
            ) : (
              <div
                className="flex items-center gap-2 bg-amber-50 text-amber-700 px-3 py-1.5 rounded-full text-xs font-semibold border border-amber-200"
                title="Base de datos local"
              >
                <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                Base de datos Local
              </div>
            )}
          </div>
        </header>

        {/* Scrollable Content */}
        <div className={`flex-1 overflow-auto ${currentView === "disenador" ? "" : "p-4 sm:p-8"}`}>
          <div className={currentView === "disenador" ? "h-full" : "w-full max-w-[1600px] mx-auto space-y-6"}>
            {currentView === "maestro" && (
              <>
                {/* Header Summary & Actions */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                  <div>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-800">
                      Mantenedor de Productos y Códigos
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                      Gestiona SKUs, genera códigos de barra (EAN13, DUN14) e
                      imprime vía ZPL.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                    <label htmlFor="file-upload" className="sr-only">Importar CSV/Excel</label>
                    <input
                      id="file-upload"
                      aria-label="Importar CSV/Excel"
                      type="file"
                      accept=".csv, .xlsx, .xls, .xlxs, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                      className="hidden"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                    />
                    <button
                      onClick={triggerFileUpload}
                      disabled={importing}
                      className="flex-1 md:flex-none items-center justify-center px-4 py-2 border border-slate-300 shadow-sm text-sm font-medium rounded-md text-slate-800 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors inline-flex disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {importing ? (
                        <>
                          <div className="w-4 h-4 mr-2 rounded-full border-2 border-slate-400 border-t-transparent animate-spin"></div>
                          Importando...
                        </>
                      ) : (
                        <>
                          <Upload className="w-4 h-4 mr-2 text-slate-400" />
                          Importar CSV / Excel
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => {
                        setEditingProduct(undefined);
                        setIsFormOpen(true);
                      }}
                      className="flex-1 md:flex-none items-center justify-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-500 hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors inline-flex"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Nuevo Producto
                    </button>
                  </div>
                </div>

                {/* Stats Summary */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold tracking-wide text-slate-500 uppercase">Total Productos</p>
                      <p className="text-3xl font-bold text-slate-800 mt-1">{products.length}</p>
                    </div>
                    <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
                      <Package className="w-8 h-8" />
                    </div>
                  </div>
                  <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold tracking-wide text-slate-500 uppercase">Productos Filtrados</p>
                      <p className="text-3xl font-bold text-slate-800 mt-1">{filteredProducts.length}</p>
                    </div>
                    <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
                      <Filter className="w-8 h-8" />
                    </div>
                  </div>
                </div>

                {/* Search and Filters */}
                <div className="flex flex-col md:flex-row gap-4">
                  <div className="relative flex-1 md:max-w-[280px]">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Search className="h-5 w-5 text-slate-400" />
                    </div>
                    <label htmlFor="filter-search" className="sr-only">Buscar producto</label>
                    <input
                      id="filter-search"
                      aria-label="Buscar producto"
                      type="text"
                      placeholder="Buscar por SKU, nombre o marca..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="block w-full pl-10 pr-3 py-3 border border-slate-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm bg-white text-slate-800"
                    />
                  </div>

                  {/* Filter: Línea de Negocio */}
                  {businessLines.length > 0 && (
                    <div className="md:w-48">
                      <label htmlFor="filter-business-line" className="sr-only">Línea de Negocio</label>
                      <select
                        id="filter-business-line"
                        aria-label="Filtrar por línea de negocio"
                        value={filterBusinessLine}
                        onChange={(e) => {
                          setFilterBusinessLine(e.target.value);
                          setFilterFamily("");
                          setFilterMarca("");
                          setFilterFormato("");
                        }}
                        className="block w-full py-3 px-3 border border-slate-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm bg-white text-slate-800"
                      >
                        <option value="">Línea de Negocio (Todas)</option>
                        {businessLines.map((bl) => (
                          <option key={bl} value={bl}>
                            {bl}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Filter: Familia */}
                  {families.length > 0 && (
                    <div className="md:w-48">
                      <label htmlFor="filter-family" className="sr-only">Familia</label>
                      <select
                        id="filter-family"
                        aria-label="Filtrar por familia"
                        value={filterFamily}
                        onChange={(e) => {
                          setFilterFamily(e.target.value);
                          setFilterMarca("");
                          setFilterFormato("");
                        }}
                        className="block w-full py-3 px-3 border border-slate-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm bg-white text-slate-800"
                      >
                        <option value="">Familia (Todas)</option>
                        {families.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Filter: Marca */}
                  {marcas.length > 0 && (
                    <div className="md:w-48">
                      <label htmlFor="filter-marca" className="sr-only">Marca</label>
                      <select
                        id="filter-marca"
                        aria-label="Filtrar por marca"
                        value={filterMarca}
                        onChange={(e) => {
                          setFilterMarca(e.target.value);
                          setFilterFormato("");
                        }}
                        className="block w-full py-3 px-3 border border-slate-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm bg-white text-slate-800"
                      >
                        <option value="">Marca (Todas)</option>
                        {marcas.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Filter: Formato */}
                  {formatos.length > 0 && (
                    <div className="md:w-48">
                      <label htmlFor="filter-formato" className="sr-only">Formato</label>
                      <select
                        id="filter-formato"
                        aria-label="Filtrar por formato"
                        value={filterFormato}
                        onChange={(e) => setFilterFormato(e.target.value)}
                        className="block w-full py-3 px-3 border border-slate-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm bg-white text-slate-800"
                      >
                        <option value="">Formato (Todos)</option>
                        {formatos.map((form) => (
                          <option key={form} value={form}>
                            {form}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Filter: Status */}
                  <div className="md:w-40">
                    <label htmlFor="filter-status" className="sr-only">Estado</label>
                    <select
                      id="filter-status"
                      aria-label="Filtrar por estado"
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value)}
                      className="block w-full py-3 px-3 border border-slate-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm bg-white text-slate-800"
                    >
                      <option value="todos">Estado (Todos)</option>
                      <option value="activo">Activos</option>
                      <option value="inactivo">Inactivos</option>
                    </select>
                  </div>

                  {/* Column Visibility Selector */}
                  <div className="relative" ref={columnDropdownRef}>
                    <button
                      onClick={() => setIsColumnDropdownOpen(!isColumnDropdownOpen)}
                      className="flex items-center justify-center gap-2 py-3 px-4 border border-slate-300 rounded-lg shadow-sm bg-white text-slate-700 hover:bg-slate-50 transition-colors sm:text-sm font-semibold cursor-pointer h-full"
                      title="Configurar Columnas Visibles"
                    >
                      <Settings className="w-4 h-4 text-slate-500" />
                      <span>Columnas</span>
                    </button>
                    {isColumnDropdownOpen && (
                      <div className="absolute right-0 mt-2 w-56 rounded-lg shadow-lg bg-white border border-slate-200 z-50 py-2 max-h-80 overflow-y-auto">
                        <div className="px-3 py-1 text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 pb-2 mb-1">
                          Mostrar/Ocultar Columnas
                        </div>
                        {columnOrder.map((colId) => {
                          const col = columnsConfig[colId];
                          if (!col) return null;
                          const isHidden = hiddenColumns.includes(colId);
                          return (
                            <label
                              key={colId}
                              className="flex items-center px-3 py-1.5 hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer select-none"
                            >
                              <input
                                type="checkbox"
                                checked={!isHidden}
                                onChange={() => {
                                  setHiddenColumns(prev =>
                                    isHidden ? prev.filter(id => id !== colId) : [...prev, colId]
                                  );
                                }}
                                className="h-3.5 w-3.5 text-blue-600 focus:ring-blue-500 border-slate-300 rounded mr-2.5 cursor-pointer"
                              />
                              <span>{col.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Table Content */}
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col min-h-[400px]">
                  <div className="overflow-x-auto w-full">
                    <table className="w-full divide-y divide-slate-200" style={{ tableLayout: "fixed" }}>
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          {visibleColumns.map((colId) => {
                            const col = columnsConfig[colId];
                            if (!col) return null;

                            const isSorted = sortColumn === colId;
                            const isOver = dragOverColId === colId;
                            const borderClass = isOver
                              ? dragDirection === "left"
                                ? "border-l-4 border-blue-500"
                                : "border-r-4 border-blue-500"
                              : "";

                            // Disable native draggable if hovering the resize handle of ANY column
                            const isDraggable = !hoveredResizeCol;

                            return (
                              <th
                                key={colId}
                                scope="col"
                                draggable={isDraggable}
                                onDragStart={(e) => handleDragStart(e, colId)}
                                onDragOver={(e) => handleDragOver(e, colId)}
                                onDragEnd={handleDragEnd}
                                onDrop={(e) => handleDrop(e, colId)}
                                onClick={() => handleSort(colId)}
                                style={{ 
                                  width: columnWidths[colId] || defaultWidths[colId] || 100,
                                  minWidth: col.minWidth 
                                }}
                                className={`group relative px-3 py-3.5 text-xs font-bold text-slate-700 uppercase tracking-wider select-none transition-all duration-150 hover:bg-slate-100/85 ${borderClass} ${
                                  isDraggable ? "cursor-grab active:cursor-grabbing" : ""
                                } ${colId === "barras" || colId === "trazab" || colId === "editar" || colId === "eliminar" ? "text-center" : "text-left"}`}
                              >
                                <div className="flex items-center gap-1 justify-between pr-2">
                                  <span className="truncate" title={col.label}>{col.label}</span>
                                  {col.sortable && (
                                    <span className={`text-[10px] font-mono leading-none flex-shrink-0 ${isSorted ? "text-blue-600 font-bold" : "text-slate-300"}`}>
                                      {isSorted ? (sortDirection === "asc" ? "▲" : "▼") : "↕"}
                                    </span>
                                  )}
                                </div>

                                {/* Resize handle */}
                                <div
                                  draggable={false}
                                  onMouseDown={(e) => handleResizeStart(e, colId)}
                                  onMouseEnter={() => setHoveredResizeCol(colId)}
                                  onMouseLeave={() => setHoveredResizeCol(null)}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                  }}
                                  className={`absolute right-0 top-0 bottom-0 w-2 hover:bg-blue-500/30 active:bg-blue-600/50 cursor-col-resize select-none z-20 transition-colors ${
                                    hoveredResizeCol === colId ? "bg-blue-500/20" : ""
                                  }`}
                                />
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody className={`bg-white divide-y divide-slate-200 relative ${loading ? 'opacity-65 transition-opacity' : ''}`}>
                        {loading && products.length === 0 ? (
                          <tr>
                            <td
                              colSpan={visibleColumns.length}
                              className="px-3 py-8 text-center text-slate-500 font-medium"
                            >
                              <div className="flex justify-center items-center space-x-2">
                                <div className="w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin"></div>
                                <span>Cargando productos...</span>
                              </div>
                            </td>
                          </tr>
                        ) : paginatedProducts.length === 0 ? (
                          <tr>
                            <td
                              colSpan={visibleColumns.length}
                              className="px-3 py-8 text-center text-slate-500 font-medium bg-slate-50/50"
                            >
                              No se encontraron resultados. Intenta agregar un
                              nuevo producto o importar un CSV.
                            </td>
                          </tr>
                        ) : (
                          paginatedProducts.map((p) => (
                            <tr
                              key={p.id}
                              className="hover:bg-slate-50 transition-colors border-b border-slate-200"
                            >
                              {visibleColumns.map((colId) => {
                                const col = columnsConfig[colId];
                                if (!col) return null;
                                return <React.Fragment key={colId}>{col.render(p)}</React.Fragment>;
                              })}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="px-6 py-4 border-t bg-slate-50 border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <p className="text-xs text-slate-500 font-medium">
                      Mostrando <span className="font-bold text-slate-800">{sortedProducts.length > 0 ? startIndex + 1 : 0}</span> al <span className="font-bold text-slate-800">{Math.min(startIndex + ITEMS_PER_PAGE, sortedProducts.length)}</span> de <span className="font-bold text-slate-800">{sortedProducts.length}</span> productos
                    </p>
                    {totalPages > 1 && (
                      <nav className="inline-flex -space-x-px rounded-md shadow-sm bg-white border border-slate-200" aria-label="Paginación de productos">
                        <button
                          onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                          disabled={currentPage === 1}
                          className="relative inline-flex items-center rounded-l-md px-2 py-1.5 text-slate-400 hover:bg-slate-50 focus:z-20 disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer transition-colors"
                        >
                          <span className="sr-only">Anterior</span>
                          <ChevronLeft className="h-4 w-4" />
                        </button>
                        
                        {/* Page numbers */}
                        {Array.from({ length: totalPages }, (_, i) => i + 1)
                          .filter(page => page === 1 || page === totalPages || Math.abs(page - currentPage) <= 2)
                          .map((page, index, array) => {
                            const showEllipsisBefore = index > 0 && page - array[index - 1] > 1;
                            return (
                              <React.Fragment key={page}>
                                {showEllipsisBefore && (
                                  <span className="relative inline-flex items-center px-2 py-1.5 text-xs font-semibold text-slate-500">
                                    ...
                                  </span>
                                )}
                                <button
                                  onClick={() => setCurrentPage(page)}
                                  aria-current={currentPage === page ? "page" : undefined}
                                  className={`relative inline-flex items-center px-3 py-1.5 text-xs font-semibold focus:z-20 cursor-pointer transition-colors ${
                                    currentPage === page
                                      ? "z-10 bg-blue-600 text-white"
                                      : "text-slate-900 hover:bg-slate-50"
                                  }`}
                                >
                                  {page}
                                </button>
                              </React.Fragment>
                            );
                          })}

                        <button
                          onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                          disabled={currentPage === totalPages}
                          className="relative inline-flex items-center rounded-r-md px-2 py-1.5 text-slate-400 hover:bg-slate-50 focus:z-20 disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer transition-colors"
                        >
                          <span className="sr-only">Siguiente</span>
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </nav>
                    )}
                  </div>
                </div>
              </>
            )}



            {currentView === "formatos" && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col md:flex-row min-h-[600px]">
                {/* Left Sidebar - Formats List */}
                <div className="w-full md:w-64 lg:w-80 border-b md:border-b-0 md:border-r border-slate-200 bg-slate-50/50 flex flex-col">
                  <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-white">
                    <h2 className="text-lg font-bold text-slate-800">
                      Formatos (ZPL)
                    </h2>
                  </div>
                  <div className="p-3 border-b border-slate-200 bg-white">
                    <button
                      onClick={createNewFormat}
                      className="w-full flex items-center justify-center py-2 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Crear Nuevo Formato
                    </button>
                  </div>
                  <div className="overflow-y-auto flex-1 p-2 space-y-1">
                    {labelFormats.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => {
                          setActiveFormatId(f.id);
                          setHasUnsavedChanges(false);
                        }}
                        className={`w-full text-left px-3 py-3 rounded-lg text-sm transition-colors border ${activeFormatId === f.id ? "bg-blue-50 border-blue-200 text-blue-800 shadow-sm" : "border-transparent text-slate-700 hover:bg-slate-100 hover:text-slate-900"}`}
                      >
                        <div className="font-medium truncate">{f.name}</div>
                        <div className="text-xs opacity-70 mt-0.5">
                          {f.width}x{f.height} mm • {f.dpi} DPI
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Right Area - Editor */}
                <div className="flex-1 p-6 sm:p-8 bg-white overflow-y-auto">
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4 border-b border-slate-100 pb-4">
                    <div>
                      <h2 className="text-xl font-bold text-slate-800">
                        Configuración de Etiqueta
                      </h2>
                      <p className="text-sm text-slate-500 mt-1">
                        Ajusta los parámetros para generar el código ZPL
                        correctamente
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={deleteCurrentFormat}
                        className="px-3 py-1.5 text-red-600 hover:bg-red-50 border border-transparent hover:border-red-100 rounded text-sm font-medium transition-colors flex items-center"
                      >
                        <Trash2 className="w-4 h-4 mr-1.5" />
                        Eliminar
                      </button>
                      <button
                        onClick={saveCurrentFormat}
                        disabled={!hasUnsavedChanges}
                        className={`px-4 py-1.5 rounded text-sm font-medium transition-colors flex items-center ${hasUnsavedChanges ? "bg-blue-600 text-white hover:bg-blue-700 shadow-sm" : "bg-slate-100 text-slate-400 cursor-not-allowed"}`}
                      >
                        Guardar Cambios
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    {/* Preview Section - Left Side */}
                    <div className="lg:col-span-6 xl:col-span-5 2xl:col-span-6">
                      <div className="sticky top-6">
                        <LabelPreview format={labelFormat} onShowToast={showToast} />
                      </div>
                    </div>

                    {/* Settings Form Section - Right Side */}
                    <div className="lg:col-span-6 xl:col-span-7 2xl:col-span-6 grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-6">
                        <div>
                          <h3 className="text-md font-semibold text-slate-800 mb-4 border-b pb-2">
                            Nombre del Formato
                        </h3>
                        <label htmlFor="format-name" className="sr-only">Nombre del formato</label>
                        <input
                          id="format-name"
                          aria-label="Nombre del formato"
                          type="text"
                          className="w-full rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                          value={labelFormat.name}
                          onChange={(e) =>
                            updateCurrentFormat({ name: e.target.value })
                          }
                          placeholder="Ej: Etiqueta Chica 33x23mm"
                        />
                      </div>
                      <div>
                        <h3 className="text-md font-semibold text-slate-800 mb-4 border-b pb-2">
                          Dimensiones de la etiqueta
                        </h3>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label htmlFor="format-width" className="block text-xs font-medium text-slate-700 mb-1">
                              Ancho (mm)
                            </label>
                            <input
                              id="format-width"
                              aria-label="Ancho en mm"
                              type="number"
                              className="w-full rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                              value={labelFormat.width}
                              onChange={(e) =>
                                updateCurrentFormat({
                                  width: Number(e.target.value),
                                })
                              }
                            />
                          </div>
                          <div>
                            <label htmlFor="format-height" className="block text-xs font-medium text-slate-700 mb-1">
                              Alto (mm)
                            </label>
                            <input
                              id="format-height"
                              aria-label="Alto en mm"
                              type="number"
                              className="w-full rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                              value={labelFormat.height}
                              onChange={(e) =>
                                updateCurrentFormat({
                                  height: Number(e.target.value),
                                })
                              }
                            />
                          </div>
                        </div>
                      </div>

                      <div>
                        <h3 className="text-md font-semibold text-slate-800 mb-4 border-b pb-2">
                          Márgenes y Múltiples Columnas
                        </h3>
                        <div className="grid grid-cols-2 gap-4 mb-4">
                          <div>
                            <label htmlFor="format-margin-left" className="block text-xs font-medium text-slate-700 mb-1">
                              Margen Izquierdo (mm)
                            </label>
                            <input
                              id="format-margin-left"
                              aria-label="Margen izquierdo"
                              type="number"
                              className="w-full rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                              value={labelFormat.marginLeft}
                              onChange={(e) =>
                                updateCurrentFormat({
                                  marginLeft: Number(e.target.value),
                                })
                              }
                            />
                          </div>
                          <div>
                            <label htmlFor="format-margin-right" className="block text-xs font-medium text-slate-700 mb-1">
                              Margen Derecho (mm)
                            </label>
                            <input
                              id="format-margin-right"
                              aria-label="Margen derecho"
                              type="number"
                              className="w-full rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                              value={labelFormat.marginRight}
                              onChange={(e) =>
                                updateCurrentFormat({
                                  marginRight: Number(e.target.value),
                                })
                              }
                            />
                          </div>
                          <div>
                            <label htmlFor="format-margin-top" className="block text-xs font-medium text-slate-700 mb-1">
                              Margen Superior (mm)
                            </label>
                            <input
                              id="format-margin-top"
                              aria-label="Margen superior"
                              type="number"
                              className="w-full rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                              value={labelFormat.marginTop}
                              onChange={(e) =>
                                updateCurrentFormat({
                                  marginTop: Number(e.target.value),
                                })
                              }
                            />
                          </div>
                          <div>
                            <label htmlFor="format-margin-bottom" className="block text-xs font-medium text-slate-700 mb-1">
                              Margen Inferior (mm)
                            </label>
                            <input
                              id="format-margin-bottom"
                              aria-label="Margen inferior"
                              type="number"
                              className="w-full rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                              value={labelFormat.marginBottom}
                              onChange={(e) =>
                                updateCurrentFormat({
                                  marginBottom: Number(e.target.value),
                                })
                              }
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label htmlFor="format-labels-row" className="block text-xs font-medium text-slate-700 mb-1">
                              Conteo Horizontal
                            </label>
                            <input
                              id="format-labels-row"
                              aria-label="Etiquetas por fila"
                              type="number"
                              min="1"
                              max="10"
                              className="w-full rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                              value={labelFormat.labelsPerRow}
                              onChange={(e) =>
                                updateCurrentFormat({
                                  labelsPerRow: Number(e.target.value),
                                })
                              }
                            />
                          </div>
                          <div>
                            <label htmlFor="format-h-gap" className="block text-xs font-medium text-slate-700 mb-1">
                              Espacio Horizontal (mm)
                            </label>
                            <input
                              id="format-h-gap"
                              aria-label="Separación horizontal"
                              type="number"
                              min="0"
                              step="0.5"
                              className="w-full rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                              value={labelFormat.horizontalGap}
                              onChange={(e) =>
                                updateCurrentFormat({
                                  horizontalGap: Number(e.target.value),
                                })
                              }
                            />
                          </div>
                          <div>
                            <label htmlFor="format-labels-col" className="block text-xs font-medium text-slate-700 mb-1">
                              Conteo Vertical
                            </label>
                            <input
                              id="format-labels-col"
                              aria-label="Etiquetas por columna"
                              type="number"
                              min="1"
                              max="10"
                              className="w-full rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                              value={labelFormat.labelsPerColumn}
                              onChange={(e) =>
                                updateCurrentFormat({
                                  labelsPerColumn: Number(e.target.value),
                                })
                              }
                            />
                          </div>
                          <div>
                            <label htmlFor="format-v-gap" className="block text-xs font-medium text-slate-700 mb-1">
                              Separación Vertical (mm)
                            </label>
                            <input
                              id="format-v-gap"
                              aria-label="Separación vertical"
                              type="number"
                              min="0"
                              step="0.5"
                              className="w-full rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                              value={labelFormat.verticalGap}
                              onChange={(e) =>
                                updateCurrentFormat({
                                  verticalGap: Number(e.target.value),
                                })
                              }
                            />
                          </div>
                        </div>
                      </div>

                      <div>
                        <h3 className="text-md font-semibold text-slate-800 mb-4 border-b pb-2">
                          Configuración de Impresión
                        </h3>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label htmlFor="format-dpi" className="block text-xs font-medium text-slate-700 mb-1">
                              DPI (Resolución)
                            </label>
                            <select
                              id="format-dpi"
                              aria-label="Resolución DPI"
                              className="w-full rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border bg-white"
                              value={labelFormat.dpi}
                              onChange={(e) =>
                                updateCurrentFormat({
                                  dpi: Number(e.target.value),
                                })
                              }
                            >
                              <option value={203}>
                                203 DPI (8 dots/mm) - Ej: GC420t
                              </option>
                              <option value={300}>300 DPI (12 dots/mm)</option>
                            </select>
                          </div>
                          <div>
                            <label htmlFor="format-darkness" className="block text-xs font-medium text-slate-700 mb-1">
                              Oscuridad (~SD)
                            </label>
                            <input
                              id="format-darkness"
                              aria-label="Oscuridad"
                              type="number"
                              min="0"
                              max="30"
                              className="w-full rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                              value={labelFormat.darkness}
                              onChange={(e) =>
                                updateCurrentFormat({
                                  darkness: Number(e.target.value),
                                })
                              }
                            />
                          </div>
                          <div>
                            <label htmlFor="format-speed" className="block text-xs font-medium text-slate-700 mb-1">
                              Velocidad (^PR)
                            </label>
                            <input
                              id="format-speed"
                              aria-label="Velocidad de impresión"
                              type="number"
                              min="1"
                              max="6"
                              className="w-full rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                              value={labelFormat.printSpeed}
                              onChange={(e) =>
                                updateCurrentFormat({
                                  printSpeed: Number(e.target.value),
                                })
                              }
                            />
                          </div>
                          <div>
                            <label htmlFor="format-orientation" className="block text-xs font-medium text-slate-700 mb-1">
                              Orientación
                            </label>
                            <select
                              id="format-orientation"
                              aria-label="Orientación"
                              className="w-full rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border bg-white"
                              value={labelFormat.orientation}
                              onChange={(e) =>
                                updateCurrentFormat({
                                  orientation: e.target.value as any,
                                })
                              }
                            >
                              <option value="N">Normal</option>
                              <option value="R">Rotado 90°</option>
                              <option value="I">Invertido 180°</option>
                              <option value="B">
                                De abajo hacia arriba 270°
                              </option>
                            </select>
                          </div>
                          <div>
                            <label htmlFor="format-h-shift" className="block text-xs font-medium text-slate-700 mb-1">
                              Ajuste Horizontal ^LS (mm)
                            </label>
                            <input
                              id="format-h-shift"
                              aria-label="Desplazamiento horizontal"
                              type="number"
                              step="0.5"
                              className="w-full rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                              value={labelFormat.labelShift || 0}
                              onChange={(e) =>
                                updateCurrentFormat({
                                  labelShift: Number(e.target.value),
                                })
                              }
                            />
                            <p className="text-[10px] text-slate-500 mt-1">negativo = izquierda</p>
                          </div>
                          <div>
                            <label htmlFor="format-v-shift" className="block text-xs font-medium text-slate-700 mb-1">
                              Ajuste Vertical ^LT (mm)
                            </label>
                            <input
                              id="format-v-shift"
                              aria-label="Desplazamiento vertical"
                              type="number"
                              step="0.5"
                              className="w-full rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                              value={labelFormat.labelTop || 0}
                              onChange={(e) =>
                                updateCurrentFormat({
                                  labelTop: Number(e.target.value),
                                })
                              }
                            />
                            <p className="text-[10px] text-slate-500 mt-1">negativo = arriba</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div>
                        <h3 className="text-md font-semibold text-slate-800 mb-4 border-b pb-2">
                          Variables a Imprimir
                        </h3>
                        <div className="space-y-3 bg-slate-50 p-4 rounded border border-slate-200">
                          <label className="flex items-center space-x-3">
                            <input
                              id="format-show-name"
                              aria-label="Mostrar nombre"
                              type="checkbox"
                              className="rounded text-blue-600 focus:ring-blue-500"
                              checked={labelFormat.showName}
                              onChange={(e) =>
                                updateCurrentFormat({
                                  showName: e.target.checked,
                                })
                              }
                            />
                            <span className="text-sm text-slate-700">
                              Nombre del Producto
                            </span>
                          </label>
                          <label className="flex items-center space-x-3">
                            <input
                              id="format-show-sku"
                              aria-label="Mostrar SKU"
                              type="checkbox"
                              className="rounded text-blue-600 focus:ring-blue-500"
                              checked={labelFormat.showSku}
                              onChange={(e) =>
                                updateCurrentFormat({
                                  showSku: e.target.checked,
                                })
                              }
                            />
                            <span className="text-sm text-slate-700">
                              SKU (Code 128)
                            </span>
                          </label>
                          <label className="flex items-center space-x-3">
                            <input
                              id="format-show-ean"
                              aria-label="Mostrar EAN-13"
                              type="checkbox"
                              className="rounded text-blue-600 focus:ring-blue-500"
                              checked={labelFormat.showEan13}
                              onChange={(e) =>
                                updateCurrentFormat({
                                  showEan13: e.target.checked,
                                })
                              }
                            />
                            <span className="text-sm text-slate-700">
                              EAN-13
                            </span>
                          </label>
                          <label className="flex items-center space-x-3">
                            <input
                              id="format-show-dun"
                              aria-label="Mostrar DUN-14"
                              type="checkbox"
                              className="rounded text-blue-600 focus:ring-blue-500"
                              checked={labelFormat.showDun14}
                              onChange={(e) =>
                                updateCurrentFormat({
                                  showDun14: e.target.checked,
                                })
                              }
                            />
                            <span className="text-sm text-slate-700">
                              DUN-14 / ITF-14
                            </span>
                          </label>
                        </div>
                      </div>

                      <div className="bg-blue-50 text-blue-800 p-4 rounded border border-blue-200 text-sm">
                        <strong>Nota:</strong> Haz clic en "Guardar Cambios"
                        para fijar esta configuración de etiqueta en la base de
                        datos.
                      </div>
                    </div>
                  </div>
                </div>
                </div>
              </div>
            )}

            {currentView === "disenador" && (
              <FreeLabelCreator
                labelFormats={labelFormats}
                onShowToast={showToast}
              />
            )}

            {currentView === "historial" && (
              <PrintHistory />
            )}

            {currentView === "configuracion" && (
              <div>
                {/* Tab bar */}
                <div className="flex border-b border-slate-200 mb-6 bg-white rounded-t-xl overflow-x-auto">
                  <button
                    onClick={() => setConfigTab("operadores")}
                    className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-colors border-b-2 cursor-pointer whitespace-nowrap ${
                      configTab === "operadores"
                        ? "border-blue-500 text-blue-600"
                        : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <Users className="w-4 h-4" />
                    <span>Operadores de Línea</span>
                  </button>
                  <button
                    onClick={() => setConfigTab("lineas")}
                    className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-colors border-b-2 cursor-pointer whitespace-nowrap ${
                      configTab === "lineas"
                        ? "border-blue-500 text-blue-600"
                        : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <Cpu className="w-4 h-4" />
                    <span>Líneas de Proceso</span>
                  </button>
                  <button
                    onClick={() => setConfigTab("whatsapp")}
                    className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-colors border-b-2 cursor-pointer whitespace-nowrap ${
                      configTab === "whatsapp"
                        ? "border-blue-500 text-blue-600"
                        : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <Send className="w-4 h-4" />
                    <span>WhatsApp Bot</span>
                  </button>
                  <button
                    onClick={() => setConfigTab("basedatos")}
                    className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-colors border-b-2 cursor-pointer whitespace-nowrap ${
                      configTab === "basedatos"
                        ? "border-blue-500 text-blue-600"
                        : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <Settings className="w-4 h-4" />
                    <span>Base de Datos</span>
                  </button>
                  <button
                    onClick={() => setConfigTab("impresoras")}
                    className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-colors border-b-2 cursor-pointer whitespace-nowrap ${
                      configTab === "impresoras"
                        ? "border-blue-500 text-blue-600"
                        : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <Printer className="w-4 h-4" />
                    <span>Impresoras</span>
                  </button>
                  <button
                    onClick={() => setConfigTab("empaques")}
                    className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-colors border-b-2 cursor-pointer whitespace-nowrap ${
                      configTab === "empaques"
                        ? "border-blue-500 text-blue-600"
                        : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <Tag className="w-4 h-4" />
                    <span>Envases</span>
                  </button>
                  <button
                    onClick={() => setConfigTab("instalacion")}
                    className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-colors border-b-2 cursor-pointer whitespace-nowrap ${
                      configTab === "instalacion"
                        ? "border-blue-500 text-blue-600"
                        : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <Monitor className="w-4 h-4" />
                    <span>Instalacion PC</span>
                  </button>
                  <button
                    onClick={() => setConfigTab("consola")}
                    className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-colors border-b-2 cursor-pointer whitespace-nowrap ${
                      configTab === "consola"
                        ? "border-blue-500 text-blue-600"
                        : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <Terminal className="w-4 h-4" />
                    <span>Consola</span>
                  </button>
                </div>

                {/* Operadores tab */}
                {configTab === "operadores" && (
                  <EmpleadosManager onShowToast={showToast} />
                )}

                {/* Líneas de Proceso tab */}
                {configTab === "lineas" && (
                  <LineasProcesoManager onShowToast={showToast} />
                )}

                {/* WhatsApp Bot tab */}
                {configTab === "whatsapp" && (
                  <WhatsAppConfigTab theme={theme} onShowToast={showToast} />
                )}

                {/* Base de Datos tab */}
                {configTab === "basedatos" && (
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 sm:p-8">
                    <h2 className="text-xl font-bold text-slate-800 mb-4">
                      Configuración de Base de Datos
                    </h2>
                    <div className="space-y-6">
                      <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                        <h3 className="text-sm font-semibold text-slate-800 mb-2">
                          Estado de la Conexión Actual
                        </h3>
                        <div className="flex items-center space-x-2 text-sm text-slate-600 mb-1">
                          <span className="font-medium w-32">Tipo db:</span>
                          <span>
                            {dbStatus.dbType === "turso-cloud"
                              ? "Base de datos en la nube"
                              : "Base de datos local"}
                          </span>
                        </div>
                        <div className="flex text-sm text-slate-600">
                          <span className="font-medium w-32 shrink-0">
                            URL / Archivo:
                          </span>
                          <span className="truncate break-all font-mono text-xs bg-white px-2 py-1 rounded border border-slate-200">
                            {dbStatus.dbUrl}
                          </span>
                        </div>
                      </div>
                      <p className="text-sm text-slate-500">
                        La conexión a la base de datos en la nube se configura
                        automáticamente durante el despliegue. Los datos se
                        sincronizan en tiempo real entre todos los computadores
                        conectados.
                      </p>
                    </div>
                  </div>
                )}

                {/* Impresoras tab */}
                {configTab === "impresoras" && (
                  <PrinterManager onShowToast={showToast} />
                )}

                {/* Instalación tab */}
                {configTab === "instalacion" && (
                  <div className="space-y-6">
                    {/* Header */}
                    <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-xl p-6 text-white">
                      <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
                        <Monitor className="w-6 h-6" /> Instalar en otro computador
                      </h2>
                      <p className="text-blue-100 text-sm">
                        Instala AquaOps Bridge en cualquier PC con impresora de etiquetas. Los datos se sincronizan automáticamente vía la nube.
                      </p>
                    </div>

                    {/* Cloud URL */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                      <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                        <Globe className="w-4 h-4 text-blue-500" /> Acceso Web (solo consulta, sin impresión)
                      </h3>
                      <div className="flex items-center gap-3">
                        <code className="flex-1 bg-slate-50 px-4 py-2.5 rounded-lg border border-slate-200 text-sm text-blue-600 font-medium">
                          https://etiquetas-aguacol-684852789183.us-central1.run.app
                        </code>
                        <button
                          onClick={() => { navigator.clipboard.writeText('https://etiquetas-aguacol-684852789183.us-central1.run.app'); showToast('URL copiada', 'success'); }}
                          className="px-3 py-2.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600 transition-colors cursor-pointer"
                          title="Copiar URL"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                      <p className="text-xs text-slate-400 mt-2">⚠️ Desde la nube puedes ver datos pero NO imprimir. Para imprimir necesitas seguir los pasos de abajo.</p>
                    </div>

                    {/* Steps */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                      <h3 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
                        <Download className="w-4 h-4 text-emerald-500" /> Pasos para instalar (con impresión)
                      </h3>

                      <div className="space-y-5">
                        {/* Step 1 */}
                        <div className="flex gap-4">
                          <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-sm flex-shrink-0">1</div>
                          <div className="flex-1">
                            <h4 className="font-semibold text-slate-800 text-sm">Instalar Node.js</h4>
                            <p className="text-xs text-slate-500 mb-2">Descarga e instala Node.js (LTS). Siguiente → Siguiente → Finalizar. <strong>Reiniciar el PC después de instalar.</strong></p>
                            <button
                              onClick={async () => {
                                try {
                                  showToast('Obteniendo última versión LTS...', 'success');
                                  const res = await fetch('https://nodejs.org/dist/index.json');
                                  const versions = await res.json();
                                  const lts = versions.find((v: any) => v.lts);
                                  if (lts) {
                                    const ver = lts.version;
                                    const url = `https://nodejs.org/dist/${ver}/node-${ver}-x64.msi`;
                                    window.open(url, '_blank');
                                    showToast(`Descargando Node.js ${ver}`, 'success');
                                  } else {
                                    window.open('https://nodejs.org/en/download/', '_blank');
                                  }
                                } catch {
                                  window.open('https://nodejs.org/en/download/', '_blank');
                                }
                              }}
                              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer"
                            >
                              <Download className="w-4 h-4" /> Descargar Node.js (.msi Windows)
                            </button>
                          </div>
                        </div>

                        {/* Step 2 - Single BAT with embedded server */}
                        <div className="flex gap-4">
                          <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-sm flex-shrink-0">2</div>
                          <div className="flex-1">
                            <h4 className="font-semibold text-slate-800 text-sm">Descargar y ejecutar el instalador</h4>
                            <p className="text-xs text-slate-500 mb-2">Un solo archivo. <strong>No necesita Git ni npm.</strong> Crea el servidor, configura inicio automático y corre en segundo plano (invisible, sin terminal).</p>
                            <button
                              onClick={() => {
                                const bat = String.raw`@echo off
title AquaOps - Instalando...
echo.
echo ====================================================
echo   AquaOps Bridge - Instalador Automatico
echo ====================================================
echo.

REM -- 1. Verificar Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js NO esta instalado.
    echo.
    echo    Descargalo desde: https://nodejs.org
    echo    Instala con Siguiente, Siguiente, Finalizar.
    echo    REINICIA el PC despues de instalar.
    echo    Luego ejecuta este archivo de nuevo.
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo [OK] Node.js %%v encontrado

REM -- 2. Crear carpeta de trabajo
set "ZEBRA_DIR=%USERPROFILE%\AquaOps"
if not exist "%ZEBRA_DIR%" mkdir "%ZEBRA_DIR%"
echo [OK] Carpeta: %ZEBRA_DIR%

REM -- 3. Detener bridge anterior (solo puerto 3000)
echo [..] Deteniendo bridge anterior...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
schtasks /end /tn "AquaOps" >nul 2>&1
timeout /t 2 /nobreak >nul
echo [OK] Bridge anterior detenido

REM -- 4. Descargar servidor de impresion desde la nube
echo [..] Descargando servidor de impresion...
if exist "%ZEBRA_DIR%\print-bridge.mjs" del "%ZEBRA_DIR%\print-bridge.mjs"
powershell -NoProfile -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://etiquetas-aguacol-684852789183.us-central1.run.app/api/download-bridge' -OutFile '%ZEBRA_DIR%\print-bridge.mjs' -UseBasicParsing; Write-Host '[OK] Servidor descargado' } catch { Write-Host '[ERROR] No se pudo descargar'; exit 1 }"
if not exist "%ZEBRA_DIR%\print-bridge.mjs" (
    echo [ERROR] No se pudo descargar el servidor.
    echo    Verifica tu conexion a internet.
    pause
    exit /b 1
)

REM -- 5. Obtener ruta de node.exe
for /f "tokens=*" %%n in ('where node') do set "NODE_PATH=%%n"
echo [OK] Node: %NODE_PATH%

REM -- 6. Crear lanzador invisible (VBS)
echo [..] Configurando inicio invisible...
> "%ZEBRA_DIR%\launch-silent.vbs" (
    echo Set WshShell = CreateObject^("WScript.Shell"^)
    echo WshShell.CurrentDirectory = "%ZEBRA_DIR%"
    echo WshShell.Run "cmd /c ""%NODE_PATH%"" print-bridge.mjs", 0, False
)
echo [OK] Lanzador invisible creado

REM -- 7. Configurar inicio automatico al encender PC
echo [..] Configurando inicio automatico...
schtasks /delete /tn "AquaOps" /f >nul 2>&1
schtasks /create /tn "AquaOps" /tr "wscript \"%ZEBRA_DIR%\launch-silent.vbs\"" /sc onlogon /rl highest /f >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Tarea programada creada
) else (
    set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
    copy /Y "%ZEBRA_DIR%\launch-silent.vbs" "%STARTUP%\AquaOps.vbs" >nul 2>&1
    echo [OK] Inicio automatico via carpeta Startup
)

REM -- 8. Abrir firewall
echo [..] Configurando firewall...
netsh advfirewall firewall delete rule name="AquaOps" >nul 2>&1
netsh advfirewall firewall add rule name="AquaOps" dir=in action=allow protocol=TCP localport=3000 >nul 2>&1
echo [OK] Firewall configurado

REM -- 9. Iniciar ahora (invisible, sin ventana)
echo [..] Iniciando servidor en segundo plano...
wscript "%ZEBRA_DIR%\launch-silent.vbs"
echo [..] Esperando inicio (8 segundos)...
timeout /t 8 /nobreak >nul

REM -- 9. Verificar
powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 3;$i++){ try{ $r=Invoke-WebRequest -Uri 'http://localhost:3000/health' -UseBasicParsing -TimeoutSec 5; Write-Host '[OK] Servidor ACTIVO en puerto 3000'; $ok=$true; break }catch{ Start-Sleep 2 } } if(-not $ok){ Write-Host '[ERROR] El servidor no responde. Reintenta ejecutar este archivo.' }"

echo.
echo ====================================================
echo   INSTALACION COMPLETA
echo.
echo   El servidor corre en SEGUNDO PLANO.
echo   Se inicia AUTOMATICAMENTE al encender el PC.
echo   No necesitas abrir ninguna ventana.
echo.
echo   Abre en tu navegador:
echo   https://etiquetas-aguacol-684852789183.us-central1.run.app
echo.
echo   Para reinstalar, ejecuta este BAT de nuevo.
echo ====================================================
timeout /t 15
`;
                                const blob = new Blob([bat], { type: 'application/x-bat' });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = 'instalar_aquaops.bat';
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                                URL.revokeObjectURL(url);
                                showToast('Descargado: instalar_aquaops.bat', 'success');
                              }}
                              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer"
                            >
                              <Download className="w-4 h-4" /> Descargar instalar_aquaops.bat
                            </button>
                            <p className="text-[10px] text-slate-400 mt-1">Doble clic para ejecutar. NO necesita Git ni npm.</p>
                          </div>
                        </div>

                        {/* Done */}
                        <div className="flex gap-4">
                          <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center font-bold text-sm flex-shrink-0">✓</div>
                          <div className="flex-1">
                            <h4 className="font-semibold text-slate-800 text-sm">¡Listo! Solo usa la URL de siempre</h4>
                            <p className="text-xs text-slate-500">El servidor arranca solo al encender el PC (invisible, sin terminal). Abre <code className="bg-slate-100 px-1.5 py-0.5 rounded text-blue-600 font-medium">https://etiquetas-aguacol-...run.app</code> y la impresora se detectará automáticamente.</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Info box */}
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                      <h4 className="text-sm font-bold text-amber-800 mb-1">💡 ¿Cómo funciona?</h4>
                      <ul className="text-xs text-amber-700 space-y-1">
                        <li>• <strong>Datos compartidos:</strong> Todos los PCs se conectan a la misma base de datos en la nube</li>
                        <li>• <strong>Impresión local:</strong> Cada PC detecta sus propias impresoras y envía ZPL directamente</li>
                        <li>• <strong>Sin conflictos:</strong> Los productos, operadores y formatos se sincronizan en tiempo real</li>
                        <li>• <strong>Invisible:</strong> El servidor corre en segundo plano, el usuario no ve ninguna terminal</li>
                      </ul>
                    </div>
                  </div>
                )}

                {/* Consola / Logs tab */}
                {configTab === "consola" && (
                  <SystemConsole />
                )}

                {configTab === "empaques" && (
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                    <div className="flex justify-between items-center mb-4">
                      <div>
                        <h3 className="text-lg font-bold text-slate-800">
                          Configuración de Envases
                        </h3>
                        <p className="text-xs text-slate-500">
                          Administra los tipos de envase primario, envase secundario y las tapas asociadas.
                        </p>
                      </div>
                    </div>

                    <div className="flex border-b border-slate-200 mb-6">
                      <button
                        onClick={() => setEnvaseSubTab("primarios")}
                        className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
                          envaseSubTab === "primarios"
                            ? "border-blue-500 text-blue-600"
                            : "border-transparent text-slate-500 hover:text-slate-700"
                        }`}
                      >
                        Envases Primarios
                      </button>
                      <button
                        onClick={() => setEnvaseSubTab("secundarios")}
                        className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
                          envaseSubTab === "secundarios"
                            ? "border-blue-500 text-blue-600"
                            : "border-transparent text-slate-500 hover:text-slate-700"
                        }`}
                      >
                        Envases Secundarios
                      </button>
                      <button
                        onClick={() => setEnvaseSubTab("tapas")}
                        className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
                          envaseSubTab === "tapas"
                            ? "border-blue-500 text-blue-600"
                            : "border-transparent text-slate-500 hover:text-slate-700"
                        }`}
                      >
                        Tapas
                      </button>
                    </div>

                    {envaseSubTab === "primarios" && (
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Form panel */}
                        <div className="lg:col-span-1 bg-slate-50 rounded-xl p-5 border border-slate-200/60 h-fit">
                          <h4 className="text-sm font-bold text-slate-700 mb-4">
                            Agregar Envase Primario
                          </h4>
                          <form
                            onSubmit={async (e) => {
                              e.preventDefault();
                              const form = e.currentTarget;
                              const formData = new FormData(form);
                              const codigo = String(formData.get("codigo") || "").trim().toUpperCase();
                              const nombre = String(formData.get("nombre") || "").trim().toUpperCase();

                              if (!nombre) {
                                showToast("El nombre del envase es obligatorio", "error");
                                return;
                              }

                              try {
                                const res = await fetch("/api/tipos-envase-primario", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ codigo, nombre }),
                                });
                                if (!res.ok) {
                                  const err = await res.json();
                                  throw new Error(err.error || "Error al agregar");
                                }
                                showToast("Envase primario registrado con éxito", "success");
                                form.reset();
                                fetchTiposEnvasePrimario();
                              } catch (err: any) {
                                showToast(err.message, "error");
                              }
                            }}
                          >
                            <div className="space-y-4">
                              <div>
                                <label htmlFor="codigo-envase-primario" className="block text-xs font-bold text-slate-750 mb-1">
                                  Código del Envase Primario
                                </label>
                                <input
                                  id="codigo-envase-primario"
                                  name="codigo"
                                  type="text"
                                  placeholder="Ej: 209, 202, 300"
                                  className="block w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-800 focus:ring-blue-500 focus:border-blue-500 font-mono"
                                />
                              </div>
                              <div>
                                <label htmlFor="nombre-envase-primario" className="block text-xs font-bold text-slate-750 mb-1">
                                  Nombre del Envase Primario *
                                </label>
                                <input
                                  id="nombre-envase-primario"
                                  name="nombre"
                                  type="text"
                                  placeholder="Ej: BIDON PLASTICO APILABLE AZUL"
                                  className="block w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-800 focus:ring-blue-500 focus:border-blue-500"
                                  required
                                />
                              </div>
                              <button
                                type="submit"
                                className="w-full flex justify-center py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm cursor-pointer"
                              >
                                Guardar Envase
                              </button>
                            </div>
                          </form>
                        </div>

                        {/* List panel */}
                        {/* List panel */}
                        <div className="lg:col-span-2 space-y-4">
                          {/* Search bar */}
                          <div className="relative">
                            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                            <input
                              type="text"
                              placeholder="Buscar por código o nombre..."
                              value={envasePrimarioSearch}
                              onChange={(e) => setEnvasePrimarioSearch(e.target.value)}
                              className="pl-9 block w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-800 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                            />
                          </div>

                          <div className="overflow-x-auto border border-slate-200 rounded-xl">
                            <table className="w-full divide-y divide-slate-200">
                              <thead className="bg-slate-50">
                                <tr>
                                  <th
                                    scope="col"
                                    onClick={() => {
                                      const nextDir = envasePrimarioSort.column === 'codigo' && envasePrimarioSort.direction === 'asc' ? 'desc' : 'asc';
                                      setEnvasePrimarioSort({ column: 'codigo', direction: nextDir });
                                    }}
                                    className="px-5 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none"
                                  >
                                    <div className="flex items-center gap-1">
                                      Código
                                      <span className="text-slate-400">
                                        {envasePrimarioSort.column === 'codigo' ? (envasePrimarioSort.direction === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
                                      </span>
                                    </div>
                                  </th>
                                  <th
                                    scope="col"
                                    onClick={() => {
                                      const nextDir = envasePrimarioSort.column === 'nombre' && envasePrimarioSort.direction === 'asc' ? 'desc' : 'asc';
                                      setEnvasePrimarioSort({ column: 'nombre', direction: nextDir });
                                    }}
                                    className="px-5 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none"
                                  >
                                    <div className="flex items-center gap-1">
                                      Nombre
                                      <span className="text-slate-400">
                                        {envasePrimarioSort.column === 'nombre' ? (envasePrimarioSort.direction === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
                                      </span>
                                    </div>
                                  </th>
                                  <th scope="col" className="px-5 py-3 text-center text-xs font-bold text-slate-500 uppercase tracking-wider">Estado</th>
                                  <th scope="col" className="px-5 py-3 text-center text-xs font-bold text-slate-500 uppercase tracking-wider">Acciones</th>
                                </tr>
                              </thead>
                              <tbody className="bg-white divide-y divide-slate-200">
                                {tiposEnvasePrimario
                                  .filter((tipo) => {
                                    const term = envasePrimarioSearch.toLowerCase().trim();
                                    if (!term) return true;
                                    return (
                                      (tipo.codigo || "").toLowerCase().includes(term) ||
                                      (tipo.nombre || "").toLowerCase().includes(term)
                                    );
                                  })
                                  .sort((a, b) => {
                                    const col = envasePrimarioSort.column;
                                    const valA = (a[col] || "").trim();
                                    const valB = (b[col] || "").trim();

                                    if (col === 'codigo') {
                                      const numA = parseInt(valA, 10);
                                      const numB = parseInt(valB, 10);
                                      if (!isNaN(numA) && !isNaN(numB)) {
                                        return envasePrimarioSort.direction === 'asc' ? numA - numB : numB - numA;
                                      }
                                    }

                                    return envasePrimarioSort.direction === 'asc'
                                      ? valA.localeCompare(valB)
                                      : valB.localeCompare(valA);
                                  })
                                  .map((tipo) => {
                                    const isSeed = false;
                                    const isEditing = editingEnvasePrimarioId === tipo.id;
                                    return (
                                      <tr key={tipo.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-5 py-3.5 whitespace-nowrap text-sm font-mono text-slate-600">
                                          {isEditing ? (
                                            <input
                                              type="text"
                                              value={editingEnvasePrimarioCode}
                                              onChange={(e) => setEditingEnvasePrimarioCode(e.target.value.toUpperCase())}
                                              className="border border-slate-300 rounded px-2.5 py-1 text-sm bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 w-full max-w-[120px] font-mono"
                                              placeholder="Código"
                                            />
                                          ) : (
                                            tipo.codigo || "-"
                                          )}
                                        </td>
                                        <td className="px-5 py-3.5 whitespace-nowrap text-sm font-semibold text-slate-800">
                                          {isEditing ? (
                                            <input
                                              type="text"
                                              value={editingEnvasePrimarioName}
                                              onChange={(e) => setEditingEnvasePrimarioName(e.target.value.toUpperCase())}
                                              className="border border-slate-300 rounded px-2.5 py-1 text-sm bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 w-full max-w-[240px]"
                                              placeholder="Nombre del envase"
                                            />
                                          ) : (
                                            tipo.nombre
                                          )}
                                        </td>
                                        <td className="px-5 py-3.5 whitespace-nowrap text-center text-sm">
                                          <button
                                            type="button"
                                            onClick={async () => {
                                              try {
                                                const newActivo = tipo.activo === 0 ? 1 : 0;
                                                const res = await fetch(`/api/tipos-envase-primario/${tipo.id}`, {
                                                  method: "PUT",
                                                  headers: { "Content-Type": "application/json" },
                                                  body: JSON.stringify({
                                                    codigo: tipo.codigo,
                                                    nombre: tipo.nombre,
                                                    activo: newActivo
                                                  }),
                                                });
                                                if (!res.ok) {
                                                  const err = await res.json();
                                                  throw new Error(err.error || "Error al actualizar");
                                                }
                                                showToast(newActivo === 1 ? "Envase habilitado" : "Envase inhabilitado", "success");
                                                fetchTiposEnvasePrimario();
                                                fetchProducts();
                                              } catch (err: any) {
                                                showToast(err.message, "error");
                                              }
                                            }}
                                            className="relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none"
                                            style={{ backgroundColor: (tipo.activo ?? 1) === 1 ? '#3b82f6' : '#cbd5e1' }}
                                          >
                                            <span
                                              className="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                                              style={{ transform: (tipo.activo ?? 1) === 1 ? 'translateX(20px)' : 'translateX(0px)' }}
                                            />
                                          </button>
                                        </td>
                                        <td className="px-5 py-3.5 whitespace-nowrap text-center text-sm">
                                          {isEditing ? (
                                            <>
                                              <button
                                                onClick={async () => {
                                                  const nombre = editingEnvasePrimarioName.trim().toUpperCase();
                                                  if (!nombre) {
                                                    showToast("El nombre del envase es obligatorio", "error");
                                                    return;
                                                  }
                                                  try {
                                                    const res = await fetch(`/api/tipos-envase-primario/${tipo.id}`, {
                                                      method: "PUT",
                                                      headers: { "Content-Type": "application/json" },
                                                      body: JSON.stringify({
                                                        codigo: editingEnvasePrimarioCode,
                                                        nombre: nombre,
                                                        activo: tipo.activo,
                                                      }),
                                                    });
                                                    if (!res.ok) {
                                                      const err = await res.json();
                                                      throw new Error(err.error || "Error al actualizar");
                                                    }
                                                    showToast("Envase primario actualizado", "success");
                                                    setEditingEnvasePrimarioId(null);
                                                    fetchTiposEnvasePrimario();
                                                    fetchProducts();
                                                  } catch (err: any) {
                                                    showToast(err.message, "error");
                                                  }
                                                }}
                                                className="p-1 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded transition-colors mr-2 cursor-pointer inline-flex items-center justify-center"
                                                title="Guardar"
                                              >
                                                <Check className="w-4 h-4" />
                                              </button>
                                              <button
                                                onClick={() => setEditingEnvasePrimarioId(null)}
                                                className="p-1 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors cursor-pointer inline-flex items-center justify-center"
                                                title="Cancelar"
                                              >
                                                <X className="w-4 h-4" />
                                              </button>
                                            </>
                                          ) : (
                                            <>
                                              <button
                                                disabled={isSeed}
                                                onClick={() => {
                                                  setEditingEnvasePrimarioId(tipo.id);
                                                  setEditingEnvasePrimarioCode(tipo.codigo || "");
                                                  setEditingEnvasePrimarioName(tipo.nombre);
                                                }}
                                                className={`p-1.5 rounded transition-colors mr-2 ${
                                                  isSeed
                                                    ? "text-slate-300 bg-transparent cursor-not-allowed"
                                                    : "text-blue-500 hover:text-blue-700 hover:bg-blue-50 cursor-pointer"
                                                }`}
                                                title={isSeed ? "Envase del sistema protegido" : "Editar envase"}
                                              >
                                                <Edit className="w-4 h-4" />
                                              </button>
                                              <button
                                                disabled={isSeed}
                                                onClick={async () => {
                                                  if (confirm(`¿Estás seguro de que deseas eliminar el tipo de envase primario "${tipo.nombre}"?`)) {
                                                    try {
                                                      const res = await fetch(`/api/tipos-envase-primario/${tipo.id}`, {
                                                        method: "DELETE",
                                                      });
                                                      if (!res.ok) {
                                                        const err = await res.json();
                                                        throw new Error(err.error || "Error al eliminar");
                                                      }
                                                      showToast("Envase primario eliminado", "success");
                                                      fetchTiposEnvasePrimario();
                                                    } catch (err: any) {
                                                      showToast(err.message, "error");
                                                    }
                                                  }
                                                }}
                                                className={`p-1.5 rounded transition-colors ${
                                                  isSeed
                                                    ? "text-slate-300 bg-transparent cursor-not-allowed"
                                                    : "text-red-500 hover:text-red-700 hover:bg-red-50 cursor-pointer"
                                                }`}
                                                title={isSeed ? "Envase del sistema protegido" : "Eliminar envase"}
                                              >
                                                <Trash2 className="w-4 h-4" />
                                              </button>
                                            </>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )}

                    {envaseSubTab === "secundarios" && (
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Form panel */}
                        <div className="lg:col-span-1 bg-slate-50 rounded-xl p-5 border border-slate-200/60 h-fit">
                          <h4 className="text-sm font-bold text-slate-700 mb-4">
                            Agregar Nuevo Envase Secundario
                          </h4>
                          <form
                            onSubmit={async (e) => {
                              e.preventDefault();
                              const form = e.currentTarget;
                              const formData = new FormData(form);
                              const nombre = String(formData.get("nombre") || "").trim().toUpperCase();
                              const requiere_empaque_grupal = formData.get("requiere_empaque_grupal") === "on";

                              if (!nombre) {
                                showToast("El nombre del envase es obligatorio", "error");
                                return;
                              }

                              try {
                                const res = await fetch("/api/tipos-empaque-secundario", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ nombre, requiere_empaque_grupal }),
                                });
                                if (!res.ok) {
                                  const err = await res.json();
                                  throw new Error(err.error || "Error al agregar");
                                }
                                showToast("Envase secundario registrado con éxito", "success");
                                form.reset();
                                fetchTiposEmpaque();
                              } catch (err: any) {
                                showToast(err.message, "error");
                              }
                            }}
                          >
                            <div className="space-y-4">
                              <div>
                                <label htmlFor="nombre-envase" className="block text-xs font-bold text-slate-750 mb-1">
                                  Nombre del Envase Secundario *
                                </label>
                                <input
                                  id="nombre-envase"
                                  name="nombre"
                                  type="text"
                                  placeholder="Ej: SACO, BALDE, CAJA"
                                  className="block w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-800 focus:ring-blue-500 focus:border-blue-500"
                                  required
                                />
                              </div>
                              <div className="flex items-center pt-2">
                                <input
                                  id="requiere-empaque-grupal"
                                  name="requiere_empaque_grupal"
                                  type="checkbox"
                                  defaultChecked={true}
                                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-300 rounded cursor-pointer"
                                />
                                <label htmlFor="requiere-empaque-grupal" className="ml-2 block text-xs font-semibold text-slate-700 cursor-pointer">
                                  Requiere Empaque Grupal
                                </label>
                              </div>
                              <p className="text-[10px] text-slate-400 leading-relaxed">
                                * Si está activo, los pallets de los productos asociados se calcularán utilizando el divisor de <strong>Cant. Grupal</strong>. Si no, se usará <strong>Cant. Individual</strong>.
                              </p>
                              <button
                                type="submit"
                                className="w-full flex justify-center py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm cursor-pointer"
                              >
                                Guardar Envase
                              </button>
                            </div>
                          </form>
                        </div>

                        {/* List panel */}
                        <div className="lg:col-span-2 overflow-x-auto border border-slate-200 rounded-xl">
                          <table className="w-full divide-y divide-slate-200">
                            <thead className="bg-slate-50">
                              <tr>
                                <th scope="col" className="px-5 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Nombre</th>
                                <th scope="col" className="px-5 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Regla de Cálculo</th>
                                <th scope="col" className="px-5 py-3 text-center text-xs font-bold text-slate-500 uppercase tracking-wider">Acciones</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-slate-200">
                              {tiposEmpaque.map((tipo) => {
                                const isSeed = false;
                                const isEditing = editingEnvaseSecundarioId === tipo.id;
                                return (
                                  <tr key={tipo.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-5 py-3.5 whitespace-nowrap text-sm font-semibold text-slate-800">
                                      {isEditing ? (
                                        <input
                                          type="text"
                                          value={editingEnvaseSecundarioName}
                                          disabled={isSeed}
                                          onChange={(e) => setEditingEnvaseSecundarioName(e.target.value.toUpperCase())}
                                          className={`border border-slate-300 rounded px-2.5 py-1 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 w-full max-w-[200px] ${
                                            isSeed ? "bg-slate-50 text-slate-400 cursor-not-allowed border-slate-200" : "bg-white"
                                          }`}
                                          placeholder="Nombre del envase"
                                        />
                                      ) : (
                                        tipo.nombre
                                      )}
                                    </td>
                                    <td className="px-5 py-3.5 whitespace-nowrap text-xs text-slate-650">
                                      {isEditing ? (
                                        <label className="flex items-center cursor-pointer">
                                          <input
                                            type="checkbox"
                                            checked={editingEnvaseSecundarioGrupal}
                                            onChange={(e) => setEditingEnvaseSecundarioGrupal(e.target.checked)}
                                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-300 rounded mr-2 cursor-pointer"
                                          />
                                          <span className="text-xs text-slate-700 font-semibold select-none">
                                            Empaque Grupal
                                          </span>
                                        </label>
                                      ) : (
                                        tipo.requiere_empaque_grupal === 1 ? (
                                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-800 border border-blue-200">
                                            Empaque Grupal (cant_grupal)
                                          </span>
                                        ) : (
                                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-50 text-slate-600 border border-slate-200">
                                            Empaque Individual (cant_individual)
                                          </span>
                                        )
                                      )}
                                    </td>
                                    <td className="px-5 py-3.5 whitespace-nowrap text-center text-sm">
                                      {isEditing ? (
                                        <>
                                          <button
                                            onClick={async () => {
                                              const nombre = editingEnvaseSecundarioName.trim().toUpperCase();
                                              if (!nombre) {
                                                showToast("El nombre del envase es obligatorio", "error");
                                                return;
                                              }
                                              try {
                                                const res = await fetch(`/api/tipos-empaque-secundario/${tipo.id}`, {
                                                  method: "PUT",
                                                  headers: { "Content-Type": "application/json" },
                                                  body: JSON.stringify({
                                                    nombre,
                                                    requiere_empaque_grupal: editingEnvaseSecundarioGrupal,
                                                  }),
                                                });
                                                if (!res.ok) {
                                                  const err = await res.json();
                                                  throw new Error(err.error || "Error al actualizar");
                                                }
                                                showToast("Envase secundario actualizado", "success");
                                                setEditingEnvaseSecundarioId(null);
                                                fetchTiposEmpaque();
                                                fetchProducts();
                                              } catch (err: any) {
                                                showToast(err.message, "error");
                                              }
                                            }}
                                            className="p-1 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded transition-colors mr-2 cursor-pointer inline-flex items-center justify-center"
                                            title="Guardar"
                                          >
                                            <Check className="w-4 h-4" />
                                          </button>
                                          <button
                                            onClick={() => setEditingEnvaseSecundarioId(null)}
                                            className="p-1 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors cursor-pointer inline-flex items-center justify-center"
                                            title="Cancelar"
                                          >
                                            <X className="w-4 h-4" />
                                          </button>
                                        </>
                                      ) : (
                                        <>
                                          <button
                                            onClick={() => {
                                              setEditingEnvaseSecundarioId(tipo.id);
                                              setEditingEnvaseSecundarioName(tipo.nombre);
                                              setEditingEnvaseSecundarioGrupal(tipo.requiere_empaque_grupal === 1);
                                            }}
                                            className="p-1.5 rounded transition-colors mr-2 text-blue-500 hover:text-blue-700 hover:bg-blue-50 cursor-pointer"
                                            title="Editar envase"
                                          >
                                            <Edit className="w-4 h-4" />
                                          </button>
                                          <button
                                            disabled={isSeed}
                                            onClick={async () => {
                                              if (confirm(`¿Estás seguro de que deseas eliminar el tipo de empaque "${tipo.nombre}"?`)) {
                                                try {
                                                  const res = await fetch(`/api/tipos-empaque-secundario/${tipo.id}`, {
                                                    method: "DELETE",
                                                  });
                                                  if (!res.ok) {
                                                    const err = await res.json();
                                                    throw new Error(err.error || "Error al eliminar");
                                                  }
                                                  showToast("Envase secundario eliminado", "success");
                                                  fetchTiposEmpaque();
                                                } catch (err: any) {
                                                  showToast(err.message, "error");
                                                }
                                              }
                                            }}
                                            className={`p-1.5 rounded transition-colors ${
                                              isSeed
                                                ? "text-slate-300 bg-transparent cursor-not-allowed"
                                                : "text-red-500 hover:text-red-700 hover:bg-red-50 cursor-pointer"
                                            }`}
                                            title={isSeed ? "Empaque del sistema protegido" : "Eliminar empaque"}
                                          >
                                            <Trash2 className="w-4 h-4" />
                                          </button>
                                        </>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {envaseSubTab === "tapas" && (
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Form panel */}
                        <div className="lg:col-span-1 bg-slate-50 rounded-xl p-5 border border-slate-200/60 h-fit">
                          <h4 className="text-sm font-bold text-slate-700 mb-4">
                            Agregar Nueva Tapa
                          </h4>
                          <form
                            onSubmit={async (e) => {
                              e.preventDefault();
                              const form = e.currentTarget;
                              const formData = new FormData(form);
                              const codigo = String(formData.get("codigo") || "").trim().toUpperCase();
                              const nombre = String(formData.get("nombre") || "").trim().toUpperCase();

                              if (!nombre) {
                                showToast("El nombre de la tapa es obligatorio", "error");
                                return;
                              }

                              try {
                                const res = await fetch("/api/tipos-tapa", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ codigo, nombre }),
                                });
                                if (!res.ok) {
                                  const err = await res.json();
                                  throw new Error(err.error || "Error al agregar");
                                }
                                showToast("Tapa registrada con éxito", "success");
                                form.reset();
                                fetchTiposTapa();
                              } catch (err: any) {
                                showToast(err.message, "error");
                              }
                            }}
                          >
                            <div className="space-y-4">
                              <div>
                                <label htmlFor="codigo-tapa" className="block text-xs font-bold text-slate-750 mb-1">
                                  Código de la Tapa
                                </label>
                                <input
                                  id="codigo-tapa"
                                  name="codigo"
                                  type="text"
                                  placeholder="Ej: 600, 605, 2015"
                                  className="block w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-800 focus:ring-blue-500 focus:border-blue-500 font-mono"
                                />
                              </div>
                              <div>
                                <label htmlFor="nombre-tapa" className="block text-xs font-bold text-slate-750 mb-1">
                                  Nombre de la Tapa *
                                </label>
                                <input
                                  id="nombre-tapa"
                                  name="nombre"
                                  type="text"
                                  placeholder="Ej: TAPA AZUL SINEA"
                                  className="block w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-800 focus:ring-blue-500 focus:border-blue-500"
                                  required
                                />
                              </div>
                              <button
                                type="submit"
                                className="w-full flex justify-center py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm cursor-pointer"
                              >
                                Guardar Tapa
                              </button>
                            </div>
                          </form>
                        </div>

                        {/* List panel */}
                        <div className="lg:col-span-2 space-y-4">
                          {/* Search bar */}
                          <div className="relative">
                            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                            <input
                              type="text"
                              placeholder="Buscar por código o nombre..."
                              value={tapaSearch}
                              onChange={(e) => setTapaSearch(e.target.value)}
                              className="pl-9 block w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-800 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                            />
                          </div>

                          <div className="overflow-x-auto border border-slate-200 rounded-xl">
                            <table className="w-full divide-y divide-slate-200">
                              <thead className="bg-slate-50">
                                <tr>
                                  <th
                                    scope="col"
                                    onClick={() => {
                                      const nextDir = tapaSort.column === 'codigo' && tapaSort.direction === 'asc' ? 'desc' : 'asc';
                                      setTapaSort({ column: 'codigo', direction: nextDir });
                                    }}
                                    className="px-5 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none"
                                  >
                                    <div className="flex items-center gap-1">
                                      Código
                                      <span className="text-slate-400">
                                        {tapaSort.column === 'codigo' ? (tapaSort.direction === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
                                      </span>
                                    </div>
                                  </th>
                                  <th
                                    scope="col"
                                    onClick={() => {
                                      const nextDir = tapaSort.column === 'nombre' && tapaSort.direction === 'asc' ? 'desc' : 'asc';
                                      setTapaSort({ column: 'nombre', direction: nextDir });
                                    }}
                                    className="px-5 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none"
                                  >
                                    <div className="flex items-center gap-1">
                                      Nombre
                                      <span className="text-slate-400">
                                        {tapaSort.column === 'nombre' ? (tapaSort.direction === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
                                      </span>
                                    </div>
                                  </th>
                                  <th scope="col" className="px-5 py-3 text-center text-xs font-bold text-slate-500 uppercase tracking-wider">Estado</th>
                                  <th scope="col" className="px-5 py-3 text-center text-xs font-bold text-slate-500 uppercase tracking-wider">Acciones</th>
                                </tr>
                              </thead>
                              <tbody className="bg-white divide-y divide-slate-200">
                                {tiposTapa
                                  .filter((tipo) => {
                                    const term = tapaSearch.toLowerCase().trim();
                                    if (!term) return true;
                                    return (
                                      (tipo.codigo || "").toLowerCase().includes(term) ||
                                      (tipo.nombre || "").toLowerCase().includes(term)
                                    );
                                  })
                                  .sort((a, b) => {
                                    const col = tapaSort.column;
                                    const valA = (a[col] || "").trim();
                                    const valB = (b[col] || "").trim();

                                    if (col === 'codigo') {
                                      const numA = parseInt(valA, 10);
                                      const numB = parseInt(valB, 10);
                                      if (!isNaN(numA) && !isNaN(numB)) {
                                        return tapaSort.direction === 'asc' ? numA - numB : numB - numA;
                                      }
                                    }

                                    return tapaSort.direction === 'asc'
                                      ? valA.localeCompare(valB)
                                      : valB.localeCompare(valA);
                                  })
                                  .map((tipo) => {
                                    const isEditing = editingTapaId === tipo.id;
                                    return (
                                      <tr key={tipo.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-5 py-3.5 whitespace-nowrap text-sm font-mono text-slate-600">
                                          {isEditing ? (
                                            <input
                                              type="text"
                                              value={editingTapaCode}
                                              onChange={(e) => setEditingTapaCode(e.target.value.toUpperCase())}
                                              className="border border-slate-300 rounded px-2.5 py-1 text-sm bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 w-full max-w-[120px] font-mono"
                                              placeholder="Código"
                                            />
                                          ) : (
                                            tipo.codigo || "-"
                                          )}
                                        </td>
                                        <td className="px-5 py-3.5 whitespace-nowrap text-sm font-semibold text-slate-800">
                                          {isEditing ? (
                                            <input
                                              type="text"
                                              value={editingTapaName}
                                              onChange={(e) => setEditingTapaName(e.target.value.toUpperCase())}
                                              className="border border-slate-300 rounded px-2.5 py-1 text-sm bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 w-full max-w-[240px]"
                                              placeholder="Nombre de la tapa"
                                            />
                                          ) : (
                                            tipo.nombre
                                          )}
                                        </td>
                                        <td className="px-5 py-3.5 whitespace-nowrap text-center text-sm">
                                          <button
                                            type="button"
                                            onClick={async () => {
                                              try {
                                                const newActivo = tipo.activo === 0 ? 1 : 0;
                                                const res = await fetch(`/api/tipos-tapa/${tipo.id}`, {
                                                  method: "PUT",
                                                  headers: { "Content-Type": "application/json" },
                                                  body: JSON.stringify({
                                                    codigo: tipo.codigo,
                                                    nombre: tipo.nombre,
                                                    activo: newActivo
                                                  }),
                                                });
                                                if (!res.ok) {
                                                  const err = await res.json();
                                                  throw new Error(err.error || "Error al actualizar");
                                                }
                                                showToast(newActivo === 1 ? "Tapa habilitada" : "Tapa inhabilitada", "success");
                                                fetchTiposTapa();
                                                fetchProducts();
                                              } catch (err: any) {
                                                showToast(err.message, "error");
                                              }
                                            }}
                                            className="relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none"
                                            style={{ backgroundColor: (tipo.activo ?? 1) === 1 ? '#3b82f6' : '#cbd5e1' }}
                                          >
                                            <span
                                              className="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                                              style={{ transform: (tipo.activo ?? 1) === 1 ? 'translateX(20px)' : 'translateX(0px)' }}
                                            />
                                          </button>
                                        </td>
                                        <td className="px-5 py-3.5 whitespace-nowrap text-center text-sm">
                                          {isEditing ? (
                                            <>
                                              <button
                                                onClick={async () => {
                                                  const nombre = editingTapaName.trim().toUpperCase();
                                                  if (!nombre) {
                                                    showToast("El nombre de la tapa es obligatorio", "error");
                                                    return;
                                                  }
                                                  try {
                                                    const res = await fetch(`/api/tipos-tapa/${tipo.id}`, {
                                                      method: "PUT",
                                                      headers: { "Content-Type": "application/json" },
                                                      body: JSON.stringify({
                                                        codigo: editingTapaCode,
                                                        nombre: nombre,
                                                        activo: tipo.activo
                                                      }),
                                                    });
                                                    if (!res.ok) {
                                                      const err = await res.json();
                                                      throw new Error(err.error || "Error al actualizar");
                                                    }
                                                    showToast("Tapa actualizada", "success");
                                                    setEditingTapaId(null);
                                                    fetchTiposTapa();
                                                    fetchProducts();
                                                  } catch (err: any) {
                                                    showToast(err.message, "error");
                                                  }
                                                }}
                                                className="p-1 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded transition-colors mr-2 cursor-pointer inline-flex items-center justify-center"
                                                title="Guardar"
                                              >
                                                <Check className="w-4 h-4" />
                                              </button>
                                              <button
                                                onClick={() => setEditingTapaId(null)}
                                                className="p-1 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors cursor-pointer inline-flex items-center justify-center"
                                                title="Cancelar"
                                              >
                                                <X className="w-4 h-4" />
                                              </button>
                                            </>
                                          ) : (
                                            <>
                                              <button
                                                onClick={() => {
                                                  setEditingTapaId(tipo.id);
                                                  setEditingTapaCode(tipo.codigo || "");
                                                  setEditingTapaName(tipo.nombre);
                                                }}
                                                className="p-1.5 rounded transition-colors mr-2 text-blue-500 hover:text-blue-700 hover:bg-blue-50 cursor-pointer inline-flex items-center justify-center"
                                                title="Editar tapa"
                                              >
                                                <Edit className="w-4 h-4" />
                                              </button>
                                              <button
                                                onClick={async () => {
                                                  if (confirm(`¿Estás seguro de que deseas eliminar el tipo de tapa "${tipo.nombre}"?`)) {
                                                    try {
                                                      const res = await fetch(`/api/tipos-tapa/${tipo.id}`, {
                                                        method: "DELETE",
                                                      });
                                                      if (!res.ok) {
                                                        const err = await res.json();
                                                        throw new Error(err.error || "Error al eliminar");
                                                      }
                                                      showToast("Tapa eliminada", "success");
                                                      fetchTiposTapa();
                                                    } catch (err: any) {
                                                      showToast(err.message, "error");
                                                    }
                                                  }
                                                }}
                                                className="p-1.5 rounded transition-colors text-red-500 hover:text-red-700 hover:bg-red-50 cursor-pointer inline-flex items-center justify-center"
                                                title="Eliminar tapa"
                                              >
                                                <Trash2 className="w-4 h-4" />
                                              </button>
                                            </>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {currentView === "planificacion" && (
              <PlanificacionManager 
                products={products}
                onShowToast={showToast}
                theme={theme}
                tiposEmpaque={tiposEmpaque}
                tiposEnvasePrimario={tiposEnvasePrimario}
                tiposTapa={tiposTapa}
              />
            )}
          </div>
        </div>
      </main>

      {isFormOpen && (
        <ProductForm
          product={editingProduct}
          onSave={handleSaveProduct}
          onClose={() => setIsFormOpen(false)}
          tiposEmpaque={tiposEmpaque}
          tiposEnvasePrimario={tiposEnvasePrimario}
          tiposTapa={tiposTapa}
        />
      )}

       {printingProduct && (
        <PrintModal
          product={printingProduct}
          labelFormats={labelFormats}
          activeFormatId={activeFormatId}
          theme={theme}
          onChangeTheme={(t) => {
            setTheme(t);
            localStorage.setItem('tracelabel-theme', t);
          }}
          onClose={() => setPrintingProduct(undefined)}
          onShowToast={showToast}
        />
      )}

      {tracePrintingProduct && (
        <TracePrintModal
          product={tracePrintingProduct}
          labelFormats={labelFormats}
          activeFormatId={activeFormatId}
          theme={theme}
          onChangeTheme={(t) => {
            setTheme(t);
            localStorage.setItem('tracelabel-theme', t);
          }}
          onClose={() => setTracePrintingProduct(undefined)}
          onShowToast={showToast}
        />
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 animate-in fade-in slide-in-from-bottom-4">
          <div
            className={`px-4 py-3 rounded-lg shadow-lg border text-sm font-medium flex items-center space-x-2 ${
              toast.type === "success"
                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                : "bg-red-50 text-red-800 border-red-200"
            }`}
          >
            <span>{toast.message}</span>
            <button
              onClick={() => setToast(null)}
              className="ml-4 opacity-50 hover:opacity-100"
            >
              &times;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
