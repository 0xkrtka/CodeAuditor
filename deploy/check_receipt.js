/**
 * Check receipt of a transaction using raw RPC to avoid Ethers.js overflow parsing errors
 * Usage: node deploy/check_receipt.js <txHash>
 */
const { ethers } = require("ethers");

async function main() {
  const txHash = process.argv[2] || "0x7688af01148ae26bd91d614548cdbfc236c402e268ed0fad9910b2a2acb14150";
  const RPC_URL = "https://rpc.ritualfoundation.org";

  const provider = new ethers.JsonRpcProvider(RPC_URL);

  console.log(`🔍  Fetching receipt for: ${txHash}...`);
  try {
    const rawReceipt = await provider.send("eth_getTransactionReceipt", [txHash]);
    if (!rawReceipt) {
      console.log("❌  No receipt found yet. Transaction might still be pending or failed to include.");
      return;
    }

    console.log("\n📦  Raw Receipt Summary:");
    console.log(`   Block Number: ${parseInt(rawReceipt.blockNumber, 16)}`);
    console.log(`   Status:       ${rawReceipt.status === "0x1" ? "✅ SUCCESS" : "❌ REVERTED"}`);
    console.log(`   Gas Used:     ${parseInt(rawReceipt.gasUsed, 16)}`);
    console.log(`   Logs Count:   ${rawReceipt.logs ? rawReceipt.logs.length : 0}`);

    if (rawReceipt.logs) {
      console.log(`\n📄  Logs:`);
      rawReceipt.logs.forEach((log, idx) => {
        console.log(`   [${idx}] Address: ${log.address}`);
        console.log(`       Topics:  ${JSON.stringify(log.topics)}`);
      });
    }
  } catch (err) {
    console.error("❌  Error fetching receipt:", err.message);
  }
}

main().catch(console.error);
