import { createClient } from "@libsql/client";

const db = createClient({ url: "file:local.db" });

async function run() {
  try {
    const result = await db.execute({
      sql: "INSERT INTO products (sku, item_name, ean13, dun14, marca) VALUES (?, ?, ?, ?, ?)",
      args: ['1994', 'AROMATIZANTE BLACK INTENSE 500CC', '7804630753106', '17804630753103', 'AGUACOL'],
    });
    console.log("Success:", result);
  } catch (err) {
    console.error("FAIL:", err);
  }
}

run();
