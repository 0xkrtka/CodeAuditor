/**
 * CodeAuditor Backend Service
 * ─────────────────────────────────────────────────────
 * • Indexes AuditCompleted events from Ritual Chain
 * • Exposes REST endpoints for audit history
 * • Proxies SSE streams from Ritual RPC (CORS bridge)
 *
 * Run: npx ts-node src/index.ts
 * Env: AUDITOR_ADDRESS, PORT (default 3001)
 */

import * as http   from "http";
import * as https  from "https";
import { createPublicClient, http as viemHttp, parseAbiItem, webSocket } from "viem";
import { ritualChain } from "./ritual-chain";

// ── Chain client ──────────────────────────────────────────────────────────────
const publicClient = createPublicClient({
  chain:     ritualChain,
  transport: viemHttp("https://rpc.ritualfoundation.org"),
});

// ── WebSocket client for live event subscription ──────────────────────────────
let wsClient: ReturnType<typeof createPublicClient> | null = null;
try {
  wsClient = createPublicClient({
    chain:     ritualChain,
    transport: webSocket("wss://rpc.ritualfoundation.org/ws"),
  });
} catch {
  console.warn("WebSocket client init failed; live subscription disabled.");
}

// ── In-memory store ───────────────────────────────────────────────────────────
interface IndexedAudit {
  auditId:       string;
  requester:     string;
  severityScore: number;
  tokensCost:    string;
  txHash:        string;
  blockNumber:   string;
  timestamp:     number;
}

const auditIndex: Map<string, IndexedAudit>  = new Map();
const byUser:     Map<string, Set<string>>   = new Map();
let   startTime   = Date.now();
let   indexedAt   = 0;

// ── Contract address ──────────────────────────────────────────────────────────
const AUDITOR_ADDRESS = (
  process.env.AUDITOR_ADDRESS ??
  "0x0000000000000000000000000000000000000000"
) as `0x${string}`;

const auditCompletedAbi = parseAbiItem(
  "event AuditCompleted(uint256 indexed auditId, address indexed requester, uint8 severityScore, uint256 tokensCost)"
);

// ── Index historical events ───────────────────────────────────────────────────
async function indexHistoricalEvents() {
  if (AUDITOR_ADDRESS === "0x0000000000000000000000000000000000000000") {
    console.warn("AUDITOR_ADDRESS not set — skipping historical index");
    return;
  }

  console.log(`Indexing AuditCompleted events for ${AUDITOR_ADDRESS}…`);

  try {
    const logs = await publicClient.getLogs({
      address:   AUDITOR_ADDRESS,
      event:     auditCompletedAbi,
      fromBlock: 0n,
      toBlock:   "latest",
    });

    for (const log of logs) {
      let blockTimestamp = Math.floor(Date.now() / 1000);
      try {
        const block = await publicClient.getBlock({ blockNumber: log.blockNumber! });
        blockTimestamp = Number(block.timestamp);
      } catch { /* ignore */ }

      const audit: IndexedAudit = {
        auditId:       log.args.auditId!.toString(),
        requester:     log.args.requester!.toLowerCase(),
        severityScore: Number(log.args.severityScore!),
        tokensCost:    log.args.tokensCost!.toString(),
        txHash:        log.transactionHash ?? "",
        blockNumber:   log.blockNumber?.toString() ?? "",
        timestamp:     blockTimestamp,
      };

      storeAudit(audit);
    }

    indexedAt = Date.now();
    console.log(`✅ Indexed ${auditIndex.size} historical audits`);
  } catch (err) {
    console.error("Historical indexing error:", err);
  }
}

function storeAudit(audit: IndexedAudit) {
  auditIndex.set(audit.auditId, audit);
  const set = byUser.get(audit.requester) ?? new Set();
  set.add(audit.auditId);
  byUser.set(audit.requester, set);
}

// ── Live event subscription ───────────────────────────────────────────────────
function subscribeToEvents() {
  if (!wsClient) return;

  wsClient.watchEvent({
    address: AUDITOR_ADDRESS,
    event:   auditCompletedAbi,
    onLogs: async (logs) => {
      for (const log of logs) {
        let blockTimestamp = Math.floor(Date.now() / 1000);
        try {
          const block = await publicClient.getBlock({ blockNumber: log.blockNumber! });
          blockTimestamp = Number(block.timestamp);
        } catch { /* ignore */ }

        const audit: IndexedAudit = {
          auditId:       log.args.auditId!.toString(),
          requester:     log.args.requester!.toLowerCase(),
          severityScore: Number(log.args.severityScore!),
          tokensCost:    log.args.tokensCost!.toString(),
          txHash:        log.transactionHash ?? "",
          blockNumber:   log.blockNumber?.toString() ?? "",
          timestamp:     blockTimestamp,
        };

        storeAudit(audit);
        console.log(`📡 New audit indexed: #${audit.auditId} by ${audit.requester.slice(0, 8)}… score=${audit.severityScore}`);
      }
    },
    onError: (err) => {
      console.error("WS event error:", err);
    },
  });

  console.log("Listening for live AuditCompleted events…");
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

function setCors(res: http.ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res: http.ServerResponse, data: unknown, status = 200) {
  setCors(res);
  res.setHeader("Content-Type", "application/json");
  res.writeHead(status);
  res.end(JSON.stringify(data, null, 2));
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url!, `http://localhost:${PORT}`);

  // Preflight
  if (req.method === "OPTIONS") {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /health
  if (url.pathname === "/health") {
    return json(res, {
      ok:      true,
      indexed: auditIndex.size,
      uptime:  Math.floor((Date.now() - startTime) / 1000),
      address: AUDITOR_ADDRESS,
    });
  }

  // GET /stats
  if (url.pathname === "/stats") {
    const allAudits = Array.from(auditIndex.values());
    const avgScore  = allAudits.length
      ? Math.round(allAudits.reduce((s, a) => s + a.severityScore, 0) / allAudits.length)
      : 0;

    const bySeverity = {
      critical: allAudits.filter((a) => a.severityScore <= 20).length,
      high:     allAudits.filter((a) => a.severityScore > 20 && a.severityScore <= 40).length,
      medium:   allAudits.filter((a) => a.severityScore > 40 && a.severityScore <= 60).length,
      low:      allAudits.filter((a) => a.severityScore > 60 && a.severityScore <= 80).length,
      clean:    allAudits.filter((a) => a.severityScore > 80).length,
    };

    return json(res, {
      totalAudits:  auditIndex.size,
      uniqueUsers:  byUser.size,
      avgScore,
      bySeverity,
      indexedAt,
    });
  }

  // GET /audits — paginated
  if (url.pathname === "/audits") {
    const page  = Math.max(1, parseInt(url.searchParams.get("page")  ?? "1"));
    const limit = Math.min(100, parseInt(url.searchParams.get("limit") ?? "20"));
    const all   = Array.from(auditIndex.values()).sort((a, b) => b.timestamp - a.timestamp);
    const start = (page - 1) * limit;

    return json(res, {
      total: all.length,
      page,
      limit,
      pages: Math.ceil(all.length / limit),
      items: all.slice(start, start + limit),
    });
  }

  // GET /audits/:id
  const auditMatch = url.pathname.match(/^\/audits\/(\d+)$/);
  if (auditMatch) {
    const audit = auditIndex.get(auditMatch[1]);
    if (!audit) return json(res, { error: "Audit not found" }, 404);
    return json(res, audit);
  }

  // GET /users/:address/audits
  const userMatch = url.pathname.match(/^\/users\/(0x[a-fA-F0-9]{40})\/audits$/);
  if (userMatch) {
    const addr  = userMatch[1].toLowerCase();
    const ids   = Array.from(byUser.get(addr) ?? []);
    const items = ids
      .map((id) => auditIndex.get(id))
      .filter(Boolean)
      .sort((a, b) => (b?.timestamp ?? 0) - (a?.timestamp ?? 0));

    return json(res, { total: items.length, items });
  }

  // GET /sse/:jobId — HTTPS proxy to Ritual RPC SSE endpoint
  const sseMatch = url.pathname.match(/^\/sse\/(.+)$/);
  if (sseMatch) {
    res.setHeader("Content-Type",  "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection",    "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Nginx compatibility
    setCors(res);
    res.writeHead(200);

    const ritualSseUrl = `https://rpc.ritualfoundation.org/sse/${sseMatch[1]}`;

    // Use https (not http) — Ritual RPC is HTTPS
    const upstream = https.get(ritualSseUrl, (upstreamRes) => {
      upstreamRes.pipe(res, { end: true });
      upstreamRes.on("error", () => {
        try { res.end(); } catch { /* ignore */ }
      });
    });

    upstream.on("error", (err) => {
      console.error("SSE proxy error:", err.message);
      try { res.end(`data: ${JSON.stringify({ error: err.message })}\n\n`); } catch { /* ignore */ }
    });

    req.on("close", () => {
      upstream.destroy();
    });

    return;
  }

  // 404
  json(res, { error: "Not found", path: url.pathname }, 404);
});

// ── Start ─────────────────────────────────────────────────────────────────────
(async () => {
  startTime = Date.now();
  await indexHistoricalEvents();
  subscribeToEvents();

  server.listen(PORT, () => {
    console.log(`\n🚀 CodeAuditor backend running on http://localhost:${PORT}`);
    console.log(`   GET /health`);
    console.log(`   GET /stats`);
    console.log(`   GET /audits[?page=1&limit=20]`);
    console.log(`   GET /audits/:id`);
    console.log(`   GET /users/:address/audits`);
    console.log(`   GET /sse/:jobId   (HTTPS proxy to Ritual RPC)`);
    console.log(`\n   Auditor contract: ${AUDITOR_ADDRESS}\n`);
  });
})();
