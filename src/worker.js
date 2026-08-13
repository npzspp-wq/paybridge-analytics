const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    ...JSON_HEADERS,
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

function json(request, payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: corsHeaders(request)
  });
}

function cleanText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request)
      });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return json(request, {
        ok: true,
        service: "PAYBRIDGE Analytics",
        status: "running",
        storage: "d1"
      });
    }

    if (request.method === "POST" && url.pathname === "/event") {
      try {
        const body = await request.json();
        const eventType = cleanText(body.type || body.event_type, 50);
        const route = cleanText(body.route, 80);
        const provider = cleanText(body.provider, 50);
        const source = cleanText(body.source || [route, provider].filter(Boolean).join(" | "), 150);
        const currency = cleanText(body.currency, 10).toUpperCase();
        const amount = normalizeAmount(body.amount);

        if (!eventType) {
          return json(request, { ok: false, error: "event_type_required" }, 400);
        }

        const result = await env.paybridge_analytics_db
          .prepare(
            "INSERT INTO events (event_type, source, amount, currency) VALUES (?, ?, ?, ?)"
          )
          .bind(eventType, source || null, amount, currency || null)
          .run();

        return json(
          request,
          {
            ok: true,
            accepted: true,
            id: result.meta?.last_row_id ?? null
          },
          202
        );
      } catch (error) {
        console.error("PAYBRIDGE_EVENT_WRITE_FAILED", error);
        return json(request, { ok: false, error: "event_write_failed" }, 500);
      }
    }

    if (request.method === "GET" && url.pathname === "/summary") {
      try {
        const totals = await env.paybridge_analytics_db
          .prepare(
            "SELECT COUNT(*) AS events, COUNT(DISTINCT source) AS sources, MAX(created_at) AS last_event_at FROM events"
          )
          .first();

        const byType = await env.paybridge_analytics_db
          .prepare(
            "SELECT event_type, COUNT(*) AS count FROM events GROUP BY event_type ORDER BY count DESC, event_type ASC LIMIT 25"
          )
          .all();

        const byCurrency = await env.paybridge_analytics_db
          .prepare(
            "SELECT currency, COUNT(*) AS count, ROUND(SUM(COALESCE(amount, 0)), 2) AS amount FROM events WHERE currency IS NOT NULL AND currency <> '' GROUP BY currency ORDER BY count DESC, currency ASC LIMIT 25"
          )
          .all();

        return json(request, {
          ok: true,
          totals: totals || { events: 0, sources: 0, last_event_at: null },
          byType: byType.results || [],
          byCurrency: byCurrency.results || []
        });
      } catch (error) {
        console.error("PAYBRIDGE_SUMMARY_FAILED", error);
        return json(request, { ok: false, error: "summary_failed" }, 500);
      }
    }

    if (request.method === "GET" && url.pathname === "/events") {
      try {
        const limitRaw = Number(url.searchParams.get("limit") || 50);
        const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 50, 200));

        const rows = await env.paybridge_analytics_db
          .prepare(
            "SELECT id, event_type, source, amount, currency, created_at FROM events ORDER BY id DESC LIMIT ?"
          )
          .bind(limit)
          .all();

        return json(request, {
          ok: true,
          events: rows.results || []
        });
      } catch (error) {
        console.error("PAYBRIDGE_EVENTS_READ_FAILED", error);
        return json(request, { ok: false, error: "events_read_failed" }, 500);
      }
    }

    return json(request, { ok: false, error: "not_found" }, 404);
  }
};
