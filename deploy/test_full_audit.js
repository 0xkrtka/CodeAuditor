/**
 * Full end-to-end test: send real requestAudit transaction
 * This bypasses the frontend completely to isolate where the issue is.
 * 
 * Usage: $env:PRIVATE_KEY="..."; node deploy/test_full_audit.js
 */
const { ethers } = require("ethers");

async function main() {
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  if (!PRIVATE_KEY) {
    console.error("❌  Set PRIVATE_KEY env var dulu");
    process.exit(1);
  }

  const fs = require("fs");
  const path = require("path");
  let AUDITOR = "0x8a0237E3eDD7df869948E8e975801eB7d04ddBAa";
  let TOKEN = "0x26c11EB567BB83d2B031af41188ECA7872CaAF07";
  try {
    const envContent = fs.readFileSync(path.join(__dirname, "../.env.local"), "utf8");
    const matchAuditor = envContent.match(/NEXT_PUBLIC_AUDITOR_ADDRESS=(0x[a-fA-F0-9]{40})/);
    const matchToken = envContent.match(/NEXT_PUBLIC_PAYMENT_TOKEN=(0x[a-fA-F0-9]{40})/);
    if (matchAuditor) AUDITOR = matchAuditor[1];
    if (matchToken) TOKEN = matchToken[1];
  } catch (e) {}

  const WALLET    = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948";
  const RPC_URL   = "https://rpc.ritualfoundation.org";

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet   = new ethers.Wallet(PRIVATE_KEY.replace("0x", ""), provider);

  console.log("╔═══════════════════════════════════════════════╗");
  console.log("║   Full End-to-End Audit Test                   ║");
  console.log("╚═══════════════════════════════════════════════╝\n");

  // ── Pre-flight checks ─────────────────────────────────────────────────
  const balance = await provider.getBalance(wallet.address);
  console.log(`👛  Wallet:  ${wallet.address}`);
  console.log(`💰  Balance: ${ethers.formatEther(balance)} RITUAL`);

  if (balance < ethers.parseEther("0.01")) {
    console.error("❌  Not enough RITUAL for gas!");
    process.exit(1);
  }

  const ritualWallet = new ethers.Contract(WALLET, [
    "function balanceOf(address) view returns (uint256)",
  ], provider);
  const wBal = await ritualWallet.balanceOf(AUDITOR);
  console.log(`🏦  Contract RitualWallet: ${ethers.formatEther(wBal)} RITUAL`);

  // ── Step 1: Check & approve token (amount=0 but contract still calls transferFrom) ──
  const token = new ethers.Contract(TOKEN, [
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function balanceOf(address) view returns (uint256)",
  ], wallet);

  const allowance = await token.allowance(wallet.address, AUDITOR);
  console.log(`📝  Token allowance: ${ethers.formatEther(allowance)}`);

  // Even though fee=0, let's approve to be safe
  if (allowance === 0n) {
    console.log("   Approving token (fee=0, but contract still calls transferFrom)...");
    try {
      const approveTx = await token.approve(AUDITOR, ethers.parseEther("1000"));
      console.log(`   Approve tx: ${approveTx.hash}`);
      await approveTx.wait();
      console.log("   ✅ Approved");
    } catch (err) {
      console.log(`   ⚠️ Approve failed: ${err.message.slice(0, 200)}`);
    }
  }

  // ── Step 2: Test eth_estimateGas for requestAudit ────────────────────
  console.log("\n─── Testing gas estimation ───");
  const auditorIface = new ethers.Interface([
    "function requestAudit(string contractCode, address executor) external returns (uint256 auditId, bytes32 jobId)",
  ]);
  
  const multilineCode = `pragma solidity ^0.8.0;
contract Test {
    string public greeting = "Hello, World!";
    function greet() external view returns (string memory) {
        return greeting;
    }
}`;
  const escapedCode = JSON.stringify(multilineCode).slice(1, -1);
  const calldata = auditorIface.encodeFunctionData("requestAudit", [
    escapedCode,
    "0x0000000000000000000000000000000000000000", // use defaultExecutor
  ]);

  try {
    const gasEstimate = await provider.estimateGas({
      to:   AUDITOR,
      data: calldata,
      from: wallet.address,
    });
    console.log(`✅  Gas estimate: ${gasEstimate.toString()}`);
  } catch (err) {
    console.log(`❌  estimateGas FAILED: ${err.message.slice(0, 300)}`);
    
    // Try to get more details with eth_call
    console.log("\n   Trying eth_call for detailed error...");
    try {
      await provider.call({
        to:   AUDITOR,
        data: calldata,
        from: wallet.address,
      });
      console.log("   eth_call succeeded (weird - estimateGas failed but call passed)");
    } catch (callErr) {
      console.log(`   eth_call also failed: ${callErr.message.slice(0, 300)}`);
      if (callErr.data) console.log(`   Revert data: ${callErr.data}`);
    }
  }

  // ── Step 3: Send the actual transaction ──────────────────────────────
  console.log("\n─── Sending REAL requestAudit transaction ───");
  try {
    const tx = await wallet.sendTransaction({
      to:       AUDITOR,
      data:     calldata,
      gasLimit: 500_000n,
      gasPrice: 1_500_000_000n,
    });
    console.log(`✅  TX SENT! Hash: ${tx.hash}`);
    console.log("   Explorer: https://explorer.ritualfoundation.org/tx/" + tx.hash);
    console.log("   Waiting for receipt (max 120s)...");

    const receipt = await tx.wait(1, 120_000);
    console.log(`\n   Status:     ${receipt.status === 1 ? "✅ SUCCESS" : "❌ REVERTED"}`);
    console.log(`   Block:      ${receipt.blockNumber}`);
    console.log(`   Gas used:   ${receipt.gasUsed.toString()}`);
    console.log(`   Logs count: ${receipt.logs.length}`);

    if (receipt.status === 0) {
      console.log("\n   ❌ Transaction REVERTED on-chain!");
      console.log("   Possible causes:");
      console.log("   - PaymentFailed: transferFrom(user, contract, 0) failed");
      console.log("   - NoExecutor: defaultExecutor is zero");
      console.log("   - RitualWallet insufficient for precompile escrow");
    } else {
      console.log("\n   🎉 Transaction SUCCEEDED!");
      
      // Try to read the audit result
      const auditorContract = new ethers.Contract(AUDITOR, [
        "function auditCount() view returns (uint256)",
        "function getAudit(uint256) view returns (tuple(uint256 id, address requester, bytes32 codeHash, string auditResult, bytes32 jobId, uint8 severityScore, uint256 timestamp, bool completed))",
      ], provider);

      const count = await auditorContract.auditCount();
      console.log(`   Audit count: ${count}`);
      
      if (count > 0n) {
        try {
          const audit = await auditorContract.getAudit(count);
          console.log(`   Audit result length: ${audit.auditResult.length} chars`);
          console.log(`   Severity score: ${audit.severityScore}`);
          console.log(`   Completed: ${audit.completed}`);
          if (audit.auditResult.length > 0) {
            console.log(`\n   ── Audit Result (first 500 chars) ──`);
            console.log(audit.auditResult.slice(0, 500));
          } else {
            console.log("   ⚠️ Audit result is empty (async LLM - result comes via SSE stream)");
          }
        } catch (e) {
          console.log(`   Could not read audit: ${e.message.slice(0, 200)}`);
        }
      }
    }
  } catch (err) {
    console.error(`\n❌  sendTransaction FAILED: ${err.message.slice(0, 500)}`);
    
    // Parse specific errors
    if (err.message.includes("insufficient funds")) {
      console.log("   → Not enough RITUAL for gas");
    } else if (err.message.includes("sender locked")) {
      console.log("   → Previous tx still pending (sender locked by RitualWallet)");
    } else if (err.message.includes("nonce")) {
      console.log("   → Nonce conflict - try again");
    } else if (err.message.includes("insufficient wallet balance")) {
      console.log("   → Contract's RitualWallet balance too low for escrow");
    }
  }

  // ── Step 4: Also test direct precompile call (no contract) ───────────
  console.log("\n─── Testing direct LLM precompile (bypass contract) ───");
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const messagesJson = JSON.stringify([
    { role: "system", content: "Say hello in one word." },
    { role: "user", content: "Hi" },
  ]);

  const llmPayload = abiCoder.encode(
    [
      "address", "bytes[]", "uint256", "bytes[]", "bytes",
      "string", "string", "int256", "string", "bool", "int256", "string", "string",
      "uint256", "bool", "int256", "string", "bytes", "int256", "string", "string", "bool",
      "int256", "bytes", "bytes", "int256", "int256", "string", "bool",
      "tuple(string,string,string)",
    ],
    [
      "0xB42e435c4252A5a2E7440e37B609F00c61a0c91B", [], 300n, [], "0x",
      messagesJson, "zai-org/GLM-4.7-FP8", 0n, "", false, 256n, "", "",
      1n, true, 0n, "medium", "0x", -1n, "auto", "", false,
      700n, "0x", "0x", -1n, 1000n, "", false,
      ["", "", ""],
    ]
  );

  try {
    const directTx = await wallet.sendTransaction({
      to:       "0x0000000000000000000000000000000000000802",
      data:     llmPayload,
      gasLimit: 3_000_000n,
    });
    console.log(`✅  Direct precompile TX: ${directTx.hash}`);
    const directReceipt = await directTx.wait(1, 60_000);
    console.log(`   Status: ${directReceipt.status === 1 ? "✅ SUCCESS" : "❌ REVERTED"}`);
    console.log(`   Gas used: ${directReceipt.gasUsed.toString()}`);
    console.log(`   Logs: ${directReceipt.logs.length}`);
  } catch (err) {
    console.error(`❌  Direct precompile FAILED: ${err.message.slice(0, 300)}`);
  }

  console.log("\n─── Test complete ───");
}

main().catch((err) => {
  console.error("❌ Fatal:", err.message);
  process.exit(1);
});
