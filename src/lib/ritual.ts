import { defineChain } from "viem";

// ─── Ritual Chain definition ──────────────────────────────────────────────────
export const ritualChain = defineChain({
  id: 1979,
  name: "Ritual Chain",
  nativeCurrency: {
    name: "Ritual",
    symbol: "RITUAL",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http:      ["https://rpc.ritualfoundation.org"],
      webSocket: ["wss://rpc.ritualfoundation.org/ws"],
    },
  },
  blockExplorers: {
    default: {
      name: "Ritual Explorer",
      url:  "https://explorer.ritualfoundation.org",
    },
  },
  testnet: true,
});

// ─── System contract addresses ────────────────────────────────────────────────
export const RITUAL_CONTRACTS = {
  LLM_PRECOMPILE:      "0x0000000000000000000000000000000000000802" as `0x${string}`,
  RITUAL_WALLET:       "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948" as `0x${string}`,
  ASYNC_JOB_TRACKER:   "0xC069FFCa0389f44eCA2C626e55491b0ab045AEF5" as `0x${string}`,
  TEE_SERVICE_REGISTRY:"0x9644e8562cE0Fe12b4deeC4163c064A8862Bf47F" as `0x${string}`,
  SCHEDULER:           "0x56e776BAE2DD60664b69Bd5F865F1180ffB7D58B" as `0x${string}`,
  SECRETS_ACL:         "0xf9BF1BC8A3e79B9EBeD0fa2Db70D0513fecE32FD" as `0x${string}`,
  ASYNC_DELIVERY:      "0x5A16214fF555848411544b005f7Ac063742f39F6" as `0x${string}`,
} as const;

// ─── Known active TEE executor (verified from ASYNC_DELIVERY on-chain logs) ───
// This executor has 500k+ transactions and 20M+ RITUAL balance — highly active.
// Used as fallback if defaultExecutor on contract is address(0).
// Source: getLogs on ASYNC_DELIVERY contract, cross-checked with RitualWallet balance.
export const KNOWN_EXECUTOR = "0x27E4Ddaaea7b54dA3Ef4997441493d9f0D3f4Aa5" as `0x${string}`;

// ─── SSE endpoint for streaming LLM tokens ───────────────────────────────────
export const SSE_BASE_URL = "https://rpc.ritualfoundation.org/sse";

/**
 * Build the SSE URL for a given jobId returned from LLM precompile.
 * The TEE executor pushes EIP-712 signed tokens over this stream.
 */
export function buildSseUrl(jobId: string): string {
  return `${SSE_BASE_URL}/${jobId}`;
}

// ─── CodeAuditor ABI (subset used by frontend) ───────────────────────────────
export const CODE_AUDITOR_ABI = [
  {
    name: "requestAudit",
    type: "function",
    stateMutability: "nonpayable",
    inputs:  [
      { name: "contractCode", type: "string" },
      { name: "executor",     type: "address" },
    ],
    outputs: [
      { name: "auditId", type: "uint256" },
      { name: "jobId",   type: "bytes32" },
    ],
  },
  {
    name: "getAudit",
    type: "function",
    stateMutability: "view",
    inputs:  [{ name: "auditId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "id",            type: "uint256" },
          { name: "requester",     type: "address" },
          { name: "codeHash",      type: "bytes32"  },
          { name: "auditResult",   type: "string"  },
          { name: "jobId",         type: "bytes32" },
          { name: "severityScore", type: "uint8"   },
          { name: "timestamp",     type: "uint256" },
          { name: "completed",     type: "bool"    },
        ],
      },
    ],
  },
  {
    name: "getMyAudits",
    type: "function",
    stateMutability: "view",
    inputs:  [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    name: "auditFee",
    type: "function",
    stateMutability: "view",
    inputs:  [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "AuditRequested",
    type: "event",
    inputs: [
      { name: "auditId",   type: "uint256", indexed: true  },
      { name: "requester", type: "address", indexed: true  },
      { name: "codeHash",  type: "bytes32", indexed: false },
      { name: "jobId",     type: "bytes32", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
  {
    name: "AuditCompleted",
    type: "event",
    inputs: [
      { name: "auditId",       type: "uint256", indexed: true  },
      { name: "requester",     type: "address", indexed: true  },
      { name: "severityScore", type: "uint8",   indexed: false },
    ],
  },
] as const;

// ─── ERC-20 approve ABI (for payment token) ───────────────────────────────────
export const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs:  [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs:  [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs:  [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
