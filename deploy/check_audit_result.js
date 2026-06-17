const { ethers } = require("ethers");

async function main() {
  const auditId = process.argv[2] || "1";
  const AUDITOR   = "0x8a0237E3eDD7df869948E8e975801eB7d04ddBAa";
  const RPC_URL   = "https://rpc.ritualfoundation.org";
  
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const auditorContract = new ethers.Contract(AUDITOR, [
    "function getAudit(uint256) view returns (tuple(uint256 id, address requester, bytes32 codeHash, string auditResult, bytes32 jobId, uint8 severityScore, uint256 timestamp, bool completed))",
  ], provider);

  console.log(`🔍 Querying audit ID ${auditId}...`);
  try {
    const audit = await auditorContract.getAudit(auditId);
    console.log("\n📦 Audit Details:");
    console.log(`   Requester:      ${audit.requester}`);
    console.log(`   Code Hash:      ${audit.codeHash}`);
    console.log(`   Job ID:         ${audit.jobId}`);
    console.log(`   Severity Score: ${audit.severityScore}`);
    console.log(`   Timestamp:      ${new Date(Number(audit.timestamp) * 1000).toLocaleString()}`);
    console.log(`   Completed:      ${audit.completed}`);
    console.log(`   Result Length:  ${audit.auditResult.length} characters`);
    
    if (audit.auditResult) {
      console.log("\n📄 Audit Result:");
      console.log(audit.auditResult);
    }
  } catch (err) {
    console.error("❌ Error querying audit:", err.message);
  }
}

main().catch(console.error);
