# PAYBRIDGE Analytics

Cloudflare Worker for PAYBRIDGE analytics, backed by Cloudflare D1.

## Endpoints

- `GET /` — health/status check.
- `POST /event` — store an analytics event in D1.
- `GET /summary` — aggregated event totals by type and currency.
- `GET /events?limit=50` — recent events, maximum 200 rows.

## Event payload

```json
{
  "type": "comparison",
  "route": "Germany -> United Kingdom",
  "provider": "Wise",
  "amount": 25000,
  "currency": "EUR"
}
```

The Worker uses the D1 binding `paybridge_analytics_db` configured in `wrangler.jsonc`.

## Deploy

```bash
npm install
npx wrangler deploy
```

The D1 database schema currently expected by the Worker is:

```sql
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  source TEXT,
  amount REAL,
  currency TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```
Cloudflare automatic deployment enabled.
