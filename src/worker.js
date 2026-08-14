const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const WISE_BASE_URL = "https://api.wise-sandbox.com";
const AIRWALLEX_BASE_URL = "https://api.sandbox.airwallex.com";

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  return { ...JSON_HEADERS, "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" };
}
function json(request, payload, status = 200) { return new Response(JSON.stringify(payload), { status, headers: corsHeaders(request) }); }
function cleanText(value, maxLength) { return String(value ?? "").trim().slice(0, maxLength); }
function normalizeAmount(value) { if (value === null || value === undefined || value === "") return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
function correlationId() { return crypto.randomUUID(); }

async function wiseFetch(env, path, options = {}) {
  if (!env.WISE_API_TOKEN) throw new Error("WISE_API_TOKEN_MISSING");
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${env.WISE_API_TOKEN}`);
  headers.set("X-External-Correlation-Id", correlationId());
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${WISE_BASE_URL}${path}`, { ...options, headers });
}
async function getWiseBusinessProfile(env) {
  const response = await wiseFetch(env, "/v2/profiles");
  const data = await response.json().catch(() => null);
  if (!response.ok) { const e = new Error("WISE_PROFILES_FAILED"); e.status = response.status; e.details = data; throw e; }
  const profiles = Array.isArray(data) ? data : [];
  return profiles.find(p => String(p?.type || "").toLowerCase() === "business") || profiles.find(p => p?.details?.name || p?.details?.businessName) || profiles[0] || null;
}
function selectWisePaymentOption(quote) {
  const options = Array.isArray(quote?.paymentOptions) ? quote.paymentOptions : [];
  return options.find(i => !i?.disabled && i?.payIn === "BANK_TRANSFER") || options.find(i => !i?.disabled) || options[0] || null;
}
function wiseFeeAmount(option) {
  const total = option?.fee?.total;
  if (typeof total === "number") return total;
  if (total && typeof total === "object" && Number.isFinite(Number(total.amount))) return Number(total.amount);
  const v = option?.price?.total?.value?.amount;
  return Number.isFinite(Number(v)) ? Number(v) : null;
}
async function createWiseQuote(env, sourceCurrency, targetCurrency, sourceAmount) {
  const profile = await getWiseBusinessProfile(env);
  if (!profile?.id) { const e = new Error("WISE_PROFILE_NOT_FOUND"); e.status = 502; throw e; }
  const response = await wiseFetch(env, `/v3/profiles/${profile.id}/quotes`, { method: "POST", body: JSON.stringify({ sourceCurrency, targetCurrency, sourceAmount, targetAmount: null, targetAccount: null }) });
  const quote = await response.json().catch(() => null);
  if (!response.ok) { const e = new Error("WISE_QUOTE_FAILED"); e.status = response.status; e.details = quote?.errors || quote || null; throw e; }
  const option = selectWisePaymentOption(quote);
  return { ok:true, provider:"wise", environment:"sandbox", quoteId:quote.id||null, sourceCurrency:quote.sourceCurrency||sourceCurrency, targetCurrency:quote.targetCurrency||targetCurrency, sourceAmount:quote.sourceAmount??sourceAmount, targetAmount:option?.targetAmount??quote.targetAmount??null, rate:quote.rate??null, fee:wiseFeeAmount(option), feePercentage:option?.feePercentage??null, payIn:option?.payIn??quote.preferredPayIn??null, payOut:option?.payOut??quote.payOut??null, estimatedDelivery:option?.estimatedDelivery??null, formattedEstimatedDelivery:option?.formattedEstimatedDelivery??null, rateExpirationTime:quote.rateExpirationTime??null, expirationTime:quote.expirationTime??null, status:quote.status??null };
}

async function getAirwallexAccessToken(env) {
  if (!env.AIRWALLEX_API_KEY) throw new Error("AIRWALLEX_API_KEY_MISSING");
  if (!env.AIRWALLEX_CLIENT_ID) throw new Error("AIRWALLEX_CLIENT_ID_MISSING");
  const response = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/authentication/login`, { method:"POST", headers:{ "Content-Type":"application/json", "x-api-key":env.AIRWALLEX_API_KEY, "x-client-id":env.AIRWALLEX_CLIENT_ID } });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.token) { const e = new Error("AIRWALLEX_AUTH_FAILED"); e.status = response.status; e.details = data; throw e; }
  return data;
}
async function airwallexFetch(env, path, options = {}) {
  const auth = await getAirwallexAccessToken(env);
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${auth.token}`);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${AIRWALLEX_BASE_URL}${path}`, { ...options, headers });
}
async function getAirwallexBalances(env) {
  const response = await airwallexFetch(env, "/api/v1/balances/current");
  const data = await response.json().catch(() => null);
  if (!response.ok) { const e = new Error("AIRWALLEX_BALANCES_FAILED"); e.status=response.status; e.details=data; throw e; }
  return data;
}

export default { async fetch(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status:204, headers:corsHeaders(request) });
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/") return json(request, { ok:true, service:"PAYBRIDGE Analytics", status:"running", storage:"d1", wiseSandbox:Boolean(env.WISE_API_TOKEN), airwallexSandbox:Boolean(env.AIRWALLEX_API_KEY && env.AIRWALLEX_CLIENT_ID) });

  if (request.method === "GET" && url.pathname === "/airwallex/status") {
    try {
      const auth = await getAirwallexAccessToken(env);
      const balances = await getAirwallexBalances(env);
      return json(request, { ok:true, provider:"airwallex", environment:"sandbox", connected:true, tokenExpiresAt:auth.expires_at||null, balances:balances?.available_amount||balances?.balances||balances||null });
    } catch (error) {
      console.error("AIRWALLEX_STATUS_FAILED", error);
      return json(request, { ok:false, provider:"airwallex", environment:"sandbox", connected:false, error:error.message||"airwallex_status_failed", upstreamStatus:error.status||null, details:error.details||null }, error.status && error.status >= 400 && error.status < 600 ? error.status : 502);
    }
  }

  if (request.method === "GET" && url.pathname === "/wise/status") {
    try { const profile=await getWiseBusinessProfile(env); if(!profile) return json(request,{ok:false,provider:"wise",error:"no_profile"},404); return json(request,{ok:true,provider:"wise",environment:"sandbox",connected:true,profileId:profile.id,profileType:profile.type||null,profileName:profile.details?.name||profile.details?.businessName||null}); }
    catch(error){ console.error("WISE_STATUS_FAILED",error); return json(request,{ok:false,provider:"wise",environment:"sandbox",error:error.message||"wise_status_failed",upstreamStatus:error.status||null},error.status||502); }
  }
  if (request.method === "GET" && url.pathname === "/wise/quote-test") {
    try { const sourceCurrency=cleanText(url.searchParams.get("source")||"EUR",3).toUpperCase(); const targetCurrency=cleanText(url.searchParams.get("target")||"GBP",3).toUpperCase(); const sourceAmount=normalizeAmount(url.searchParams.get("amount")||1000); if(!/^[A-Z]{3}$/.test(sourceCurrency)||!/^[A-Z]{3}$/.test(targetCurrency)) return json(request,{ok:false,error:"invalid_currency"},400); if(!sourceAmount||sourceAmount<=0) return json(request,{ok:false,error:"invalid_amount"},400); return json(request,await createWiseQuote(env,sourceCurrency,targetCurrency,sourceAmount)); }
    catch(error){ return json(request,{ok:false,provider:"wise",environment:"sandbox",error:error.message||"wise_quote_test_failed",upstreamStatus:error.status||null,details:error.details||null},error.status&&error.status>=400&&error.status<600?error.status:502); }
  }
  if (request.method === "POST" && url.pathname === "/wise/quote") {
    try { const body=await request.json(); const sourceCurrency=cleanText(body.sourceCurrency||body.source,3).toUpperCase(); const targetCurrency=cleanText(body.targetCurrency||body.target,3).toUpperCase(); const sourceAmount=normalizeAmount(body.sourceAmount??body.amount); if(!/^[A-Z]{3}$/.test(sourceCurrency)||!/^[A-Z]{3}$/.test(targetCurrency)) return json(request,{ok:false,error:"invalid_currency"},400); if(!sourceAmount||sourceAmount<=0) return json(request,{ok:false,error:"invalid_amount"},400); return json(request,await createWiseQuote(env,sourceCurrency,targetCurrency,sourceAmount)); }
    catch(error){ return json(request,{ok:false,provider:"wise",error:error.message||"wise_quote_failed",upstreamStatus:error.status||null,details:error.details||null},error.status&&error.status>=400&&error.status<600?error.status:502); }
  }
  if (request.method === "POST" && url.pathname === "/event") {
    try { const body=await request.json(); const eventType=cleanText(body.type||body.event_type,50); const route=cleanText(body.route,80); const provider=cleanText(body.provider,50); const source=cleanText(body.source||[route,provider].filter(Boolean).join(" | "),150); const currency=cleanText(body.currency,10).toUpperCase(); const amount=normalizeAmount(body.amount); if(!eventType) return json(request,{ok:false,error:"event_type_required"},400); const result=await env.paybridge_analytics_db.prepare("INSERT INTO events (event_type, source, amount, currency) VALUES (?, ?, ?, ?)").bind(eventType,source||null,amount,currency||null).run(); return json(request,{ok:true,accepted:true,id:result.meta?.last_row_id??null},202); }
    catch(error){ console.error("PAYBRIDGE_EVENT_WRITE_FAILED",error); return json(request,{ok:false,error:"event_write_failed"},500); }
  }
  if (request.method === "GET" && url.pathname === "/summary") {
    try { const totals=await env.paybridge_analytics_db.prepare("SELECT COUNT(*) AS events, COUNT(DISTINCT source) AS sources, MAX(created_at) AS last_event_at FROM events").first(); const byType=await env.paybridge_analytics_db.prepare("SELECT event_type, COUNT(*) AS count FROM events GROUP BY event_type ORDER BY count DESC, event_type ASC LIMIT 25").all(); const byCurrency=await env.paybridge_analytics_db.prepare("SELECT currency, COUNT(*) AS count, ROUND(SUM(COALESCE(amount, 0)), 2) AS amount FROM events WHERE currency IS NOT NULL AND currency <> '' GROUP BY currency ORDER BY count DESC, currency ASC LIMIT 25").all(); return json(request,{ok:true,totals:totals||{events:0,sources:0,last_event_at:null},byType:byType.results||[],byCurrency:byCurrency.results||[]}); }
    catch(error){ return json(request,{ok:false,error:"summary_failed"},500); }
  }
  if (request.method === "GET" && url.pathname === "/events") {
    try { const limitRaw=Number(url.searchParams.get("limit")||50); const limit=Math.max(1,Math.min(Number.isFinite(limitRaw)?limitRaw:50,200)); const rows=await env.paybridge_analytics_db.prepare("SELECT id, event_type, source, amount, currency, created_at FROM events ORDER BY id DESC LIMIT ?").bind(limit).all(); return json(request,{ok:true,events:rows.results||[]}); }
    catch(error){ return json(request,{ok:false,error:"events_read_failed"},500); }
  }
  return json(request,{ok:false,error:"not_found"},404);
}};
