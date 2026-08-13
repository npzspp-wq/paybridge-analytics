export default {
  async fetch(request) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json; charset=utf-8"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(
        JSON.stringify({
          ok: true,
          service: "PAYBRIDGE Analytics",
          status: "running"
        }),
        { headers: corsHeaders }
      );
    }

    if (request.method === "POST" && url.pathname === "/event") {
      try {
        const body = await request.json();

        const event = {
          type: String(body.type || "").slice(0, 50),
          route: String(body.route || "").slice(0, 100),
          currency: String(body.currency || "").slice(0, 10),
          amountBand: String(body.amountBand || "").slice(0, 30),
          provider: String(body.provider || "").slice(0, 50),
          time: new Date().toISOString()
        };

        console.log("PAYBRIDGE_EVENT", JSON.stringify(event));

        return new Response(
          JSON.stringify({
            ok: true,
            accepted: true
          }),
          {
            status: 202,
            headers: corsHeaders
          }
        );
      } catch {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "invalid_json"
          }),
          {
            status: 400,
            headers: corsHeaders
          }
        );
      }
    }

    return new Response(
      JSON.stringify({
        ok: false,
        error: "not_found"
      }),
      {
        status: 404,
        headers: corsHeaders
      }
    );
  }
};