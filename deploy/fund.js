/**
 * fund.js — Deposit native RITUAL into CodeAuditor's RitualWallet balance
 *
 * Ini script aman untuk mengisi ulang biaya executor tanpa perlu redeploy.
 * Dana masuk ke RitualWallet atas nama CodeAuditor contract (bukan deployer EOA).
 * Lock duration: 7,776,000 blok (~90 hari) — cukup lama untuk operasi jangka panjang.
 *
 * Usage:
 *   $env:PRIVATE_KEY="your_key_here"; node deploy/fund.js
 *   $env:PRIVATE_KEY="your_key_here"; $env:AMOUNT="0.1"; node deploy/fund.js
 *   $env:PRIVATE_KEY="your_key_here"; $env:TARGET="0xAuditorAddress"; node deploy/fund.js
 */

const { ethers } = require("ethers");
require("dotenv").config({ path: ".env.local" });

const RPC_URL       = "https://rpc.ritualfoundation.org";
const RITUAL_WALLET = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948";
// Dapat di-override dari env (default ke NEXT_PUBLIC_AUDITOR_ADDRESS di .env.local)
const AUDITOR_ADDR  = process.env.TARGET ?? process.env.NEXT_PUBLIC_AUDITOR_ADDRESS;
const AMOUNT_ETH    = process.env.AMOUNT ?? "0.05"; // default 0.05 RITUAL

const RITUAL_WALLET_ABI = [
  "function depositFor(address recipient, uint256 lockDuration) external payable",
  "function balanceOf(address) external view returns (uint256)",
  "function lockUntil(address) external view returns (uint256)",
];

async function main() {
  if (!process.env.PRIVATE_KEY) {
    console.error("❌  Set PRIVATE_KEY env var first");
    console.error("    $env:PRIVATE_KEY='your_key'; node deploy/fund.js");
    process.exit(1);
  }

  if (!AUDITOR_ADDR || AUDITOR_ADDR === "0x0000000000000000000000000000000000000000") {
    console.error("❌  NEXT_PUBLIC_AUDITOR_ADDRESS not set in .env.local");
    console.error("    Run: node deploy/deploy2.js  first");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet   = new ethers.Wallet(process.env.PRIVATE_KEY.replace("0x", ""), provider);

  console.log("\n╔═══════════════════════════════════════════╗");
  console.log("║    CodeAuditor — Fund Executor Fees (V5)  ║");
  console.log("╚═══════════════════════════════════════════╝\n");

  console.log(`📍  Target (CodeAuditor): ${AUDITOR_ADDR}`);
  console.log(`💳  Deployer EOA:         ${wallet.address}`);

  const eoa_balance = await provider.getBalance(wallet.address);
  console.log(`💰  EOA Balance:          ${ethers.formatEther(eoa_balance)} RITUAL\n`);

  // Check current RitualWallet balance + lock status for the auditor contract
  const rw = new ethers.Contract(RITUAL_WALLET, RITUAL_WALLET_ABI, wallet);
  const currentBal  = await rw.balanceOf(AUDITOR_ADDR);
  const currentLock = await rw.lockUntil(AUDITOR_ADDR);
  const curBlock    = await provider.getBlockNumber();

  console.log(`🏦  RitualWallet Balance:  ${ethers.formatEther(currentBal)} RITUAL`);
  console.log(`🔒  Lock Until Block:      ${currentLock.toString()}`);
  console.log(`📦  Current Block:         ${curBlock}`);
  console.log(`⏰  Lock Status:           ${currentLock > BigInt(curBlock) ? "✅ Valid (blocks remaining: " + (currentLock - BigInt(curBlock)) + ")" : "❌ EXPIRED — needs re-deposit!"}\n`);

  const amount = ethers.parseEther(AMOUNT_ETH);

  if (eoa_balance < amount + ethers.parseEther("0.01")) {
    console.error(`\n❌  Insufficient EOA balance!`);
    console.error(`    Need: ${AMOUNT_ETH} RITUAL + gas`);
    console.error(`    Have: ${ethers.formatEther(eoa_balance)} RITUAL`);
    console.error(`    Claim from faucet: https://faucet.ritualfoundation.org`);
    process.exit(1);
  }

  // Lock duration: 7,776,000 blocks = ~90 days (at ~1 block/sec on Ritual)
  const LOCK_DURATION = 7_776_000;

  console.log(`💸  Depositing ${AMOUNT_ETH} RITUAL to CodeAuditor via RitualWallet.depositFor()...`);
  console.log(`🔑  Lock Duration: ${LOCK_DURATION} blocks (~90 days)\n`);

  try {
    const tx = await rw.depositFor(AUDITOR_ADDR, LOCK_DURATION, {
      value:    amount,
      gasLimit: 300_000n,
    });
    console.log(`📤  Tx sent: ${tx.hash}`);
    console.log(`    Explorer: https://explorer.ritualfoundation.org/tx/${tx.hash}`);
    console.log(`    Waiting for confirmation...`);
    await tx.wait();
    console.log(`✅  Deposit confirmed!`);
  } catch (err) {
    console.error(`❌  depositFor() failed: ${err.message}`);
    process.exit(1);
  }

  // Show final balance
  const finalBal  = await rw.balanceOf(AUDITOR_ADDR);
  const finalLock = await rw.lockUntil(AUDITOR_ADDR);
  console.log(`\n═══ Final RitualWallet Status ═══`);
  console.log(`  CodeAuditor Balance: ${ethers.formatEther(finalBal)} RITUAL`);
  console.log(`  Lock Until Block:    ${finalLock.toString()}`);
  console.log(`  Lock Valid For:      ~${Math.round(Number(finalLock - BigInt(curBlock)) / 86400)} days\n`);
  console.log(`✅  CodeAuditor is now funded and ready for LLM audit calls!\n`);
}

main().catch((err) => {
  console.error("\n❌  Fund failed:", err.message);
  process.exit(1);
});
