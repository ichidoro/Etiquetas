async function run() {
  try {
    const res = await fetch("http://localhost:3000/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sku: "TEST-SKU-999",
        item_name: "Test item",
        ean13: "123",
        dun14: "456",
        marca: "TEST"
      })
    });
    console.log("Status:", res.status);
    console.log("Body:", await res.text());
  } catch (err) {
    console.log("Error:", err);
  }
}
run();
