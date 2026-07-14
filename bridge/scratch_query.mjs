import { createClient } from "@libsql/client";

const db = createClient({
  url: "libsql://unicodiq-ichidoro.aws-us-east-1.turso.io",
  authToken: "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODA5NTA0OTMsImlkIjoiMDE5ZWE4ZWItY2QwMS03ODliLWJlOTMtZGZkMGY1YzFjMjJlIiwicmlkIjoiZTJhYzM5YzEtYjhhMS00NzFmLTk3YjctN2YyNjg5ZGFjZjAwIn0.iNI0xsEowQvZt4PoD4mcxrjfzyxwgU5tmY0VZ1yZImyB7IBZ_FihHAU5n7Acc6npckKP0C5xuziIOuW3lAa9Ag"
});

function parseFormatoToLiters(formatoStr) {
  if (!formatoStr) return 0;
  const clean = formatoStr.trim().toLowerCase();
  if (!clean) return 0;
  
  const mlMatch = clean.match(/^([\d.,]+)\s*(cc|ml|mls)$/);
  if (mlMatch) {
    const val = parseFloat(mlMatch[1].replace(',', '.'));
    return isNaN(val) ? 0 : val / 1000;
  }
  
  const lMatch = clean.match(/^([\d.,]+)\s*(l|lt|lts|litro|litros)$/);
  if (lMatch) {
    const val = parseFloat(lMatch[1].replace(',', '.'));
    return isNaN(val) ? 0 : val;
  }
  
  const val = parseFloat(clean.replace(',', '.'));
  return isNaN(val) ? 0 : val;
}

async function main() {
  console.log("--- FETCHING PLANIFICACIONES & PRODUCTS ---");
  const result = await db.execute({
    sql: `SELECT p.id, p.fecha, p.product_sku, p.cantidad_programada, p.linea_id, 
                 prod.item_name, prod.family, prod.formato
          FROM planificaciones p
          LEFT JOIN products prod ON p.product_sku = prod.sku
          WHERE p.fecha >= '2026-06-29' AND p.fecha <= '2026-08-02'`
  });

  const plans = result.rows;
  console.log(`Loaded ${plans.length} planificaciones in range.`);

  // Group by date and calculate liters
  const dateLitersAll = {};
  const dateLitersWater = {};

  for (const p of plans) {
    const formatStr = p.formato || "";
    const litersPerUnit = parseFormatoToLiters(formatStr);
    const totalLiters = (p.cantidad_programada || 0) * litersPerUnit;
    
    // All
    dateLitersAll[p.fecha] = (dateLitersAll[p.fecha] || 0) + totalLiters;

    // Water filter (includes family or name contains "agua")
    const family = (p.family || "").toLowerCase();
    const name = (p.item_name || "").toLowerCase();
    const isWater = family.includes("agua") || name.includes("agua");
    if (isWater) {
      dateLitersWater[p.fecha] = (dateLitersWater[p.fecha] || 0) + totalLiters;
    }
  }

  console.log("\n--- DAILY LITERS COMPARISON ---");
  const allDates = Array.from(new Set([...Object.keys(dateLitersAll), ...Object.keys(dateLitersWater)])).sort();
  for (const d of allDates) {
    console.log(`${d}: All = ${dateLitersAll[d] || 0} L | Water Only = ${dateLitersWater[d] || 0} L`);
  }

  console.log("\n--- ALL PLANS DETAIL FOR TODAY (2026-07-13) ---");
  const todayPlans = plans.filter(p => p.fecha === '2026-07-13');
  for (const p of todayPlans) {
    const litersPerUnit = parseFormatoToLiters(p.formato);
    const totalLiters = p.cantidad_programada * litersPerUnit;
    const isWater = (p.family || "").toLowerCase().includes("agua") || (p.item_name || "").toLowerCase().includes("agua");
    console.log(`SKU: ${p.product_sku} | Name: ${p.item_name} | Qty: ${p.cantidad_programada} | Format: ${p.formato} (${litersPerUnit} L) | Total: ${totalLiters} L | IsWater (filter): ${isWater}`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
