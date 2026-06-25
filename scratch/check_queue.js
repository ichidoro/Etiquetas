import { createClient } from "@libsql/client";

const client = createClient({
  url: "libsql://unicodiq-ichidoro.aws-us-east-1.turso.io",
  authToken: "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODA5NTA0OTMsImlkIjoiMDE5ZWE4ZWItY2QwMS03ODliLWJlOTMtZGZkMGY1YzFjMjJlIiwicmlkIjoiZTJhYzM5YzEtYjhhMS00NzFmLTk3YjctN2YyNjg5ZGFjZjAwIn0.iNI0xsEowQvZt4PoD4mcxrjfzyxwgU5tmY0VZ1yZImyB7IBZ_FihHAU5n7Acc6npckKP0C5xuziIOuW3lAa9Ag"
});

async function main() {
  const result = await client.execute("SELECT * FROM print_queue ORDER BY id DESC LIMIT 5");
  console.log(JSON.stringify(result.rows, null, 2));
}

main().catch(console.error);
