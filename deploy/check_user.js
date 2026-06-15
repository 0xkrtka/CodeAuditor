/**
 * Check EOA status: nonce, balance, and last transactions
 * Usage: node deploy/check_user.js <eoaAddress>
 */
const { ethers } = require("ethers");

async function main() {
  const user = process.argv[2] || "0xe1e8BD93279529831b789133BD76e7c30D54d200";
  const RPC_URL = "https://rpc.ritualfoundation.org";

  const provider = new ethers.JsonRpcProvider(RPC_URL);

  console.log(`👤  Checking user: ${user}`);
  
  const balance = await provider.getBalance(user);
  console.log(`💰  Native Balance:    ${ethers.formatEther(balance)} RITUAL`);

  const nonceLatest = await provider.getTransactionCount(user, "latest");
  const noncePending = await provider.getTransactionCount(user, "pending");
  console.log(`🔢  Nonce (latest):     ${nonceLatest}`);
  console.log(`🔢  Nonce (pending):    ${noncePending}`);

  const WALLET = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948";
  const ritualWallet = new ethers.Contract(WALLET, [
    "function balanceOf(address user) external view returns (uint256)",
    "function lockUntil(address user) external view returns (uint256)",
  ], provider);

  const wBal = await ritualWallet.balanceOf(user);
  const lock = await ritualWallet.lockUntil(user);
  const currentBlock = await provider.getBlockNumber();

  console.log(`🏦  RitualWallet Balance: ${ethers.formatEther(wBal)} RITUAL`);
  console.log(`🔒  Lock Until Block:     ${lock.toString()} (Current Block: ${currentBlock})`);
  console.log(`⏳  Locked status:        ${currentBlock < lock ? "LOCKED" : "EXPIRED/UNLOCKED"}`);

  // Query audit contract details
  const AUDITOR = "0x8a0237E3eDD7df869948E8e975801eB7d04ddBAa";
  const auditor = new ethers.Contract(AUDITOR, [
    "function auditCount() view returns (uint256)",
    "function auditsByUser(address, uint256) view returns (uint256)",
    "function getMyAudits(address) view returns (uint256[] memory)",
  ], provider);

  try {
    const myAudits = await auditor.getMyAudits(user);
    console.log(`📊  Audits by user in V6: ${myAudits.length} (IDs: ${myAudits.join(", ")})`);
  } catch (err) {
    console.log(`⚠️  Could not fetch audits: ${err.message}`);
  }
}

main().catch(console.error);
