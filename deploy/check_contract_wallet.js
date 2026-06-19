/**
 * Check CodeAuditor CONTRACT's RitualWallet balance and lock status
 */
const { ethers } = require("ethers");

async function main() {
  const CONTRACT = "0x8a0237E3eDD7df869948E8e975801eB7d04ddBAa";
  const WALLET   = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948";
  const RPC_URL  = "https://rpc.ritualfoundation.org";

  const provider = new ethers.JsonRpcProvider(RPC_URL);

  const ritualWallet = new ethers.Contract(WALLET, [
    "function balanceOf(address user) external view returns (uint256)",
    "function lockUntil(address user) external view returns (uint256)",
  ], provider);

  const currentBlock = await provider.getBlockNumber();
  const nativeBal    = await provider.getBalance(CONTRACT);
  const wBal         = await ritualWallet.balanceOf(CONTRACT);
  const lock         = await ritualWallet.lockUntil(CONTRACT);

  console.log("📋  CodeAuditor Contract:", CONTRACT);
  console.log("📦  Native Balance (in contract):", ethers.formatEther(nativeBal), "RITUAL");
  console.log("🏦  RitualWallet Balance:", ethers.formatEther(wBal), "RITUAL");
  console.log("🔒  Lock Until Block:    ", lock.toString());
  console.log("📍  Current Block:       ", currentBlock);
  console.log("⏳  Lock Status:         ", currentBlock < Number(lock) ? "✅ LOCKED (Active)" : "❌ EXPIRED/UNLOCKED");

  if (currentBlock >= Number(lock)) {
    console.log("\n⚠️  Contract RitualWallet lock is EXPIRED!");
    console.log("   This means executor nodes CANNOT be compensated → TX will timeout/fail.");
    console.log("   Fix: Fund the contract with depositForFees()");
    console.log("   Run: $env:PRIVATE_KEY=\"...\"; node deploy/fund_contract.js");
  } else {
    const blocksRemaining = Number(lock) - currentBlock;
    console.log(`\n✅  Lock active for ${blocksRemaining.toLocaleString()} more blocks (~${Math.round(blocksRemaining * 2.1 / 3600)} hours)`);
  }
}

main().catch(console.error);
