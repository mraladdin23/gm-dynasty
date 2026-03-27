// ─────────────────────────────────────────────────────────
//  GM Dynasty — MFL CORS Proxy (Cloudflare Worker)
//
//  MFL's API doesn't send CORS headers, so direct browser
//  requests get blocked. This lightweight Worker proxies
//  requests from your app to MFL and adds the right headers.
//
//  Deploy steps:
//    1. Create a free Cloudflare account → Workers
//    2. Create a new Worker, paste this code
//    3. Deploy → note your worker URL (e.g. mfl-proxy.yourname.workers.dev)
//    4. In js/mfl.js, set CORS_PROXY to your worker URL + "?"
//       e.g.  const CORS_PROXY = "https://mfl-proxy.yourname.workers.dev?url=";
//       (and update _url() accordingly — see note in mfl.js)
//
//  Alternatively, for a quick dev setup you can use:
//    https://corsproxy.io/?  (rate-limited, not for production)
// ─────────────────────────────────────────────────────────

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Expect: /proxy?url=https://api.myfantasyleague.com/...
    const target = url.searchParams.get("url");
    if (!target) {
      return new Response("Missing ?url= parameter", { status: 400 });
    }

    // Only allow MFL API domain
    const targetUrl = new URL(target);
    if (!targetUrl.hostname.endsWith("myfantasyleague.com")) {
      return new Response("Domain not allowed", { status: 403 });
    }

    try {
      const response = await fetch(target, {
        headers: {
          "User-Agent": "GMDynasty/1.0",
          "Accept":     "application/json"
        }
      });

      const body    = await response.text();
      const headers = new Headers(response.headers);

      // Add CORS headers so the browser allows the response
      headers.set("Access-Control-Allow-Origin",  "*");
      headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "Content-Type");

      return new Response(body, {
        status:  response.status,
        headers
      });
    } catch (err) {
      return new Response(`Proxy error: ${err.message}`, { status: 502 });
    }
  }
};
