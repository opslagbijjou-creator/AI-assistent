const { processChatPayload, normalizeError } = require("../../server");

const BASE_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: BASE_HEADERS,
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: BASE_HEADERS,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const parsedBody = event.body ? JSON.parse(event.body) : {};
    const payload = await processChatPayload(parsedBody);

    return {
      statusCode: 200,
      headers: BASE_HEADERS,
      body: JSON.stringify(payload),
    };
  } catch (error) {
    const statusCode = Number(error?.statusCode || 500);
    return {
      statusCode,
      headers: BASE_HEADERS,
      body: JSON.stringify(normalizeError(error)),
    };
  }
};
