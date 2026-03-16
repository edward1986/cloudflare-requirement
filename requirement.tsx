const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*", // or specific origin
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Requested-With, CreatedAt, createdat",
};

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...CORS_HEADERS,
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // 🔁 Reverse-proxy route for files
    if (request.method === "GET" && url.pathname.startsWith("/files/")) {
      return handleFileProxy(request, env, url);
    }

    // Upload endpoint
    if (request.method === "POST" && url.pathname === "/upload") {
      return handleUpload(request, env);
    }
    if (request.method === "POST" && url.pathname === "/upload-json") {
      const name = url.searchParams.get("name") || "snapshot.json";
      const bytes = await request.arrayBuffer();
    
      const now = new Date();
      const ts = now.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
      const rand = Math.floor(Math.random() * 1_000_000_000).toString().padStart(9, "0");
      const key = `${ts}_${rand}-${name}`;
    
      await env.R2_BUCKET.put(key, bytes, {
        httpMetadata: { contentType: "application/json" },
      });
    
      const origin = new URL(request.url).origin;
      const fileUrl = `${origin}/files/${encodeURIComponent(key)}`;
      return jsonResponse({ original: fileUrl }, 200);
    }
    return jsonResponse({ error: "Not found" }, 404);
  },
};

async function handleUpload(request, env) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return jsonResponse({ error: "Expected multipart/form-data" }, 400);
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!file || typeof file === "string") {
    return jsonResponse({ error: "Missing uploaded file field: file" }, 400);
  }

  // create a unique key
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const rand = Math.floor(Math.random() * 1_000_000_000)
    .toString()
    .padStart(9, "0");
  const safeName = file.name; // keep spaces as spaces
  const key = `${ts}_${rand}-${safeName}`;

  // store in R2
  await env.R2_BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });

  // 🔁 Build URL pointing to THIS worker, not the R2 public URL
  const origin = new URL(request.url).origin; // e.g. https://edge7-requirements...workers.dev
  const fileUrl = `${origin}/files/${encodeURIComponent(key)}`;

  const payload = {
    original: fileUrl,
    thumb: fileUrl,
    small: fileUrl,
    medium: fileUrl,
    large: fileUrl,
    xlarge: fileUrl,
  };

  return jsonResponse(payload, 200);
}




// 🔁 Reverse proxy: GET /files/:key → stream from R2
async function handleFileProxy(request, env, url) {
  const prefix = "/files/";
  const keyEncoded = url.pathname.slice(prefix.length);
  const key = decodeURIComponent(keyEncoded);

  const obj = await env.R2_BUCKET.get(key);
  if (!obj) {
    return new Response("Not found", {
      status: 404,
      headers: {
        ...CORS_HEADERS,
      },
    });
  }

  const headers = {
    ...CORS_HEADERS,
    "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream",
  };

  // Optional: add Content-Length if you want
  if (obj.size != null) {
    headers["Content-Length"] = obj.size.toString();
  }

  return new Response(obj.body, {
    status: 200,
    headers,
  });
}
