# CodeAuditor — On-chain AI Smart Contract Security

> AI-powered Solidity auditing on **Ritual Chain** (Chain ID 1979).  
> LLM inference inside a TEE · SSE streaming · Pay-per-audit via X402 micropayments

---

## Architecture

```
User browser
│
├─► AuditForm.tsx          (wagmi + viem)
│     ├─ approve() payment token
│     └─ requestAudit(code) ──► CodeAuditor.sol
│                                    │
│                               LLM Precompile (0x0802)
│                               GLM-4.7-FP8 in TEE
│                                    │
│     ◄── SSE stream (jobId) ────────┘  EIP-712 signed tokens
│
└─► AuditResult.tsx        (live token rendering)

Backend (Node.js)
├─ Indexes AuditCompleted events via WS
├─ REST API: /audits, /users/:addr/audits
└─ SSE proxy: /sse/:jobId (CORS bridge)
```

---

## Quick Start

### 1. Contracts

```bash
cd contracts

# Install Foundry (if needed)
curl -L https://foundry.paradigm.xyz | bash && foundryup

# Install dependencies
forge install foundry-rs/forge-std

# Run tests (uses vm.etch to mock LLM precompile)
forge test -vvv

# Deploy to Ritual Chain
#   1. Edit script/Deploy.s.sol — set PAYMENT_TOKEN
#   2. Fund your wallet from the Ritual faucet
PRIVATE_KEY=0x... forge script script/Deploy.s.sol \
  --rpc-url https://rpc.ritualfoundation.org \
  --broadcast
```

### 2. Frontend

```bash
cd frontend
npm install

# Set env vars
cp .env.example .env.local
# Fill in NEXT_PUBLIC_AUDITOR_ADDRESS and NEXT_PUBLIC_PAYMENT_TOKEN

npm run dev
# → http://localhost:3000
```

### 3. Backend indexer

```bash
cd backend
npm install
AUDITOR_ADDRESS=0x... npx ts-node src/index.ts
# → http://localhost:3001
```

---

## Key Files

| File | Purpose |
|------|---------|
| `contracts/src/CodeAuditor.sol` | Main contract — calls LLM precompile, stores results |
| `contracts/test/CodeAuditor.t.sol` | Foundry tests with mock precompile |
| `contracts/script/Deploy.s.sol` | Deployment to Ritual Chain |
| `frontend/src/lib/ritual.ts` | Chain config, ABIs, SSE helpers |
| `frontend/src/hooks/useAudit.ts` | Approve → Submit → SSE flow |
| `frontend/src/components/AuditForm.tsx` | Main UI form |
| `frontend/src/components/AuditResult.tsx` | Streaming result display |
| `frontend/src/components/SeverityBadge.tsx` | Score gauge |
| `backend/src/index.ts` | Event indexer + REST + SSE proxy |

---

## Ritual Chain Reference

| Property | Value |
|----------|-------|
| Chain ID | 1979 |
| RPC | https://rpc.ritualfoundation.org |
| WSS | wss://rpc.ritualfoundation.org/ws |
| Explorer | https://explorer.ritualfoundation.org |
| LLM Precompile | 0x0000000000000000000000000000000000000802 |
| Model | zai-org/GLM-4.7-FP8 (64K context, MIT) |
| Block time | ~350ms |
| Faucet | https://faucet.ritualfoundation.org |

---

## How the Audit Flow Works

1. **User** pastes Solidity code in the UI
2. **Frontend** calls `approve(auditor, fee)` on payment token
3. **Frontend** calls `requestAudit(code)` on `CodeAuditor.sol`
4. **Contract** transfers fee, builds prompt, calls LLM precompile `0x0802` with `stream: true`
5. **Ritual TEE executor** runs GLM-4.7-FP8 inside enclave, pushes EIP-712 signed tokens over SSE
6. **Frontend** opens `EventSource` on `rpc.ritualfoundation.org/sse/{jobId}`, renders tokens live
7. **LLM response** (including `SEVERITY_SCORE`) is stored on-chain; `AuditCompleted` event emitted
8. **Backend indexer** picks up event and makes it queryable via REST

---

## Severity Score

The LLM is prompted to output `SEVERITY_SCORE: <0-100>`.

| Range | Rating |
|-------|--------|
| 0–20 | CRITICAL |
| 21–40 | HIGH |
| 41–60 | MEDIUM |
| 61–80 | LOW |
| 81–100 | CLEAN |

The score is parsed on-chain in `_parseSeverity()` and stored in the `AuditReport` struct.

---

## X402 Micropayment Pattern

This dApp uses a simplified on-chain X402 model:

- User approves `auditFee` amount of payment token (ERC-20)
- `requestAudit()` pulls the fee atomically before calling the LLM precompile
- Contract owner can update `auditFee` and withdraw accumulated fees
- Future: integrate Coinbase's X402 facilitator for gasless UX via EIP-712 permit

---

## Extending This dApp

- **NFT reports**: Mint an ERC-721 with `auditResult` as metadata after each audit
- **History tab**: Display `getMyAudits()` in a table, fetch details from backend
- **Passkey login**: Replace wallet connection with `SECP256R1` precompile (0x0100)
- **Batch audits**: Accept multiple files, queue via `Scheduler` contract
- **Secrets**: Store audit API credentials in `SecretsACL` for private model access

---

*Built on Ritual Chain · Powered by GLM-4.7-FP8 in TEE · Chain ID 1979*
