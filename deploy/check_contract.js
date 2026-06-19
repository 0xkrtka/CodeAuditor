const { ethers } = require("ethers");

async function main() {
  const AUDITOR = "0x8a0237E3eDD7df869948E8e975801eB7d04ddBAa";
  const RPC_URL = "https://rpc.ritualfoundation.org";
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  console.log(`🏦 Checking CodeAuditor contract: ${AUDITOR}`);

  const balance = await provider.getBalance(AUDITOR);
  console.log(`💰 Native Balance:    ${ethers.formatEther(balance)} RITUAL`);

  const WALLET = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948";
  const ritualWallet = new ethers.Contract(WALLET, [
    "function balanceOf(address user) external view returns (uint256)",
    "function lockUntil(address user) external view returns (uint256)",
  ], provider);

  const wBal = await ritualWallet.balanceOf(AUDITOR);
  const lock = await ritualWallet.lockUntil(AUDITOR);
  const currentBlock = await provider.getBlockNumber();

  const auditorContract = new ethers.Contract(AUDITOR, [
    "function auditFee() external view returns (uint256)",
  ], provider);
  const fee = await auditorContract.auditFee();

  console.log(`🏦 RitualWallet Balance: ${ethers.formatEther(wBal)} RITUAL`);
  console.log(`🔒 Lock Until Block:     ${lock.toString()} (Current Block: ${currentBlock})`);
  console.log(`⏳ Locked status:        ${currentBlock < lock ? "LOCKED" : "EXPIRED/UNLOCKED"}`);
  console.log(`🪙 Contract Audit Fee:   ${ethers.formatEther(fee)} mRITUAL`);
}

main().catch(console.error);
