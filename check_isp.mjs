import { createClient } from "@libsql/client";

const db = createClient({
  url: "libsql://unicodiq-ichidoro.aws-us-east-1.turso.io",
  authToken: "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODA5NTA0OTMsImlkIjoiMDE5ZWE4ZWItY2QwMS03ODliLWJlOTMtZGZkMGY1YzFjMjJlIiwicmlkIjoiZTJhYzM5YzEtYjhhMS00NzFmLTk3YjctN2YyNjg5ZGFjZjAwIn0.iNI0xsEowQvZt4PoD4mcxrjfzyxwgU5tmY0VZ1yZImyB7IBZ_FihHAU5n7Acc6npckKP0C5xuziIOuW3lAa9Ag",
});

const r = await db.execute("SELECT id, sku, item_name, isp FROM products WHERE isp IS NOT NULL AND isp != '' LIMIT 20");
console.log("Productos con ISP guardado:", r.rows.length);
for (const row of r.rows) {
  console.log("  ID:" + row.id + " SKU:" + row.sku + " - " + row.item_name + " - ISP: [" + row.isp + "]");
}

if (r.rows.length === 0) {
  // Check total products
  const total = await db.execute("SELECT COUNT(*) as cnt FROM products");
  console.log("Total productos en DB:", total.rows[0].cnt);
  
  // Check schema
  const schema = await db.execute("PRAGMA table_info(products)");
  const cols = schema.rows.map(r => r.name);
  console.log("Columnas:", cols.join(", "));
}
