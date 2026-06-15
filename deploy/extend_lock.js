/**
 * Extend RitualWallet lock duration for the EOA (owner/user wallet)
 * Usage: $env:PRIVATE_KEY="..."; node deploy/extend_lock.js
 */
const { ethers } = require("ethers");

async function main() {
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  if (!PRIVATE_KEY) {
    console.error("❌  Set PRIVATE_KEY env var dulu");
    process.exit(1);
  }

  const WALLET    = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948";
  const RPC_URL   = "https://rpc.ritualfoundation.org";

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet   = new ethers.Wallet(PRIVATE_KEY.replace("0x", ""), provider);

  const ritualWallet = new ethers.Contract(WALLET, [
    "function deposit(uint256 lockDuration) external payable",
    "function balanceOf(address user) external view returns (uint256)",
    "function lockUntil(address user) external view returns (uint256)",
  ], wallet);

  const currentBlock = await provider.getBlockNumber();
  const balBefore = await ritualWallet.balanceOf(wallet.address);
  const lockBefore = await ritualWallet.lockUntil(wallet.address);

  console.log(`👛  EOA Address:          ${wallet.address}`);
  console.log(`🏦  RitualWallet Balance: ${ethers.formatEther(balBefore)} RITUAL`);
  console.log(`🔒  Current Lock Until:   Block ${lockBefore.toString()} (Current Block: ${currentBlock})`);

  // Extend lock by depositing 0.01 RITUAL with 100,000 blocks lock duration (~10 hours)
  const lockDuration = 100000n;
  const depositVal = ethers.parseEther("0.01");

  console.log(`\n⏳  Depositing ${ethers.formatEther(depositVal)} RITUAL to extend lock by ${lockDuration} blocks...`);
  try {
    const tx = await ritualWallet.deposit(lockDuration, {
      value: depositVal,
    });
    console.log(`   Tx: ${tx.hash}`);
    console.log(`   Waiting for receipt...`);
    const receipt = await tx.wait();
    console.log(`   Status: ${receipt.status === 1 ? "✅ SUCCESS" : "❌ FAILED"}`);
  } catch (err) {
    console.error("❌  Deposit failed:", err.message);
  }

  const balAfter = await ritualWallet.balanceOf(wallet.address);
  const lockAfter = await ritualWallet.lockUntil(wallet.address);
  console.log(`\n🏦  New RitualWallet Balance: ${ethers.formatEther(balAfter)} RITUAL`);
  console.log(`🔒  New Lock Until:   Block ${lockAfter.toString()}`);
}

main().catch((err) => {
  console.error("❌ Fatal:", err.message);
  process.exit(1);
});
