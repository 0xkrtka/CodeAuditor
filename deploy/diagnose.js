/**
 * Diagnose CodeAuditor contract issues
 * Usage: $env:PRIVATE_KEY="..."; node deploy/diagnose.js
 */
const { ethers } = require("ethers");

async function main() {
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  if (!PRIVATE_KEY) {
    console.error("❌  Set PRIVATE_KEY env var dulu");
    process.exit(1);
  }

  const AUDITOR   = "0x8a0237E3eDD7df869948E8e975801eB7d04ddBAa";
  const WALLET    = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948";
  const TOKEN     = "0x26c11EB567BB83d2B031af41188ECA7872CaAF07";
  const EXECUTOR  = "0xB42e435c4252A5a2E7440e37B609F00c61a0c91B";
  const RPC_URL   = "https://rpc.ritualfoundation.org";

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet   = new ethers.Wallet(PRIVATE_KEY.replace("0x", ""), provider);

  console.log("╔═══════════════════════════════════════════╗");
  console.log("║   CodeAuditor — Diagnostics                ║");
  console.log("╚═══════════════════════════════════════════╝\n");

  // 1. Check user balance
  const balance = await provider.getBalance(wallet.address);
  console.log(`👛  User:           ${wallet.address}`);
  console.log(`💰  Native balance: ${ethers.formatEther(balance)} RITUAL`);

  // 2. Check contract exists
  const code = await provider.getCode(AUDITOR);
  console.log(`\n📦  Contract code:  ${code.length > 2 ? `${code.length} bytes ✅` : "❌ NO CODE"}`);

  // 3. Check auditFee
  const auditor = new ethers.Contract(AUDITOR, [
    "function auditFee() view returns (uint256)",
    "function auditCount() view returns (uint256)",
    "function defaultExecutor() view returns (address)",
    "function owner() view returns (address)",
  ], provider);

  try {
    const fee = await auditor.auditFee();
    console.log(`💎  auditFee:       ${ethers.formatEther(fee)} mRITUAL ${fee === 0n ? "✅ FREE" : "⚠️ NOT FREE"}`);
  } catch (e) { console.log(`💎  auditFee:       ❌ ${e.message.slice(0, 100)}`); }

  try {
    const count = await auditor.auditCount();
    console.log(`📊  auditCount:     ${count}`);
  } catch (e) { console.log(`📊  auditCount:     ❌ ${e.message.slice(0, 100)}`); }

  try {
    const executor = await auditor.defaultExecutor();
    console.log(`🤖  defaultExec:    ${executor}`);
  } catch (e) { console.log(`🤖  defaultExec:    ❌ ${e.message.slice(0, 100)}`); }

  try {
    const owner = await auditor.owner();
    console.log(`👑  owner:          ${owner}`);
  } catch (e) { console.log(`👑  owner:          ❌ ${e.message.slice(0, 100)}`); }

  // 4. Check RitualWallet balance for contract
  const ritualWallet = new ethers.Contract(WALLET, [
    "function balanceOf(address) view returns (uint256)",
  ], provider);

  try {
    const wBal = await ritualWallet.balanceOf(AUDITOR);
    console.log(`\n🏦  RitualWallet balance (contract): ${ethers.formatEther(wBal)} RITUAL ${wBal < ethers.parseEther("0.3") ? "⚠️ LOW!" : "✅"}`);
  } catch (e) { console.log(`\n🏦  RitualWallet:   ❌ ${e.message.slice(0, 100)}`); }

  // 5. Check mRITUAL token
  const token = new ethers.Contract(TOKEN, [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
  ], provider);

  try {
    const tBal = await token.balanceOf(wallet.address);
    console.log(`🪙  mRITUAL balance (user): ${ethers.formatEther(tBal)}`);
  } catch (e) { console.log(`🪙  mRITUAL:        ❌ ${e.message.slice(0, 100)}`); }

  try {
    const allowance = await token.allowance(wallet.address, AUDITOR);
    console.log(`📝  mRITUAL allowance:     ${ethers.formatEther(allowance)}`);
  } catch (e) { console.log(`📝  Allowance:      ❌ ${e.message.slice(0, 100)}`); }

  // 6. Try eth_call simulation of requestAudit
  console.log("\n─── Simulating requestAudit via eth_call ───");
  const iface = new ethers.Interface([
    "function requestAudit(string contractCode, address executor) external returns (uint256 auditId, bytes32 jobId)",
  ]);
  const testCode = "pragma solidity ^0.8.0; contract Test { }";
  const calldata = iface.encodeFunctionData("requestAudit", [testCode, "0x0000000000000000000000000000000000000000"]);

  try {
    const result = await provider.call({
      to:   AUDITOR,
      data: calldata,
      from: wallet.address,
    });
    console.log(`✅  eth_call succeeded! Result: ${result.slice(0, 66)}...`);
  } catch (err) {
    console.log(`❌  eth_call REVERTED: ${err.message.slice(0, 400)}`);
    
    // Try to parse revert reason
    if (err.data) {
      console.log(`   Revert data: ${err.data}`);
      try {
        const reason = ethers.AbiCoder.defaultAbiCoder().decode(["string"], "0x" + err.data.slice(10));
        console.log(`   Revert reason: ${reason[0]}`);
      } catch {}
    }
  }

  // 7. Try direct LLM precompile call
  console.log("\n─── Testing LLM precompile 0x0802 directly ───");
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const messagesJson = JSON.stringify([
    { role: "system", content: "Say hi." },
    { role: "user", content: "Hello" },
  ]);

  const payload = abiCoder.encode(
    [
      "address", "bytes[]", "uint256", "bytes[]", "bytes",
      "string", "string", "int256", "string", "bool", "int256", "string", "string",
      "uint256", "bool", "int256", "string", "bytes", "int256", "string", "string", "bool",
      "int256", "bytes", "bytes", "int256", "int256", "string", "bool",
      "tuple(string,string,string)",
    ],
    [
      EXECUTOR, [], 300n, [], "0x",
      messagesJson, "zai-org/GLM-4.7-FP8", 0n, "", false, 512n, "", "",
      1n, true, 0n, "medium", "0x", -1n, "auto", "", false,
      700n, "0x", "0x", -1n, 1000n, "", false,
      ["", "", ""],
    ]
  );

  try {
    const result = await provider.call({
      to:   "0x0000000000000000000000000000000000000802",
      data: payload,
      from: wallet.address,
    });
    console.log(`✅  LLM precompile eth_call OK: ${result.slice(0, 66)}...`);
  } catch (err) {
    console.log(`❌  LLM precompile FAILED: ${err.message.slice(0, 300)}`);
  }

  // 8. Check RitualWallet balance for user (EOA)
  try {
    const userWBal = await ritualWallet.balanceOf(wallet.address);
    console.log(`\n🏦  RitualWallet balance (user EOA): ${ethers.formatEther(userWBal)} RITUAL`);
  } catch (e) { console.log(`\n🏦  RitualWallet (user): ❌ ${e.message.slice(0, 100)}`); }

  console.log("\n─── Diagnosis complete ───");
}

main().catch((err) => {
  console.error("❌ Fatal:", err.message);
  process.exit(1);
});
