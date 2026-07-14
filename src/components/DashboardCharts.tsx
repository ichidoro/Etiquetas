import React, { useMemo } from 'react';
import type { Planificacion } from '../types';

// ── Color Palettes ──────────────────────────────────────────────────────────
const FAMILY_COLORS = [
  '#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6',
  '#06b6d4','#ec4899','#84cc16','#f97316','#6366f1',
  '#14b8a6','#e11d48','#a855f7','#0ea5e9',
];
const BRAND_COLORS = [
  '#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6',
  '#06b6d4','#ec4899','#84cc16',
];
const DAY_NAMES = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

// ── Internal parseFormatoToLiters ───────────────────────────────────────────
function parseFormatoToLiters(fmt?: string | null): number {
  if (!fmt) return 0;
  const c = fmt.trim().toLowerCase();
  if (!c) return 0;
  const ml = c.match(/^([\d.,]+)\s*(cc|ml|mls)$/);
  if (ml) { const v = parseFloat(ml[1].replace(',','.')); return isNaN(v) ? 0 : v / 1000; }
  const lt = c.match(/^([\d.,]+)\s*(l|lt|lts|litro|litros)$/);
  if (lt) { const v = parseFloat(lt[1].replace(',','.')); return isNaN(v) ? 0 : v; }
  const v = parseFloat(c.replace(',','.'));
  return isNaN(v) ? 0 : v;
}

// ── Types ───────────────────────────────────────────────────────────────────
export interface ComplianceData { completado: number; enProceso: number; programado: number; totalUnits: number }
export interface FamilyItem { name: string; value: number; pct: number; color: string }
export interface HeatmapData { lines: string[]; days: string[]; matrix: number[][]; maxVal: number }
export interface ParetoItem { sku: string; name: string; units: number; pct: number; cumPct: number }
export interface BrandItem { name: string; value: number; pct: number; color: string }
export interface DailyTrendData { dates: string[]; families: string[]; series: Record<string, number[]> }
export interface LineStatusItem { name: string; completado: number; enProceso: number; programado: number; total: number }
export interface SparklineDataSet { pallets: number[]; liters: number[]; units: number[]; compliance: number[] }

export interface DashboardChartDataResult {
  complianceData: ComplianceData;
  familyTreemapData: FamilyItem[];
  heatmapData: HeatmapData;
  paretoData: ParetoItem[];
  brandDonutData: BrandItem[];
  dailyTrendData: DailyTrendData;
  lineStatusData: LineStatusItem[];
  sparklineData: SparklineDataSet;
}

// ── Hook ────────────────────────────────────────────────────────────────────
export function useDashboardChartData(
  filteredPlans: Planificacion[],
  previousPlans: Planificacion[],
  dashStartDate: string,
  dashEndDate: string,
): DashboardChartDataResult {

  const complianceData = useMemo<ComplianceData>(() => {
    let comp = 0, proc = 0, prog = 0;
    filteredPlans.forEach(p => {
      const q = p.cantidad_programada || 0;
      if (p.estado === 'completado') comp += q;
      else if (p.estado === 'en_proceso') proc += q;
      else prog += q;
    });
    return { completado: comp, enProceso: proc, programado: prog, totalUnits: comp + proc + prog };
  }, [filteredPlans]);

  const familyTreemapData = useMemo<FamilyItem[]>(() => {
    const m = new Map<string, number>();
    filteredPlans.forEach(p => {
      const fam = p.product_family || 'Sin familia';
      m.set(fam, (m.get(fam) || 0) + (p.cantidad_programada || 0));
    });
    const total = Array.from(m.values()).reduce((a, b) => a + b, 0);
    return Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, value], i) => ({
        name, value,
        pct: total > 0 ? Math.round((value / total) * 1000) / 10 : 0,
        color: FAMILY_COLORS[i % FAMILY_COLORS.length],
      }));
  }, [filteredPlans]);

  const heatmapData = useMemo<HeatmapData>(() => {
    const lineSet = new Set<string>();
    const map = new Map<string, number>();
    filteredPlans.forEach(p => {
      const line = p.linea_descripcion || p.linea_codigo || `Línea ${p.linea_id}`;
      lineSet.add(line);
      const dow = new Date(p.fecha + 'T12:00:00').getDay(); // 0=Sun
      const dayIdx = dow === 0 ? 6 : dow - 1; // Mon=0
      const key = `${line}|${dayIdx}`;
      map.set(key, (map.get(key) || 0) + (p.cantidad_programada || 0));
    });
    const lines = Array.from(lineSet).sort();
    let maxVal = 0;
    const matrix = lines.map(line =>
      DAY_NAMES.map((_, di) => {
        const v = map.get(`${line}|${di}`) || 0;
        if (v > maxVal) maxVal = v;
        return v;
      })
    );
    return { lines, days: DAY_NAMES, matrix, maxVal };
  }, [filteredPlans]);

  const paretoData = useMemo<ParetoItem[]>(() => {
    const m = new Map<string, { name: string; units: number }>();
    filteredPlans.forEach(p => {
      const existing = m.get(p.product_sku) || { name: p.product_name || p.product_sku, units: 0 };
      existing.units += p.cantidad_programada || 0;
      m.set(p.product_sku, existing);
    });
    const sorted = Array.from(m.entries()).sort((a, b) => b[1].units - a[1].units).slice(0, 10);
    const total = sorted.reduce((s, [, v]) => s + v.units, 0);
    let cum = 0;
    return sorted.map(([sku, { name, units }]) => {
      const pct = total > 0 ? (units / total) * 100 : 0;
      cum += pct;
      return { sku, name, units, pct: Math.round(pct * 10) / 10, cumPct: Math.round(cum * 10) / 10 };
    });
  }, [filteredPlans]);

  const brandDonutData = useMemo<BrandItem[]>(() => {
    const m = new Map<string, number>();
    filteredPlans.forEach(p => {
      const brand = p.product_marca || 'Sin marca';
      m.set(brand, (m.get(brand) || 0) + (p.cantidad_programada || 0));
    });
    const total = Array.from(m.values()).reduce((a, b) => a + b, 0);
    return Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, value], i) => ({
        name, value,
        pct: total > 0 ? Math.round((value / total) * 1000) / 10 : 0,
        color: BRAND_COLORS[i % BRAND_COLORS.length],
      }));
  }, [filteredPlans]);

  const dailyTrendData = useMemo<DailyTrendData>(() => {
    const dateMap = new Map<string, Map<string, number>>();
    const famSet = new Set<string>();
    filteredPlans.forEach(p => {
      const fam = p.product_family || 'Sin familia';
      famSet.add(fam);
      if (!dateMap.has(p.fecha)) dateMap.set(p.fecha, new Map());
      const dm = dateMap.get(p.fecha)!;
      dm.set(fam, (dm.get(fam) || 0) + (p.cantidad_programada || 0));
    });
    const dates = Array.from(dateMap.keys()).sort();
    const families = Array.from(famSet);
    const series: Record<string, number[]> = {};
    families.forEach(f => { series[f] = dates.map(d => dateMap.get(d)?.get(f) || 0); });
    return { dates, families, series };
  }, [filteredPlans]);

  const lineStatusData = useMemo<LineStatusItem[]>(() => {
    const m = new Map<string, { completado: number; enProceso: number; programado: number }>();
    filteredPlans.forEach(p => {
      const line = p.linea_descripcion || p.linea_codigo || `Línea ${p.linea_id}`;
      const liters = (p.cantidad_programada || 0) * parseFormatoToLiters(p.product_formato);
      if (!m.has(line)) m.set(line, { completado: 0, enProceso: 0, programado: 0 });
      const e = m.get(line)!;
      if (p.estado === 'completado') e.completado += liters;
      else if (p.estado === 'en_proceso') e.enProceso += liters;
      else e.programado += liters;
    });
    return Array.from(m.entries())
      .map(([name, v]) => ({ name, ...v, total: v.completado + v.enProceso + v.programado }))
      .sort((a, b) => b.total - a.total);
  }, [filteredPlans]);

  const sparklineData = useMemo<SparklineDataSet>(() => {
    const dayMap = new Map<string, { pallets: number; liters: number; units: number; comp: number; total: number }>();
    filteredPlans.forEach(p => {
      if (!dayMap.has(p.fecha)) dayMap.set(p.fecha, { pallets: 0, liters: 0, units: 0, comp: 0, total: 0 });
      const d = dayMap.get(p.fecha)!;
      const q = p.cantidad_programada || 0;
      d.units += q;
      d.liters += q * parseFormatoToLiters(p.product_formato);
      const grp = p.product_cant_grupal || 1;
      const ind = p.product_cant_individual || 1;
      const div = grp * ind;
      if (div > 0) d.pallets += q / div;
      d.total += q;
      if (p.estado === 'completado') d.comp += q;
    });
    const sorted = Array.from(dayMap.entries()).sort((a, b) => a[0].localeCompare(b[0])).slice(-7);
    return {
      pallets: sorted.map(([, v]) => Math.round(v.pallets * 10) / 10),
      liters: sorted.map(([, v]) => Math.round(v.liters)),
      units: sorted.map(([, v]) => v.units),
      compliance: sorted.map(([, v]) => v.total > 0 ? Math.round((v.comp / v.total) * 100) : 0),
    };
  }, [filteredPlans]);

  return { complianceData, familyTreemapData, heatmapData, paretoData, brandDonutData, dailyTrendData, lineStatusData, sparklineData };
}

// ════════════════════════════════════════════════════════════════════════════
// CHART COMPONENTS
// ════════════════════════════════════════════════════════════════════════════

// ── SparklineSVG ────────────────────────────────────────────────────────────
interface SparklineProps { data: number[]; color?: string; width?: number; height?: number }

export const SparklineSVG: React.FC<SparklineProps> = ({ data, color = '#3b82f6', width = 80, height = 28 }) => {
  const id = useMemo(() => `sp-${Math.random().toString(36).slice(2, 8)}`, []);
  if (!data.length) return <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} />;

  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => {
    const x = data.length > 1 ? (i / (data.length - 1)) * width : width / 2;
    const y = height - (v / max) * (height - 4) - 2;
    return `${x},${y}`;
  });
  const polyline = pts.join(' ');
  const areaPath = `M0,${height} L${pts.join(' L')} L${width},${height} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${id})`} />
      <polyline points={polyline} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

// ── DonutChart ──────────────────────────────────────────────────────────────
interface DonutChartProps {
  data: Array<{ name: string; value: number; color: string }>;
  centerLabel?: string;
  centerValue?: string;
  size?: number;
}

export const DonutChart: React.FC<DonutChartProps> = ({ data, centerLabel, centerValue, size = 180 }) => {
  const total = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data]);
  if (!data.length || total === 0) {
    return (
      <div className="flex items-center justify-center" style={{ width: size, height: size }}>
        <span className="text-[11px] text-slate-400 italic">Sin datos</span>
      </div>
    );
  }
  const r = 34, cx = 50, cy = 50, circumference = 2 * Math.PI * r;
  let offset = 0;

  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="overflow-visible">
      {data.map((seg, i) => {
        const pct = seg.value / total;
        const dash = pct * circumference;
        const gap = circumference - dash;
        const currentOffset = offset;
        offset += dash;
        return (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={seg.color}
            strokeWidth={12} strokeDasharray={`${dash} ${gap}`}
            strokeDashoffset={-currentOffset} strokeLinecap="butt"
            transform={`rotate(-90 ${cx} ${cy})`}
            className="transition-all duration-300 hover:opacity-80"
            style={{ cursor: 'pointer' }}
          >
            <title>{seg.name}: {seg.value.toLocaleString('es-AR')} ({(pct * 100).toFixed(1)}%)</title>
          </circle>
        );
      })}
      {centerValue && (
        <>
          <text x={cx} y={cy - 3} textAnchor="middle" className="fill-current" fontSize="10" fontWeight="700">{centerValue}</text>
          {centerLabel && <text x={cx} y={cy + 8} textAnchor="middle" fontSize="5" opacity={0.5}>{centerLabel}</text>}
        </>
      )}
    </svg>
  );
};

// ── TreemapChart ────────────────────────────────────────────────────────────
interface TreemapProps {
  data: FamilyItem[];
  width?: number;
  height?: number;
}

function squarify(items: { name: string; value: number; pct: number; color: string }[], x: number, y: number, w: number, h: number): Array<{ x: number; y: number; w: number; h: number; item: FamilyItem }> {
  if (!items.length) return [];
  const total = items.reduce((s, d) => s + d.value, 0);
  if (total === 0) return [];

  const rects: Array<{ x: number; y: number; w: number; h: number; item: FamilyItem }> = [];
  let cx = x, cy = y, cw = w, ch = h;

  items.forEach(item => {
    const ratio = item.value / total;
    if (cw >= ch) {
      const rw = cw * ratio;
      rects.push({ x: cx, y: cy, w: Math.max(rw, 0), h: ch, item });
      cx += rw;
      cw -= rw;
    } else {
      const rh = ch * ratio;
      rects.push({ x: cx, y: cy, w: cw, h: Math.max(rh, 0), item });
      cy += rh;
      ch -= rh;
    }
  });
  return rects;
}

export const TreemapChart: React.FC<TreemapProps> = ({ data, width = 500, height = 260 }) => {
  const rects = useMemo(() => squarify(data, 0, 0, width, height), [data, width, height]);

  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-40">
        <span className="text-[11px] text-slate-400 italic">Sin datos</span>
      </div>
    );
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
      <defs>
        <filter id="tm-shadow" x="-2%" y="-2%" width="104%" height="104%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodOpacity="0.12" />
        </filter>
      </defs>
      {rects.map((r, i) => (
        <g key={i} className="transition-opacity duration-200 hover:opacity-90" style={{ cursor: 'pointer' }}>
          <rect x={r.x + 1} y={r.y + 1} width={Math.max(r.w - 2, 0)} height={Math.max(r.h - 2, 0)}
            rx={4} ry={4} fill={r.item.color} opacity={0.85} filter="url(#tm-shadow)" />
          {r.w > 50 && r.h > 28 && (
            <>
              <text x={r.x + r.w / 2} y={r.y + r.h / 2 - 4} textAnchor="middle"
                fill="#fff" fontSize={r.w > 100 ? 11 : 9} fontWeight="600"
                style={{ pointerEvents: 'none' }}>
                {r.item.name.length > 14 ? r.item.name.slice(0, 12) + '…' : r.item.name}
              </text>
              <text x={r.x + r.w / 2} y={r.y + r.h / 2 + 10} textAnchor="middle"
                fill="#fff" fontSize={8} opacity={0.8} style={{ pointerEvents: 'none' }}>
                {r.item.pct}%
              </text>
            </>
          )}
          <title>{r.item.name}: {r.item.value.toLocaleString('es-AR')} ({r.item.pct}%)</title>
        </g>
      ))}
    </svg>
  );
};

// ── HeatmapChart ────────────────────────────────────────────────────────────
interface HeatmapProps { lines: string[]; days: string[]; matrix: number[][]; maxVal: number }

export const HeatmapChart: React.FC<HeatmapProps> = ({ lines, days, matrix, maxVal }) => {
  if (!lines.length) {
    return <div className="flex items-center justify-center h-32"><span className="text-[11px] text-slate-400 italic">Sin datos</span></div>;
  }

  const intensity = (v: number) => maxVal > 0 ? v / maxVal : 0;

  return (
    <div className="overflow-x-auto">
      <div className="inline-grid gap-[2px]" style={{ gridTemplateColumns: `120px repeat(${days.length}, 1fr)` }}>
        {/* Header */}
        <div />
        {days.map(d => (
          <div key={d} className="text-[10px] text-center text-slate-400 font-medium py-1">{d}</div>
        ))}
        {/* Rows */}
        {lines.map((line, li) => (
          <React.Fragment key={line}>
            <div className="text-[10px] text-slate-400 truncate pr-2 flex items-center" title={line}>
              {line.length > 16 ? line.slice(0, 14) + '…' : line}
            </div>
            {days.map((_, di) => {
              const v = matrix[li]?.[di] || 0;
              const a = intensity(v);
              return (
                <div key={di} className="relative group rounded-sm min-w-[32px] h-7 flex items-center justify-center transition-transform duration-150 hover:scale-110"
                  style={{ backgroundColor: `rgba(59,130,246,${0.08 + a * 0.82})` }}>
                  <span className="text-[9px] font-medium" style={{ color: a > 0.5 ? '#fff' : 'rgba(100,116,139,0.7)' }}>
                    {v > 0 ? v.toLocaleString('es-AR') : ''}
                  </span>
                  {v > 0 && (
                    <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[9px] px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-10">
                      {line}: {v.toLocaleString('es-AR')} uds
                    </div>
                  )}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

// ── ParetoChart ─────────────────────────────────────────────────────────────
interface ParetoProps { data: ParetoItem[] }

export const ParetoChart: React.FC<ParetoProps> = ({ data }) => {
  const vb = { w: 440, h: 260 };
  const margin = { l: 130, r: 40, t: 10, b: 20 };
  const plotW = vb.w - margin.l - margin.r;
  const plotH = vb.h - margin.t - margin.b;

  if (!data.length) {
    return <div className="flex items-center justify-center h-40"><span className="text-[11px] text-slate-400 italic">Sin datos</span></div>;
  }

  const maxUnits = Math.max(...data.map(d => d.units), 1);
  const barH = Math.min(plotH / data.length - 3, 18);
  const gradId = 'pareto-grad';

  // Cumulative line points
  const linePoints = data.map((d, i) => {
    const x = margin.l + (d.cumPct / 100) * plotW;
    const y = margin.t + i * (plotH / data.length) + barH / 2;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg viewBox={`0 0 ${vb.w} ${vb.h}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#34d399" />
        </linearGradient>
      </defs>
      {/* 80% threshold */}
      {(() => { const x = margin.l + 0.8 * plotW; return (
        <line x1={x} y1={margin.t} x2={x} y2={margin.t + plotH} stroke="#f59e0b" strokeWidth={1} strokeDasharray="4 3" opacity={0.6} />
      ); })()}
      <text x={margin.l + 0.8 * plotW + 3} y={margin.t + 10} fontSize={7} fill="#f59e0b" opacity={0.7}>80%</text>

      {data.map((d, i) => {
        const y = margin.t + i * (plotH / data.length);
        const bw = (d.units / maxUnits) * plotW;
        const label = d.name.length > 18 ? d.name.slice(0, 16) + '…' : d.name;
        return (
          <g key={d.sku}>
            <text x={margin.l - 4} y={y + barH / 2 + 3} textAnchor="end" fontSize={8} fill="#94a3b8">{label}</text>
            <rect x={margin.l} y={y + 1} width={bw} height={barH} rx={3} fill={`url(#${gradId})`} opacity={0.85}>
              <title>{d.name}: {d.units.toLocaleString('es-AR')} uds ({d.pct}%)</title>
            </rect>
            <text x={margin.l + bw + 4} y={y + barH / 2 + 3} fontSize={7} fill="#64748b">{d.pct}%</text>
          </g>
        );
      })}
      {/* Cumulative line */}
      <polyline points={linePoints} fill="none" stroke="#f97316" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.8} />
      {data.map((d, i) => {
        const x = margin.l + (d.cumPct / 100) * plotW;
        const y = margin.t + i * (plotH / data.length) + barH / 2;
        return <circle key={i} cx={x} cy={y} r={2.5} fill="#f97316" opacity={0.9} />;
      })}
    </svg>
  );
};

// ── StackedAreaChart ────────────────────────────────────────────────────────
interface StackedAreaProps {
  dates: string[];
  families: string[];
  series: Record<string, number[]>;
  height?: number;
}

export const StackedAreaChart: React.FC<StackedAreaProps> = ({ dates, families, series, height = 220 }) => {
  const vbW = 500, vbH = height;
  const m = { l: 40, r: 10, t: 10, b: 30 };
  const pw = vbW - m.l - m.r, ph = vbH - m.t - m.b;

  const { paths, maxY } = useMemo(() => {
    if (!dates.length || !families.length) return { paths: [] as Array<{ family: string; d: string; color: string }>, maxY: 0 };
    // Stack values
    const stacked: number[][] = dates.map(() => new Array(families.length).fill(0));
    families.forEach((f, fi) => {
      dates.forEach((_, di) => {
        stacked[di][fi] = (series[f]?.[di] || 0) + (fi > 0 ? stacked[di][fi - 1] : 0);
      });
    });
    const maxY = Math.max(...stacked.map(row => row[families.length - 1] || 0), 1);
    const xScale = (i: number) => m.l + (i / Math.max(dates.length - 1, 1)) * pw;
    const yScale = (v: number) => m.t + ph - (v / maxY) * ph;

    const paths = families.map((f, fi) => {
      const top = dates.map((_, di) => `${xScale(di)},${yScale(stacked[di][fi])}`);
      const bot = dates.map((_, di) => `${xScale(di)},${yScale(fi > 0 ? stacked[di][fi - 1] : 0)}`).reverse();
      return { family: f, d: `M${top.join(' L')} L${bot.join(' L')} Z`, color: FAMILY_COLORS[fi % FAMILY_COLORS.length] };
    });
    return { paths, maxY };
  }, [dates, families, series, m.l, m.t, pw, ph]);

  if (!dates.length) {
    return <div className="flex items-center justify-center h-40"><span className="text-[11px] text-slate-400 italic">Sin datos</span></div>;
  }

  // Show at most 8 x-axis labels
  const step = Math.max(1, Math.floor(dates.length / 8));
  const xLabels = dates.filter((_, i) => i % step === 0 || i === dates.length - 1);

  return (
    <div>
      <svg viewBox={`0 0 ${vbW} ${vbH}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
        <defs>
          {paths.map((p, i) => (
            <linearGradient key={i} id={`sag-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={p.color} stopOpacity={0.6} />
              <stop offset="100%" stopColor={p.color} stopOpacity={0.15} />
            </linearGradient>
          ))}
        </defs>
        {/* Grid lines */}
        {[0.25, 0.5, 0.75, 1].map(pct => {
          const y = m.t + ph - pct * ph;
          return (
            <g key={pct}>
              <line x1={m.l} y1={y} x2={m.l + pw} y2={y} stroke="#e2e8f0" strokeWidth={0.5} />
              <text x={m.l - 4} y={y + 3} textAnchor="end" fontSize={7} fill="#94a3b8">
                {Math.round(maxY * pct).toLocaleString('es-AR')}
              </text>
            </g>
          );
        })}
        {/* Areas */}
        {paths.map((p, i) => (
          <path key={i} d={p.d} fill={`url(#sag-${i})`} stroke={p.color} strokeWidth={0.8} opacity={0.9}>
            <title>{p.family}</title>
          </path>
        ))}
        {/* X-axis labels */}
        {xLabels.map(d => {
          const idx = dates.indexOf(d);
          const x = m.l + (idx / Math.max(dates.length - 1, 1)) * pw;
          const label = d.slice(5); // MM-DD
          return <text key={d} x={x} y={vbH - 4} textAnchor="middle" fontSize={7} fill="#94a3b8">{label}</text>;
        })}
      </svg>
      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-2 px-1">
        {families.slice(0, 8).map((f, i) => (
          <div key={f} className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: FAMILY_COLORS[i % FAMILY_COLORS.length] }} />
            <span className="text-[10px] text-slate-400">{f}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── HorizontalStackedBarChart ───────────────────────────────────────────────
interface HBarProps { data: LineStatusItem[] }

export const HorizontalStackedBarChart: React.FC<HBarProps> = ({ data }) => {
  const vbW = 460, barH = 20, gap = 6;
  const m = { l: 120, r: 60 };
  const pw = vbW - m.l - m.r;
  const vbH = data.length * (barH + gap) + 10;

  if (!data.length) {
    return <div className="flex items-center justify-center h-32"><span className="text-[11px] text-slate-400 italic">Sin datos</span></div>;
  }

  const maxTotal = Math.max(...data.map(d => d.total), 1);

  const segments: Array<{ key: string; color: string; field: keyof LineStatusItem }> = [
    { key: 'Completado', color: '#10b981', field: 'completado' },
    { key: 'En proceso', color: '#f59e0b', field: 'enProceso' },
    { key: 'Programado', color: '#64748b', field: 'programado' },
  ];

  return (
    <div>
      <svg viewBox={`0 0 ${vbW} ${vbH}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
        {data.map((d, i) => {
          const y = i * (barH + gap) + 4;
          let xOff = m.l;
          const label = d.name.length > 16 ? d.name.slice(0, 14) + '…' : d.name;
          return (
            <g key={d.name}>
              <text x={m.l - 4} y={y + barH / 2 + 3} textAnchor="end" fontSize={8} fill="#94a3b8">{label}</text>
              {segments.map(seg => {
                const val = d[seg.field] as number;
                const w = d.total > 0 ? (val / maxTotal) * pw : 0;
                const rx = xOff;
                xOff += w;
                return w > 0 ? (
                  <rect key={seg.key} x={rx} y={y} width={w} height={barH} rx={3} fill={seg.color} opacity={0.8}>
                    <title>{seg.key}: {Math.round(val).toLocaleString('es-AR')} L</title>
                  </rect>
                ) : null;
              })}
              <text x={xOff + 4} y={y + barH / 2 + 3} fontSize={7} fill="#64748b" fontWeight="600">
                {Math.round(d.total).toLocaleString('es-AR')} L
              </text>
            </g>
          );
        })}
      </svg>
      {/* Legend */}
      <div className="flex gap-4 mt-2 px-1">
        {segments.map(s => (
          <div key={s.key} className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
            <span className="text-[10px] text-slate-400">{s.key}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
