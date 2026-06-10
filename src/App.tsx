import React, { useState, useEffect, useRef } from "react";
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
} from "lucide-react";
import { Product, LabelFormat } from "./types";
import { ProductForm } from "./components/ProductForm";
import { PrintModal } from "./components/PrintModal";
import { TracePrintModal } from "./components/TracePrintModal";
import { LabelPreview } from "./components/LabelPreview";
import { EmpleadosManager } from "./components/EmpleadosManager";
import { PrinterManager } from "./components/PrinterManager";
import { FreeLabelCreator } from "./components/FreeLabelCreator";

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [filterBusinessLine, setFilterBusinessLine] = useState("");
  const [filterFamily, setFilterFamily] = useState("");
  const [filterMarca, setFilterMarca] = useState("");
  const [filterStatus, setFilterStatus] = useState("activo"); // 'todos', 'activo', 'inactivo'
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  // Views and DB status
  const [currentView, setCurrentView] = useState<
    "maestro" | "formatos" | "historial" | "configuracion" | "disenador"
  >("maestro");
  const [configTab, setConfigTab] = useState<"turso" | "operadores" | "impresoras">("operadores");
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

  useEffect(() => {
    fetchProducts();
    fetchConfig();
    fetchLabelFormats();
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
          marca: (r["MARCA"] || "").toString().trim(),
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

  const filteredProducts = products.filter(
    (p) => {
      const matchBusinessLine = filterBusinessLine === "" || p.business_line === filterBusinessLine;
      const matchFamily = filterFamily === "" || p.family === filterFamily;
      const matchMarca = filterMarca === "" || p.marca === filterMarca;
      
      let matchStatus = true;
      if (filterStatus === "activo") matchStatus = p.activo !== false; // handle true or undefined
      if (filterStatus === "inactivo") matchStatus = p.activo === false;

      const matchSearch = p.sku.toLowerCase().includes(search.toLowerCase()) ||
        p.item_name.toLowerCase().includes(search.toLowerCase()) ||
        (p.business_line && p.business_line.toLowerCase().includes(search.toLowerCase())) ||
        (p.family && p.family.toLowerCase().includes(search.toLowerCase())) ||
        (p.marca && p.marca.toLowerCase().includes(search.toLowerCase()));

      return matchBusinessLine && matchFamily && matchMarca && matchStatus && matchSearch;
    }
  );

  return (
    <div className="flex h-screen bg-slate-100 text-slate-700 font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-white flex flex-col flex-shrink-0">
        <div className="p-6 text-xl font-bold border-b border-slate-800 flex items-center">
          ZebraBridge Pro
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
            {dbStatus.dbType === "turso-cloud" ? "☁️ Cloud: " : "💾 Local: "}
            {dbStatus.dbType === "turso-cloud"
              ? dbStatus.dbUrl.split("?")[0]
              : "SQLite"}
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
                : "Configuración"}
            </h1>
            <p className="text-xs text-slate-500">
              {currentView === "maestro" ? "Gestión de SKU, códigos GS1 y etiquetas de trazabilidad"
                : currentView === "formatos" ? "Configuración de etiquetas ZPL"
                : currentView === "disenador" ? "Crea etiquetas personalizadas con texto libre"
                : currentView === "historial" ? "Registro de impresiones enviadas"
                : "Configuración del sistema"}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {dbStatus.dbType === "turso-cloud" ? (
              <div className="flex items-center gap-2 bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-full text-xs font-semibold border border-emerald-200">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                Conectado a Turso (Cloud)
              </div>
            ) : (
              <div
                className="flex items-center gap-2 bg-amber-50 text-amber-700 px-3 py-1.5 rounded-full text-xs font-semibold border border-amber-200"
                title="Usando SQLite en memoria / local"
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
                      Mantenedor de Productos y Códigos Turso
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                      Gestiona SKUs, genera códigos de barra (EAN13, DUN14) e
                      imprime vía ZPL.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                    <input
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
                  <div className="relative flex-1">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Search className="h-5 w-5 text-slate-400" />
                    </div>
                    <input
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
                      <select
                        value={filterBusinessLine}
                        onChange={(e) => {
                          setFilterBusinessLine(e.target.value);
                          setFilterFamily("");
                          setFilterMarca("");
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
                      <select
                        value={filterFamily}
                        onChange={(e) => {
                          setFilterFamily(e.target.value);
                          setFilterMarca("");
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
                      <select
                        value={filterMarca}
                        onChange={(e) => setFilterMarca(e.target.value)}
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

                  {/* Filter: Status */}
                  <div className="md:w-40">
                    <select
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value)}
                      className="block w-full py-3 px-3 border border-slate-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm bg-white text-slate-800"
                    >
                      <option value="todos">Estado (Todos)</option>
                      <option value="activo">Activos</option>
                      <option value="inactivo">Inactivos</option>
                    </select>
                  </div>
                </div>

                {/* Table Content */}
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
                  <div className="overflow-x-auto w-full">
                    <table className="min-w-[1400px] divide-y divide-slate-200">
                      <thead className="bg-slate-50">
                        <tr>
                          <th
                            scope="col"
                            className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider border-b-2 border-slate-200"
                          >
                            SKU
                          </th>
                          <th
                            scope="col"
                            className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider border-b-2 border-slate-200"
                          >
                            Item Name
                          </th>
                          <th
                            scope="col"
                            className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider border-b-2 border-slate-200"
                          >
                            Línea de Negocio
                          </th>
                          <th
                            scope="col"
                            className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider border-b-2 border-slate-200"
                          >
                            Familia
                          </th>
                          <th
                            scope="col"
                            className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider border-b-2 border-slate-200"
                          >
                            EAN-13
                          </th>
                          <th
                            scope="col"
                            className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider border-b-2 border-slate-200"
                          >
                            DUN-14
                          </th>
                          <th
                            scope="col"
                            className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider border-b-2 border-slate-200"
                            translate="no"
                          >
                            ISP
                          </th>
                          <th
                            scope="col"
                            className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider border-b-2 border-slate-200"
                          >
                            Marca
                          </th>
                          <th
                            scope="col"
                            className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider border-b-2 border-slate-200"
                          >
                            Caducidad
                          </th>
                          <th
                            scope="col"
                            className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider border-b-2 border-slate-200"
                          >
                            Estado
                          </th>
                          <th
                            scope="col"
                            className="sticky right-0 z-10 px-3 py-3 border-b-2 border-slate-200 bg-slate-50"
                          >
                            <span className="sr-only">Acciones</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-slate-100 relative">
                        {loading ? (
                          <tr>
                            <td
                              colSpan={12}
                              className="px-3 py-8 text-center text-slate-500 font-medium"
                            >
                              <div className="flex justify-center items-center space-x-2">
                                <div className="w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin"></div>
                                <span>Cargando productos...</span>
                              </div>
                            </td>
                          </tr>
                        ) : filteredProducts.length === 0 ? (
                          <tr>
                            <td
                              colSpan={12}
                              className="px-3 py-8 text-center text-slate-500 font-medium bg-slate-50/50"
                            >
                              No se encontraron resultados. Intenta agregar un
                              nuevo producto o importar un CSV.
                            </td>
                          </tr>
                        ) : (
                          filteredProducts.map((p) => (
                            <tr
                              key={p.id}
                              className="hover:bg-slate-50 transition-colors"
                            >
                              <td className="px-3 py-3 whitespace-nowrap text-sm font-semibold text-slate-800">
                                {p.sku}
                              </td>
                              <td className="px-3 py-3 text-sm text-slate-500 whitespace-nowrap">
                                {p.item_name}
                              </td>
                              <td className="px-3 py-3 text-sm text-slate-500 whitespace-nowrap">
                                {p.business_line || "-"}
                              </td>
                              <td className="px-3 py-3 text-sm text-slate-500 whitespace-nowrap">
                                {p.family || "-"}
                              </td>
                              <td className="px-3 py-3 whitespace-nowrap">
                                {p.ean13 ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 w-max">
                                    {p.ean13}
                                  </span>
                                ) : (
                                  <span className="text-xs text-slate-400">
                                    -
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-3 whitespace-nowrap">
                                {p.dun14 ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800 w-max">
                                    {p.dun14}
                                  </span>
                                ) : (
                                  <span className="text-xs text-slate-400">
                                    -
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-3 whitespace-nowrap text-xs text-slate-500 font-mono" translate="no">
                                {p.isp || "-"}
                              </td>
                              <td className="px-3 py-3 whitespace-nowrap text-sm text-slate-500">
                                {p.marca || "-"}
                              </td>
                              <td className="px-3 py-3 whitespace-nowrap text-sm text-slate-500">
                                {p.caducidad !== undefined && p.caducidad !== null ? `${p.caducidad}d` : "-"}
                              </td>
                              <td className="px-3 py-3 whitespace-nowrap text-sm">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${p.activo !== false ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-800'}`}>
                                  {p.activo !== false ? 'Activo' : 'Inactivo'}
                                </span>
                              </td>
                              <td className="sticky right-0 z-10 px-3 py-3 whitespace-nowrap text-right text-sm font-medium bg-white">
                                <div className="flex items-center justify-end space-x-2">
                                  <button
                                    onClick={() => setPrintingProduct(p)}
                                    title="Imprimir Código de Barras"
                                    className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                                  >
                                    <Printer className="w-5 h-5" />
                                  </button>
                                  <button
                                    onClick={() => setTracePrintingProduct(p)}
                                    title="Imprimir Trazabilidad"
                                    className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-md transition-colors"
                                  >
                                    <ClipboardList className="w-5 h-5" />
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingProduct(p);
                                      setIsFormOpen(true);
                                    }}
                                    title="Editar"
                                    className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                                  >
                                    <Edit className="w-5 h-5" />
                                  </button>
                                  <button
                                    onClick={() => handleDelete(p.id!)}
                                    title="Eliminar"
                                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                                  >
                                    <Trash2 className="w-5 h-5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="px-6 py-4 border-t bg-slate-50 border-slate-200">
                    <p className="text-xs text-slate-500 font-medium">
                      Mostrando {filteredProducts.length} productos
                    </p>
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
                        <LabelPreview format={labelFormat} />
                      </div>
                    </div>

                    {/* Settings Form Section - Right Side */}
                    <div className="lg:col-span-6 xl:col-span-7 2xl:col-span-6 grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-6">
                        <div>
                          <h3 className="text-md font-semibold text-slate-800 mb-4 border-b pb-2">
                            Nombre del Formato
                        </h3>
                        <input
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
                            <label className="block text-xs font-medium text-slate-700 mb-1">
                              Ancho (mm)
                            </label>
                            <input
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
                            <label className="block text-xs font-medium text-slate-700 mb-1">
                              Alto (mm)
                            </label>
                            <input
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
                            <label className="block text-xs font-medium text-slate-700 mb-1">
                              Margen Izquierdo (mm)
                            </label>
                            <input
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
                            <label className="block text-xs font-medium text-slate-700 mb-1">
                              Margen Derecho (mm)
                            </label>
                            <input
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
                            <label className="block text-xs font-medium text-slate-700 mb-1">
                              Margen Superior (mm)
                            </label>
                            <input
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
                            <label className="block text-xs font-medium text-slate-700 mb-1">
                              Margen Inferior (mm)
                            </label>
                            <input
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
                            <label className="block text-xs font-medium text-slate-700 mb-1">
                              Conteo Horizontal
                            </label>
                            <input
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
                            <label className="block text-xs font-medium text-slate-700 mb-1">
                              Espacio Horizontal (mm)
                            </label>
                            <input
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
                            <label className="block text-xs font-medium text-slate-700 mb-1">
                              Conteo Vertical
                            </label>
                            <input
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
                            <label className="block text-xs font-medium text-slate-700 mb-1">
                              Separación Vertical (mm)
                            </label>
                            <input
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
                            <label className="block text-xs font-medium text-slate-700 mb-1">
                              DPI (Resolución)
                            </label>
                            <select
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
                            <label className="block text-xs font-medium text-slate-700 mb-1">
                              Oscuridad (~SD)
                            </label>
                            <input
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
                            <label className="block text-xs font-medium text-slate-700 mb-1">
                              Velocidad (^PR)
                            </label>
                            <input
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
                            <label className="block text-xs font-medium text-slate-700 mb-1">
                              Orientación
                            </label>
                            <select
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
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 sm:p-8">
                <h2 className="text-xl font-bold text-slate-800 mb-4">
                  Historial de Impresión (Próximamente)
                </h2>
                <p className="text-slate-500 mb-6">
                  Aquí verás un registro histórico de todas las impresiones
                  enviadas desde la plataforma hacia tus impresoras locales
                  emparejadas por USB, con fecha, hora, y la identificación del
                  dispositivo.
                </p>
                <div className="border-2 border-dashed border-slate-200 rounded-xl p-12 text-center text-slate-400">
                  <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  Módulo en desarrollo
                </div>
              </div>
            )}

            {currentView === "configuracion" && (
              <div>
                {/* Tab bar */}
                <div className="flex border-b border-slate-200 mb-6 bg-white rounded-t-xl">
                  <button
                    onClick={() => setConfigTab("operadores")}
                    className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-colors border-b-2 cursor-pointer ${
                      configTab === "operadores"
                        ? "border-blue-500 text-blue-600"
                        : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <Users className="w-4 h-4" />
                    <span>Operadores de Línea</span>
                  </button>
                  <button
                    onClick={() => setConfigTab("turso")}
                    className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-colors border-b-2 cursor-pointer ${
                      configTab === "turso"
                        ? "border-blue-500 text-blue-600"
                        : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <Settings className="w-4 h-4" />
                    <span>Turso BD</span>
                  </button>
                  <button
                    onClick={() => setConfigTab("impresoras")}
                    className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-colors border-b-2 cursor-pointer ${
                      configTab === "impresoras"
                        ? "border-blue-500 text-blue-600"
                        : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <Printer className="w-4 h-4" />
                    <span>Impresoras</span>
                  </button>
                </div>

                {/* Operadores tab */}
                {configTab === "operadores" && (
                  <EmpleadosManager onShowToast={showToast} />
                )}

                {/* Turso BD tab */}
                {configTab === "turso" && (
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
                              ? "Base de Datos Cloud (Turso/libSQL)"
                              : "SQLite Local (En Memoria/Archivo)"}
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
                        Para conectar a una base de datos externa de la nube en
                        Turso, este proyecto debe configurarse a nivel de servidor
                        estableciendo la variable de entorno{" "}
                        <code className="bg-slate-100 px-1 rounded">
                          TURSO_DATABASE_URL
                        </code>{" "}
                        y{" "}
                        <code className="bg-slate-100 px-1 rounded">
                          TURSO_AUTH_TOKEN
                        </code>
                        .
                      </p>
                    </div>
                  </div>
                )}

                {/* Impresoras tab */}
                {configTab === "impresoras" && (
                  <PrinterManager onShowToast={showToast} />
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      {isFormOpen && (
        <ProductForm
          product={editingProduct}
          onSave={handleSaveProduct}
          onClose={() => setIsFormOpen(false)}
        />
      )}

      {printingProduct && (
        <PrintModal
          product={printingProduct}
          labelFormats={labelFormats}
          activeFormatId={activeFormatId}
          onClose={() => setPrintingProduct(undefined)}
          onShowToast={showToast}
        />
      )}

      {tracePrintingProduct && (
        <TracePrintModal
          product={tracePrintingProduct}
          labelFormats={labelFormats}
          activeFormatId={activeFormatId}
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
