import { createClient } from "@libsql/client";

const client = createClient({
  url: "libsql://unicodiq-ichidoro.aws-us-east-1.turso.io",
  authToken: "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODA5NTA0OTMsImlkIjoiMDE5ZWE4ZWItY2QwMS03ODliLWJlOTMtZGZkMGY1YzFjMjJlIiwicmlkIjoiZTJhYzM5YzEtYjhhMS00NzFmLTk3YjctN2YyNjg5ZGFjZjAwIn0.iNI0xsEowQvZt4PoD4mcxrjfzyxwgU5tmY0VZ1yZImyB7IBZ_FihHAU5n7Acc6npckKP0C5xuziIOuW3lAa9Ag"
});

async function main() {
  const zpl = "^XA\n^PW800\n^JUS\n^XZ\n";
  const result = await client.execute({
    sql: "INSERT INTO print_queue (bridgeId, zpl, printerName, status) VALUES (?, ?, ?, 'pending')",
    args: ["bridge-Produccion-192.168.1.112", zpl, "Zebra Derecha"]
  });
  console.log("Configuration job successfully queued!", result);
}

main().catch(console.error);
