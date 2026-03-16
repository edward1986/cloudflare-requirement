const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
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

function sanitizeFileName(name) {
  return (name || "")
    .trim()
    .replace(/[\/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...CORS_HEADERS,
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    if (request.method === "GET" && url.pathname.startsWith("/files/")) {
      return handleFileProxy(request, env, url);
    }

    if (request.method === "POST" && url.pathname === "/upload") {
      return handleUpload(request, env);
    }

    if (request.method === "POST" && url.pathname === "/upload-json") {
      return handleUploadJson(request, env, url);
    }

    return jsonResponse({ error: "Not found" }, 404);
  },
};

async function handleUploadJson(request, env, url) {
  const requestedName = url.searchParams.get("name");

  if (!requestedName) {
    return jsonResponse({ error: "Missing required query param: name" }, 400);
  }

  const safeName = sanitizeFileName(requestedName);
  const key = safeName.endsWith(".json") ? safeName : `${safeName}.json`;

  const bytes = await request.arrayBuffer();

  await env.R2_BUCKET.put(key, bytes, {
    httpMetadata: { contentType: "application/json" },
  });

  const origin = new URL(request.url).origin;
  const fileUrl = `${origin}/files/${encodeURIComponent(key)}`;

  return jsonResponse(
    {
      key,
      original: fileUrl,
    },
    200
  );
}

async function handleUpload(request, env) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return jsonResponse({ error: "Expected multipart/form-data" }, 400);
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const requestedName = formData.get("name");

  if (!file || typeof file === "string") {
    return jsonResponse({ error: "Missing uploaded file field: file" }, 400);
  }

  let safeName = "";
  if (requestedName && typeof requestedName === "string") {
    safeName = sanitizeFileName(requestedName);
  } else {
    safeName = sanitizeFileName(file.name);
  }

  const key = safeName;

  await env.R2_BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });

  const origin = new URL(request.url).origin;
  const fileUrl = `${origin}/files/${encodeURIComponent(key)}`;

  return jsonResponse(
    {
      key,
      original: fileUrl,
      thumb: fileUrl,
      small: fileUrl,
      medium: fileUrl,
      large: fileUrl,
      xlarge: fileUrl,
    },
    200
  );
}

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

  if (obj.size != null) {
    headers["Content-Length"] = obj.size.toString();
  }

  return new Response(obj.body, {
    status: 200,
    headers,
  });
}
