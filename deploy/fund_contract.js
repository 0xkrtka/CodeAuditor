/**
 * Fund CodeAuditor's RitualWallet with RITUAL for executor fees
 * Usage: $env:PRIVATE_KEY="..."; node deploy/fund_contract.js
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
  const RPC_URL   = "https://rpc.ritualfoundation.org";

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet   = new ethers.Wallet(PRIVATE_KEY.replace("0x", ""), provider);

  const ritualWallet = new ethers.Contract(WALLET, [
    "function balanceOf(address) view returns (uint256)",
  ], provider);

  // Check current balance
  const before = await ritualWallet.balanceOf(AUDITOR);
  console.log(`🏦  Current RitualWallet balance: ${ethers.formatEther(before)} RITUAL`);

  // Deposit via contract's depositForFees()
  const amount = ethers.parseEther("0.4");
  console.log(`\n💰  Depositing ${ethers.formatEther(amount)} RITUAL to contract's RitualWallet...`);

  const depositData = new ethers.Interface([
    "function depositForFees() external payable",
  ]).encodeFunctionData("depositForFees");

  const tx = await wallet.sendTransaction({
    to:    AUDITOR,
    data:  depositData,
    value: amount,
    gasLimit: 500_000n,
  });

  console.log(`   Tx: ${tx.hash}`);
  console.log(`   Waiting for confirmation...`);
  const receipt = await tx.wait();
  console.log(`   Status: ${receipt.status === 1 ? "✅ SUCCESS" : "❌ FAILED"}`);

  // Check new balance
  const after = await ritualWallet.balanceOf(AUDITOR);
  console.log(`\n🏦  New RitualWallet balance: ${ethers.formatEther(after)} RITUAL`);
  console.log(`\n🎉  Done! Contract is now funded for LLM audits.`);
}

main().catch((err) => {
  console.error("❌ Failed:", err.message);
  process.exit(1);
});
