import { LabelFormat, ElementPosition } from "../types";

export const defaultLabelFormat: LabelFormat = {
  id: "default",
  name: "Estándar 50x25mm",
  width: 50,
  height: 25,
  dpi: 203,
  darkness: 15,
  printSpeed: 3,
  orientation: "N",
  marginTop: 2,
  marginBottom: 0,
  marginLeft: 2,
  marginRight: 0,
  labelsPerRow: 1,
  labelsPerColumn: 1,
  horizontalGap: 2,
  verticalGap: 0,
  showName: true,
  showSku: true,
  showEan13: true,
  showDun14: true,
};

/** Height of each element type in mm (approximate, for layout purposes) */
export function getElementHeights(format: LabelFormat): Record<string, number> {
  const dpmm = format.dpi === 300 ? 12 : 8;
  const fontHmm = 3; // ~3mm for the text line
  // Barcode height: fill remaining space but reasonable minimum
  const barcodeHmm = Math.max(8, format.height * 0.35);
  const barcodeWithTextMm = barcodeHmm + 3; // barcode + human-readable text below

  return {
    name: fontHmm,
    sku: barcodeWithTextMm,
    ean13: barcodeWithTextMm,
    dun14: barcodeWithTextMm,
  };
}

/** Calculate default auto-stacked positions (tight, no gaps) */
export function calculateDefaultPositions(
  format: LabelFormat,
  product: { sku: string; item_name: string; ean13?: string; dun14?: string },
): ElementPosition[] {
  const heights = getElementHeights(format);
  const gap = 1; // 1mm gap between elements
  const positions: ElementPosition[] = [];
  let currentY = format.marginTop;

  const elements: { id: ElementPosition['id']; show: boolean; hasData: boolean }[] = [
    { id: 'name', show: format.showName, hasData: !!product.item_name },
    { id: 'sku', show: format.showSku, hasData: !!product.sku },
    { id: 'ean13', show: format.showEan13, hasData: !!product.ean13 },
    { id: 'dun14', show: format.showDun14, hasData: !!product.dun14 },
  ];

  for (const el of elements) {
    if (el.show && el.hasData) {
      positions.push({ id: el.id, x: format.marginLeft, y: currentY });
      currentY += heights[el.id] + gap;
    }
  }

  return positions;
}

export function generateZpl(
  sku: string,
  itemName: string,
  ean13?: string,
  dun14?: string,
  format: LabelFormat = defaultLabelFormat,
  customPositions?: ElementPosition[],
): string {
  const dpmm = format.dpi === 300 ? 12 : 8;

  const labelWidthDots = Math.round(format.width * dpmm);
  const labelHeightDots = Math.round(format.height * dpmm);
  const gapDots = Math.round(format.horizontalGap * dpmm);
  const marginLeftDots = Math.round(format.marginLeft * dpmm);
  const marginTopDots = Math.round(format.marginTop * dpmm);

  const totalPw = Math.max(
    labelWidthDots,
    labelWidthDots * format.labelsPerRow +
      gapDots * Math.max(0, format.labelsPerRow - 1) +
      marginLeftDots,
  );
  const ll = labelHeightDots;

  let zpl = "^XA\n";
  zpl += `^PW${totalPw}\n`;
  zpl += `^LL${ll}\n`;
  zpl += `~SD${format.darkness}\n`;
  zpl += `^PR${format.printSpeed}\n`;

  // Font setup
  const fontH = Math.round(3 * dpmm);
  const fontW = Math.round(2.5 * dpmm);

  // Barcode height in dots
  const barcodeHeightMm = Math.max(8, format.height * 0.35);
  const bHeight = Math.round(barcodeHeightMm * dpmm);

  const orientation = format.orientation;
  const verticalGapDots = Math.round((format.verticalGap || 2) * dpmm);

  // Calculate positions (use custom if provided, otherwise auto-stack)
  const positions = customPositions || calculateDefaultPositions(
    format,
    { sku, item_name: itemName, ean13, dun14 },
  );

  // Build a lookup for positions
  const posMap = new Map<string, ElementPosition>();
  for (const p of positions) posMap.set(p.id, p);

  // Generate for each column/row
  const verticalCount = format.labelsPerColumn || 1;
  const horizontalCount = format.labelsPerRow || 1;

  for (let row = 0; row < verticalCount; row++) {
    for (let col = 0; col < horizontalCount; col++) {
      const colOffsetX = marginLeftDots + col * (labelWidthDots + gapDots);
      const rowOffsetY = row * (labelHeightDots + verticalGapDots);

      // Name
      if (format.showName && itemName && posMap.has('name')) {
        const pos = posMap.get('name')!;
        const x = colOffsetX + Math.round(pos.x * dpmm) - marginLeftDots;
        const y = rowOffsetY + Math.round(pos.y * dpmm);
        zpl += `^FO${x},${y}^A0${orientation},${fontH},${fontW}^FD${itemName.substring(0, 30)}^FS\n`;
      }

      // SKU (Code 128)
      if (format.showSku && sku && posMap.has('sku')) {
        const pos = posMap.get('sku')!;
        const x = colOffsetX + Math.round(pos.x * dpmm) - marginLeftDots;
        const y = rowOffsetY + Math.round(pos.y * dpmm);
        zpl += `^FO${x},${y}^BC${orientation},${bHeight},Y,N,N^FD${sku}^FS\n`;
      }

      // EAN13
      if (format.showEan13 && ean13 && posMap.has('ean13')) {
        const pos = posMap.get('ean13')!;
        const x = colOffsetX + Math.round(pos.x * dpmm) - marginLeftDots;
        const y = rowOffsetY + Math.round(pos.y * dpmm);
        zpl += `^FO${x},${y}^BE${orientation},${bHeight},Y,N^FD${ean13}^FS\n`;
      }

      // DUN14
      if (format.showDun14 && dun14 && posMap.has('dun14')) {
        const pos = posMap.get('dun14')!;
        const x = colOffsetX + Math.round(pos.x * dpmm) - marginLeftDots;
        const y = rowOffsetY + Math.round(pos.y * dpmm);
        zpl += `^FO${x},${y}^B2${orientation},${bHeight},Y,N,N^FD${dun14}^FS\n`;
      }
    }
  }

  zpl += "^PQ1,0,1,Y\n";
  zpl += "^XZ\n";
  return zpl;
}
