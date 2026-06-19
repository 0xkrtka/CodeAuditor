/**
 * Set auditFee = 0 on CodeAuditor contract
 * Jalankan: $env:PRIVATE_KEY="..."; node deploy/set_free.js
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
  let AUDITOR_ADDRESS = "0x8a0237E3eDD7df869948E8e975801eB7d04ddBAa";
  try {
    const envContent = fs.readFileSync(path.join(__dirname, "../.env.local"), "utf8");
    const matchAuditor = envContent.match(/NEXT_PUBLIC_AUDITOR_ADDRESS=(0x[a-fA-F0-9]{40})/);
    if (matchAuditor) AUDITOR_ADDRESS = matchAuditor[1];
  } catch (e) {}

  const RPC_URL         = "https://rpc.ritualfoundation.org";

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet   = new ethers.Wallet(PRIVATE_KEY.replace("0x", ""), provider);

  console.log("👛  Wallet:", wallet.address);

  const contract = new ethers.Contract(
    AUDITOR_ADDRESS,
    ["function setAuditFee(uint256 newFee) external",
     "function auditFee() view returns (uint256)"],
    wallet
  );

  const before = await contract.auditFee();
  console.log("💰  Current auditFee:", ethers.formatEther(before), "mRITUAL");

  console.log("✏️   Setting auditFee = 0...");
  const tx = await contract.setAuditFee(0n);
  console.log("   Tx hash:", tx.hash);
  await tx.wait();

  const after = await contract.auditFee();
  console.log("✅  New auditFee:", ethers.formatEther(after), "mRITUAL");
  console.log("\n🎉  Done! Users no longer need mRITUAL to audit.");
}

main().catch((err) => {
  console.error("❌  Failed:", err.message || err);
  process.exit(1);
});
