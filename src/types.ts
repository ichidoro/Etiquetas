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
