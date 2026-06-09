import { createClient } from "@libsql/client";

const db = createClient({ url: "file:local.db" });

async function run() {
  const result = await db.execute("SELECT * FROM products");
  console.log(result.rows);
}

run();
