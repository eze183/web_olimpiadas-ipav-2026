const { getStore } = require("@netlify/blobs");

const STORE_NAME = "resultados-olimpiadas";

exports.handler = async (event) => {
  const store = getStore({
    name: STORE_NAME,
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_BLOBS_TOKEN,
  });
  const adminToken = event.headers["x-admin-token"] || event.headers["X-Admin-Token"];

  if (event.httpMethod === "GET") {
    if (adminToken !== undefined && adminToken !== process.env.ADMIN_PASSWORD) {
      return { statusCode: 401, body: JSON.stringify({ error: "Contraseña incorrecta" }) };
    }
    const { blobs } = await store.list();
    const items = await Promise.all(
      blobs.map(async (b) => await store.get(b.key, { type: "json" }))
    );
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(items.filter(Boolean)),
    };
  }

  if (event.httpMethod === "POST" || event.httpMethod === "DELETE") {
    if (!process.env.ADMIN_PASSWORD || adminToken !== process.env.ADMIN_PASSWORD) {
      return { statusCode: 401, body: JSON.stringify({ error: "No autorizado" }) };
    }

    let data;
    try {
      data = JSON.parse(event.body || "{}");
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: "JSON inválido" }) };
    }
    if (!data.key) {
      return { statusCode: 400, body: JSON.stringify({ error: "Falta la clave (key)" }) };
    }

    if (event.httpMethod === "DELETE") {
      await store.delete(data.key);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    if (!data.day || !data.discipline || !data.category || !data.type) {
      return { statusCode: 400, body: JSON.stringify({ error: "Datos incompletos" }) };
    }
    await store.setJSON(data.key, data);
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 405, body: "Method Not Allowed" };
};
