# HANDOFF: CodeAuditor — On-chain AI Solidity Audit dApp on Ritual Chain
# Dokumen ini berisi konteks lengkap + perintah step-by-step dari 0 sampai dApp live.
# Tujukan ke Claude Code, Cursor, atau AI coding agent lainnya.

---

## KONTEKS PROYEK

Kamu melanjutkan pembangunan dApp bernama **CodeAuditor** di **Ritual Chain** (Chain ID 1979).

Deskripsi singkat:
- User paste Solidity contract ke UI → bayar micro-fee → LLM precompile di TEE mengaudit kode
- Hasil audit streaming real-time via SSE (Server-Sent Events), tiap token di-sign EIP-712
- Report lengkap + severity score tersimpan on-chain selamanya
- Backend Node.js mengindex events dan expose REST API

Stack:
- Smart contract: Solidity 0.8.20 + Foundry
- Frontend: Next.js 14 + wagmi 2 + viem 2 + TypeScript
- Backend: Node.js + TypeScript + viem (event indexer)
- Chain: Ritual Chain (https://rpc.ritualfoundation.org, Chain ID 1979)
- LLM: GLM-4.7-FP8 via Ritual precompile 0x0802 (TEE, no API key needed)

---

## STRUKTUR FILE (sudah ada, tinggal dilanjutkan)

```
ritual-codeauditor-dapp/
├── README.md
├── contracts/
│   ├── foundry.toml
│   ├── src/
│   │   └── CodeAuditor.sol          ✅ selesai (260 baris)
│   ├── test/
│   │   └── CodeAuditor.t.sol        ✅ selesai (tests + fuzz)
│   └── script/
│       └── Deploy.s.sol             ✅ selesai (deploy ke Ritual)
├── frontend/
│   ├── package.json
│   ├── .env.example
│   └── src/
│       ├── app/
│       │   ├── layout.tsx           ✅ selesai
│       │   ├── page.tsx             ✅ selesai
│       │   └── providers.tsx        ✅ selesai (wagmi config)
│       ├── components/
│       │   ├── AuditForm.tsx        ✅ selesai (309 baris)
│       │   ├── AuditResult.tsx      ✅ selesai (242 baris, SSE renderer)
│       │   └── SeverityBadge.tsx    ✅ selesai (score gauge SVG)
│       ├── hooks/
│       │   └── useAudit.ts          ✅ selesai (approve→submit→SSE, 243 baris)
│       └── lib/
│           └── ritual.ts            ✅ selesai (chain config, ABIs)
└── backend/
    ├── package.json
    └── src/
        ├── index.ts                 ✅ selesai (event indexer + REST + SSE proxy)
        └── ritual-chain.ts          ✅ selesai
```

---

## APA YANG SUDAH SELESAI ✅

### Smart Contract (CodeAuditor.sol)
- Interface `ILLMPrecompile` untuk precompile 0x0802
- Struct `AuditReport` dengan: id, requester, contractCode, auditResult, jobId, severityScore, timestamp
- `requestAudit(string code)` → transferFrom fee → call LLM → store result → emit events
- `_buildPrompt()` → format prompt audit profesional dengan kategori CRITICAL/HIGH/MEDIUM/LOW
- `_parseSeverity()` → parse `SEVERITY_SCORE: <0-100>` dari teks LLM
- Events: `AuditRequested`, `AuditCompleted`
- Access control: `onlyOwner`, `setAuditFee`, `withdrawFees`

### Frontend
- wagmi config untuk Ritual Chain (Chain ID 1979, RPC, WSS)
- `useAudit` hook: approve token → submit tx → open EventSource → stream tokens
- `AuditForm`: editor kode dengan line counter, wallet connect, progress stepper
- `AuditResult`: live streaming dengan blinking cursor, color-coded findings per severity
- `SeverityBadge`: circular SVG gauge + label pill (CRITICAL/HIGH/MEDIUM/LOW/CLEAN)

### Backend
- Index `AuditCompleted` events dari genesis sampai latest
- WebSocket listener untuk events baru real-time
- REST: `GET /audits`, `GET /audits/:id`, `GET /users/:addr/audits`, `GET /health`
- SSE proxy: `GET /sse/:jobId` → forward stream dari Ritual RPC (CORS bridge)

---

## APA YANG PERLU DISELESAIKAN ❌

### WAJIB sebelum bisa jalan:

1. **Setup Foundry dan install dependencies**
2. **Set PAYMENT_TOKEN** di `contracts/script/Deploy.s.sol` baris 20
3. **Deploy contract** ke Ritual Chain testnet
4. **Isi `.env.local`** frontend dengan address contract yang baru di-deploy
5. **Install npm deps** di frontend dan backend
6. **Jalankan semua 3 service**

### OPSIONAL (pengembangan lanjutan):
- Halaman `/history` — tampilkan `getMyAudits()` user dalam tabel
- NFT mint setiap audit selesai (ERC-721 dengan auditResult sebagai metadata)
- Passkey login (SECP256R1 precompile 0x0100, gasless UX)
- Batch audit multiple files via Scheduler contract
- Secrets ACL untuk model private

---

## PERINTAH LENGKAP DARI 0 SAMPAI LIVE

### FASE 1 — Setup environment (jalankan sekali)

```bash
# Clone atau extract archive project
# (jika dari archive: tar -xzf ritual-codeauditor-dapp.tar.gz)
cd ritual-codeauditor-dapp

# Install Foundry (Ethereum dev toolchain)
curl -L https://foundry.paradigm.xyz | bash
source ~/.bashrc   # atau buka terminal baru
foundryup
# Verifikasi:
forge --version    # harus muncul "forge 0.x.x"
```

### FASE 2 — Smart Contract

```bash
cd contracts

# Install forge dependencies
forge install foundry-rs/forge-std --no-commit

# Jalankan semua tests (harus 100% pass)
forge test -vvv
# Output yang diharapkan:
# [PASS] test_requestAudit_success()
# [PASS] test_requestAudit_paymentDeducted()
# [PASS] test_requestAudit_emptyCode_reverts()
# [PASS] test_requestAudit_codeTooLong_reverts()
# [PASS] test_multipleAudits_tracked()
# [PASS] test_getAudit_notFound_reverts()
# [PASS] test_setFee_onlyOwner()
# [PASS] test_withdrawFees()
# [PASS] testFuzz_auditFee(uint256) (256 runs)
```

```bash
# PENTING: Edit Deploy.s.sol sebelum deploy
# Buka: contracts/script/Deploy.s.sol
# Baris 20: ubah PAYMENT_TOKEN ke address token yang valid di Ritual Chain
# Jika belum ada stablecoin, deploy MockERC20 dulu (lihat catatan di bawah)

# Deploy mock token dulu jika belum ada:
cat > /tmp/MockToken.s.sol << 'EOF'
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "forge-std/Script.sol";
contract MockERC20 {
    string public name = "Audit Token"; string public symbol = "AUDIT"; uint8 public decimals = 18;
    mapping(address=>uint256) public balanceOf;
    mapping(address=>mapping(address=>uint256)) public allowance;
    function mint(address to, uint256 amt) external { balanceOf[to] += amt; }
    function approve(address s, uint256 a) external returns(bool) { allowance[msg.sender][s]=a; return true; }
    function transfer(address to, uint256 a) external returns(bool) { balanceOf[msg.sender]-=a; balanceOf[to]+=a; return true; }
    function transferFrom(address f,address t,uint256 a) external returns(bool) { allowance[f][msg.sender]-=a; balanceOf[f]-=a; balanceOf[t]+=a; return true; }
}
contract DeployMock is Script {
    function run() external {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        MockERC20 t = new MockERC20();
        t.mint(vm.addr(vm.envUint("PRIVATE_KEY")), 1000 ether);
        console.log("MockToken:", address(t));
        vm.stopBroadcast();
    }
}
EOF
# Simpan ke contracts/script/DeployMock.s.sol dan jalankan:
PRIVATE_KEY=0xYOUR_KEY forge script script/DeployMock.s.sol \
  --rpc-url https://rpc.ritualfoundation.org --broadcast
# Catat address token yang muncul di output
```

```bash
# Dapatkan testnet RITUAL untuk gas:
# → https://faucet.ritualfoundation.org
# Masukkan address wallet kamu

# Set PAYMENT_TOKEN di Deploy.s.sol ke address token di atas
# Kemudian deploy CodeAuditor:
export PRIVATE_KEY=0xYOUR_FUNDED_PRIVATE_KEY

PRIVATE_KEY=$PRIVATE_KEY forge script script/Deploy.s.sol \
  --rpc-url https://rpc.ritualfoundation.org \
  --broadcast \
  -vvv

# Output:
# === Deployed ===
# CodeAuditor:   0xABCD...1234
# Explorer: https://explorer.ritualfoundation.org/address/0xABCD...1234
# → Deployment info written to ../frontend/src/lib/deployment.json

# CATAT address CodeAuditor dan PaymentToken!
```

### FASE 3 — Frontend

```bash
cd ../frontend

# Install dependencies
npm install

# Setup environment
cp .env.example .env.local
```

Edit `.env.local` (isi dua baris ini):
```env
NEXT_PUBLIC_AUDITOR_ADDRESS=0xALAMAT_CODEAUDITOR_DARI_FASE2
NEXT_PUBLIC_PAYMENT_TOKEN=0xALAMAT_PAYMENT_TOKEN_DARI_FASE2
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
```

```bash
# Jalankan frontend
npm run dev
# → Buka http://localhost:3000
# → Tambahkan Ritual Chain ke MetaMask:
#   - Network name: Ritual Chain
#   - RPC URL: https://rpc.ritualfoundation.org
#   - Chain ID: 1979
#   - Currency: RITUAL
#   - Explorer: https://explorer.ritualfoundation.org
```

### FASE 4 — Backend Indexer

```bash
# Terminal baru
cd ../backend

npm install

# Jalankan indexer
AUDITOR_ADDRESS=0xALAMAT_CODEAUDITOR_DARI_FASE2 npm start
# → http://localhost:3001
# Verifikasi: curl http://localhost:3001/health
# → {"ok":true,"indexed":0}
```

### FASE 5 — Test End-to-End

```bash
# Di browser (http://localhost:3000):
# 1. Klik "Connect Wallet" → pilih MetaMask
# 2. Pastikan MetaMask di-set ke Ritual Chain (ID 1979)
# 3. Pastikan wallet punya RITUAL token (dari faucet)
# 4. Pastikan wallet punya AUDIT token (mint dari MockToken)
# 5. Paste kode Solidity ke editor (sudah ada contoh reentrancy bug)
# 6. Klik "Request on-chain audit"
# 7. Approve token di MetaMask → Confirm tx di MetaMask
# 8. Lihat SSE streaming di UI — token muncul satu per satu
# 9. Setelah selesai: severity score muncul di header

# Verifikasi on-chain:
# → https://explorer.ritualfoundation.org
# → Cari address CodeAuditor
# → Tab "Events" → lihat AuditRequested & AuditCompleted

# Verifikasi backend:
curl http://localhost:3001/audits
curl http://localhost:3001/audits/1
curl http://localhost:3001/users/0xALAMAT_KAMU/audits
```

---

## RITUAL CHAIN REFERENCE (penting untuk agent)

```
Chain ID:     1979
RPC HTTP:     https://rpc.ritualfoundation.org
RPC WS:       wss://rpc.ritualfoundation.org/ws
Explorer:     https://explorer.ritualfoundation.org
Faucet:       https://faucet.ritualfoundation.org
Block time:   ~350ms
Currency:     RITUAL (18 decimals)

System contracts:
  RitualWallet:       0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948
  AsyncJobTracker:    0xC069FFCa0389f44eCA2C626e55491b0ab045AEF5
  TEEServiceRegistry: 0x9644e8562cE0Fe12b4deeC4163c064A8862Bf47F
  Scheduler:          0x56e776BAE2DD60664b69Bd5F865F1180ffB7D58B
  SecretsACL:         0xf9BF1BC8A3e79B9EBeD0fa2Db70D0513fecE32FD
  AsyncDelivery:      0x5A16214fF555848411544b005f7Ac063742f39F6

Precompiles:
  LLM (GLM-4.7-FP8):  0x0000000000000000000000000000000000000802
  HTTP:               0x0000000000000000000000000000000000000801
  Image:              0x0000000000000000000000000000000000000818
  SECP256R1:          0x0000000000000000000000000000000000000100
  Ed25519:            0x0000000000000000000000000000000000000009

SSE streaming:
  URL pattern: https://rpc.ritualfoundation.org/sse/{jobId}
  Token event:  { token: string, sig: string }  (EIP-712 signed per token)
  Done event:   "complete"
```

---

## ALUR TEKNIS LENGKAP (untuk agent memahami sistem)

```
User input code
     │
     ▼
[1] Frontend: approve(paymentToken, auditFee) via wagmi
     │  MetaMask popup #1
     ▼
[2] Frontend: requestAudit(contractCode) on CodeAuditor.sol
     │  MetaMask popup #2
     ▼
[3] CodeAuditor.sol:
     ├─ transferFrom(user, contract, fee)      ← X402 pattern
     ├─ _buildPrompt(code)                     ← format audit prompt
     └─ ILLMPrecompile(0x0802).complete(req)   ← stream: true
               │
               ▼
[4] Ritual TEE Executor:
     ├─ Decrypt request
     ├─ Run GLM-4.7-FP8 inference
     ├─ Sign each token with EIP-712
     └─ Push to SSE stream (jobId)
               │
               ▼
[5] LLM response returns to contract:
     ├─ Store auditResult on-chain
     ├─ _parseSeverity(text) → uint8 score
     └─ emit AuditCompleted(id, user, score, tokens)

[6] Frontend EventSource(jobId):
     ├─ Receive token events → append to DOM
     ├─ Receive "complete" → close stream
     └─ Parse SEVERITY_SCORE from text

[7] Backend WebSocket listener:
     └─ Index AuditCompleted → REST queryable
```

---

## TROUBLESHOOTING

```
MASALAH: forge test gagal dengan "precompile not found"
SOLUSI:  Normal! Mock di test/CodeAuditor.t.sol sudah handle ini via vm.etch

MASALAH: Deploy gagal "insufficient funds"
SOLUSI:  Minta RITUAL dari https://faucet.ritualfoundation.org

MASALAH: MetaMask "Wrong network"
SOLUSI:  Tambahkan Ritual Chain manual: Chain ID 1979, RPC https://rpc.ritualfoundation.org

MASALAH: SSE stream tidak muncul / kosong
SOLUSI:  Ritual testnet mungkin delayed. Cek tx di explorer dulu apakah sukses.
         Backend SSE proxy di /sse/:jobId bisa dipakai sebagai fallback.

MASALAH: "PaymentFailed" revert
SOLUSI:  Pastikan sudah approve token dulu, atau auditFee-nya sesuai.
         Mint token dulu via MockToken.mint() jika saldo kosong.

MASALAH: Frontend "AUDITOR_ADDRESS not set"
SOLUSI:  Buat file frontend/.env.local dengan NEXT_PUBLIC_AUDITOR_ADDRESS

MASALAH: npm install error peer deps
SOLUSI:  npm install --legacy-peer-deps
```

---

## PROMPT UNTUK CLAUDE CODE / CURSOR

Copy-paste prompt ini ke agent kamu setelah extract archive:

```
Read the file HANDOFF.md and follow all instructions to complete the CodeAuditor dApp.

Start from FASE 1. Run every command in order. 
If any step fails, diagnose and fix before moving on.
Ask me only if you need my wallet private key or contract addresses.

Goal: have all 3 services running (contracts deployed, frontend on :3000, backend on :3001)
and successfully complete one end-to-end audit transaction on Ritual Chain testnet.
```

---

## SKILL REPO RITUAL (referensi tambahan untuk agent)

```bash
# Clone skill repo Ritual untuk referensi precompile ABI lengkap:
git clone https://github.com/ritual-foundation/ritual-dapp-skills.git .claude/skills/ritual-dapp-skills

# Kemudian instruksikan agent:
# "Read skills/ritual/SKILL.md for Ritual Chain patterns before modifying any contract"
```

---

*Project: CodeAuditor | Chain: Ritual (1979) | Model: GLM-4.7-FP8 in TEE*
*Files: 19 | Contracts: 1 | Tests: 9 | Frontend components: 6 | Backend: 1*
