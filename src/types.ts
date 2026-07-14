export interface Product {
  id?: number;
  sku: string;
  item_name: string;
  business_line?: string;
  family?: string;
  ean13?: string;
  dun14?: string;
  marca?: string;
  isp?: string;
  caducidad?: number;
  activo?: boolean;
  termocontraible_default?: boolean | number;
  envase_secundario_default?: boolean | number;
  envase_secundario_tipo?: string;
  envase_primario_tipo?: string;
  tapa_tipo?: string;
  cant_grupal?: number;
  cant_individual?: number;
  formato?: string;
}

export interface LabelFormat {
  id: string;
  name: string;
  width: number; // width of single label in mm
  height: number; // height of single label in mm
  dpi: number; // 203 or 300
  darkness: number; // 0-30
  printSpeed: number; // 1-6
  orientation: "N" | "R" | "I" | "B"; // Normal, Rotated 90, Inverted 180, Bottom-up 270
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  labelsPerRow: number;
  labelsPerColumn: number;
  horizontalGap: number; // gap between labels in mm
  verticalGap: number; // gap between labels vertically in mm
  showName: boolean;
  showSku: boolean;
  showEan13: boolean;
  showDun14: boolean;
  labelShift?: number; // horizontal shift in mm (negative = left) — ZPL ^LS
  labelTop?: number;   // vertical shift in mm (negative = up) — ZPL ^LT
}

export interface ZebraPrinter {
  id?: number;
  name: string;
  ip: string;
  port: number;
  type: 'network' | 'usb';
  is_default: boolean;
}

export interface ElementPosition {
  id: 'name' | 'sku' | 'ean13' | 'dun14';
  x: number;  // mm from left edge of label
  y: number;  // mm from top edge of label
  h: number;  // height in mm (for resizable elements)
  fontSize?: number; // font size in mm (only for 'name')
}

/** Saved layout that persists across products */
export interface SavedLabelLayout {
  positions: ElementPosition[];
  selectedParts: { name: boolean; sku: boolean; ean13: boolean; dun14: boolean };
}

export interface LineaProceso {
  id?: number;
  codigo: string;
  descripcion: string;
  tipo_maquina?: string;
  whatsapp_group_id?: string | null;
  whatsapp_phone?: string | null;
  operador?: string | null;
}

export interface Planificacion {
  id?: number;
  linea_id: number;
  product_sku: string;
  cantidad_programada: number;
  fecha: string;
  turno?: 'Mañana' | 'Tarde' | 'Noche';
  estado?: 'programado' | 'en_proceso' | 'completado';
  termocontraible?: string;
  envase_secundario?: string;
  envase_secundario_tipo?: string;
  observaciones?: string;
  prioridad?: number;
  created_at?: string;
  
  // fields from backend JOIN
  linea_codigo?: string;
  linea_descripcion?: string;
  linea_tipo_maquina?: string;
  linea_operador?: string;
  product_name?: string;
  product_marca?: string;
  product_family?: string;
  product_cant_grupal?: number;
  product_cant_individual?: number;
  product_formato?: string;
  product_envase_primario_tipo?: string;
  product_tapa_tipo?: string;
  current_version?: number | null;
  last_notified_state?: string | null;
}

export interface TipoEmpaqueSecundario {
  id?: number;
  nombre: string;
  requiere_empaque_grupal: number;
  activo?: number;
}

export interface TipoEnvasePrimario {
  id?: number;
  codigo: string;
  nombre: string;
  activo?: number;
}

export interface TipoTapa {
  id?: number;
  codigo: string;
  nombre: string;
  activo?: number;
}
