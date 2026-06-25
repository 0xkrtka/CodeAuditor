/**
 * Fund CodeAuditor contract RitualWallet with 1.0 RITUAL
 * Usage: $env:PRIVATE_KEY="your_key"; node deploy/fund_now.js
 */
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC_URL = "https://rpc.ritualfoundation.org";

async function main() {
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  if (!PRIVATE_KEY) {
    console.error("❌  Set PRIVATE_KEY env var");
    console.error('   $env:PRIVATE_KEY="your_private_key_here"; node deploy/fund_now.js');
    process.exit(1);
  }

  // Read contract address from .env.local
  let AUDITOR = "0xe3EC152897C2b44E1AD30E13C811C03204A69Fd6";
  try {
    const env = fs.readFileSync(path.join(__dirname, "../.env.local"), "utf8");
    const m = env.match(/NEXT_PUBLIC_AUDITOR_ADDRESS=(0x[a-fA-F0-9]{40})/);
    if (m) AUDITOR = m[1];
  } catch {}

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY.replace("0x", ""), provider);

  const RITUAL_WALLET = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948";
  const rw = new ethers.Contract(RITUAL_WALLET, [
    "function balanceOf(address) view returns (uint256)",
    "function lockUntil(address) view returns (uint256)",
  ], provider);

  console.log("╔══════════════════════════════════════╗");
  console.log("║   Fund Contract RitualWallet         ║");
  console.log("╚══════════════════════════════════════╝\n");

  const [balBefore, lockUntil, block] = await Promise.all([
    rw.balanceOf(AUDITOR),
    rw.lockUntil(AUDITOR),
    provider.getBlockNumber(),
  ]);

  console.log(`📋  Contract:          ${AUDITOR}`);
  console.log(`💰  Balance BEFORE:    ${ethers.formatEther(balBefore)} RITUAL`);
  console.log(`🔒  Lock until block:  ${lockUntil} (current: ${block})`);
  console.log(`👛  Funder wallet:     ${wallet.address}`);
  console.log(`💵  Funder balance:    ${ethers.formatEther(await provider.getBalance(wallet.address))} RITUAL\n`);

  // Deposit 1.0 RITUAL via depositForFees()
  const FUND_AMOUNT = ethers.parseEther("1.0");
  console.log(`💸  Depositing ${ethers.formatEther(FUND_AMOUNT)} RITUAL into RitualWallet...`);

  const auditorAbi = ["function depositForFees() external payable"];
  const auditorContract = new ethers.Contract(AUDITOR, auditorAbi, wallet);

  const tx = await auditorContract.depositForFees({
    value:    FUND_AMOUNT,
    gasLimit: 300_000n,
    gasPrice: 1_500_000_000n,
  });

  console.log(`   TX hash: ${tx.hash}`);
  console.log("   Waiting for confirmation...");
  const receipt = await tx.wait();

  if (receipt.status === 1) {
    const balAfter = await rw.balanceOf(AUDITOR);
    console.log(`\n✅  FUNDED!`);
    console.log(`   Balance AFTER: ${ethers.formatEther(balAfter)} RITUAL`);
    console.log(`   Explorer: https://explorer.ritualfoundation.org/tx/${tx.hash}`);
  } else {
    console.error("❌  TX reverted!");
  }
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
