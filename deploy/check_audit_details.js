const { ethers } = require("ethers");

async function main() {
  const AUDITOR = "0x8a0237E3eDD7df869948E8e975801eB7d04ddBAa";
  const RPC_URL = "https://rpc.ritualfoundation.org";
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  const auditor = new ethers.Contract(AUDITOR, [
    "function getAudit(uint256) view returns (tuple(uint256 id, address requester, bytes32 codeHash, string auditResult, bytes32 jobId, uint8 severityScore, uint256 timestamp, bool completed))",
  ], provider);

  console.log("🔍 Fetching Audit ID 1...");
  try {
    const audit = await auditor.getAudit(1);
    console.log("Audit ID 1 Details:");
    console.log("  Id:", audit.id.toString());
    console.log("  Requester:", audit.requester);
    console.log("  CodeHash:", audit.codeHash);
    console.log("  JobId:", audit.jobId);
    console.log("  SeverityScore:", audit.severityScore.toString());
    console.log("  Timestamp:", new Date(Number(audit.timestamp) * 1000).toISOString());
    console.log("  Completed:", audit.completed);
    console.log("  Result snippet:", audit.auditResult.slice(0, 300));
  } catch (err) {
    console.error("Error:", err);
  }
}

main().catch(console.error);
