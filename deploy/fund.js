/**
 * fund.js — Deposit native RITUAL into CodeAuditor's RitualWallet balance
 *
 * Ini script aman untuk mengisi ulang biaya executor tanpa perlu redeploy.
 * Dana masuk ke RitualWallet atas nama CodeAuditor contract (bukan deployer EOA).
 *
 * Usage:
 *   $env:PRIVATE_KEY="your_key_here"; node deploy/fund.js
 *   $env:PRIVATE_KEY="your_key_here"; $env:AMOUNT="0.3"; node deploy/fund.js
 */

const { ethers } = require("ethers");
require("dotenv").config({ path: ".env.local" });

const RPC_URL      = "https://rpc.ritualfoundation.org";
const AUDITOR_ADDR = process.env.NEXT_PUBLIC_AUDITOR_ADDRESS;
const AMOUNT_ETH   = process.env.AMOUNT ?? "0.3"; // default 0.3 RITUAL

const AUDITOR_ABI = [
  "function depositForFees() external payable",
  "function owner() external view returns (address)",
];

const RITUAL_WALLET_ABI = [
  "function balanceOf(address) external view returns (uint256)",
];

async function main() {
  if (!process.env.PRIVATE_KEY) {
    console.error("❌  Set PRIVATE_KEY env var first");
    console.error("    $env:PRIVATE_KEY='your_key'; node deploy/fund.js");
    process.exit(1);
  }

  if (!AUDITOR_ADDR || AUDITOR_ADDR === "0x0000000000000000000000000000000000000000") {
    console.error("❌  NEXT_PUBLIC_AUDITOR_ADDRESS not set in .env.local");
    console.error("    Run: node deploy/deploy.js  first");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet   = new ethers.Wallet(process.env.PRIVATE_KEY.replace("0x", ""), provider);

  console.log("\n╔═══════════════════════════════════════════╗");
  console.log("║     CodeAuditor — Fund Executor Fees      ║");
  console.log("╚═══════════════════════════════════════════╝\n");

  console.log(`📍  CodeAuditor:  ${AUDITOR_ADDR}`);
  console.log(`💳  Deployer EOA: ${wallet.address}`);

  const eoa_balance = await provider.getBalance(wallet.address);
  console.log(`💰  EOA Balance:  ${ethers.formatEther(eoa_balance)} RITUAL\n`);

  // Check current RitualWallet balance for the auditor contract
  const RITUAL_WALLET = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948";
  const rw = new ethers.Contract(RITUAL_WALLET, RITUAL_WALLET_ABI, provider);
  const currentBal = await rw.balanceOf(AUDITOR_ADDR);
  console.log(`🏦  Current RitualWallet balance for CodeAuditor: ${ethers.formatEther(currentBal)} RITUAL`);

  const amount = ethers.parseEther(AMOUNT_ETH);

  if (eoa_balance < amount + ethers.parseEther("0.01")) {
    console.error(`\n❌  Insufficient EOA balance!`);
    console.error(`    Need: ${AMOUNT_ETH} RITUAL + gas`);
    console.error(`    Have: ${ethers.formatEther(eoa_balance)} RITUAL`);
    process.exit(1);
  }

  console.log(`\n💸  Depositing ${AMOUNT_ETH} RITUAL via depositForFees()...`);
  console.log(`    This funds the CodeAuditor contract's RitualWallet balance.`);
  console.log(`    Without this, LLM precompile calls will revert.\n`);

  const auditor = new ethers.Contract(AUDITOR_ADDR, AUDITOR_ABI, wallet);

  try {
    const tx = await auditor.depositForFees({ value: amount, gasLimit: 200_000n });
    console.log(`📤  Tx sent: ${tx.hash}`);
    console.log(`    Waiting for confirmation...`);
    await tx.wait();
    console.log(`✅  Deposit confirmed!`);
  } catch (err) {
    console.error(`❌  depositForFees() failed: ${err.message}`);

    // Fallback: send directly to RitualWallet with deposit(lockDuration) call
    console.log(`\n⚠️  Trying direct RitualWallet.deposit() as fallback...`);
    const rwWriter = new ethers.Contract(RITUAL_WALLET, [
      "function deposit(uint256 lockDuration) payable",
    ], wallet);
    const tx2 = await rwWriter.deposit(5000, { value: amount, gasLimit: 200_000n });
    console.log(`📤  Tx sent: ${tx2.hash}`);
    await tx2.wait();
    console.log(`✅  Direct deposit confirmed (goes to deployer EOA's balance, not contract's).`);
    console.log(`⚠️  WARNING: This went to your EOA balance, NOT the CodeAuditor contract.`);
    console.log(`    Use depositForFees() on the CodeAuditor contract instead.`);
  }

  // Show final balance
  const finalBal = await rw.balanceOf(AUDITOR_ADDR);
  const eoaFinalBal = await rw.balanceOf(wallet.address);
  console.log(`\n═══ Final RitualWallet Balances ═══`);
  console.log(`  CodeAuditor (${AUDITOR_ADDR.slice(0,10)}...): ${ethers.formatEther(finalBal)} RITUAL`);
  console.log(`  Deployer EOA (${wallet.address.slice(0,10)}...):  ${ethers.formatEther(eoaFinalBal)} RITUAL`);
  console.log(`\n✅  CodeAuditor is now funded and ready for LLM calls!\n`);
}

main().catch((err) => {
  console.error("\n❌  Fund failed:", err.message);
  process.exit(1);
});
