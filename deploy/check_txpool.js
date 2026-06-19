const { ethers } = require("ethers");

async function main() {
  const address = "0xf323551231727559a8b2684f8f039c37b693E5d7";
  const RPC_URL = "https://rpc.ritualfoundation.org";
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  console.log(`🔍 Checking txpool status...`);
  try {
    const status = await provider.send("txpool_status", []);
    console.log("Txpool Status:", status);
  } catch (err) {
    console.log("txpool_status not supported:", err.message);
  }

  try {
    const content = await provider.send("txpool_content", []);
    console.log("\nChecking pending/queued in txpool for:", address);
    
    const pending = content.pending[address.toLowerCase()] || content.pending[address] || {};
    const queued = content.queued[address.toLowerCase()] || content.queued[address] || {};
    
    console.log("Pending txs:", Object.keys(pending));
    console.log("Queued txs:", Object.keys(queued));
    
    if (Object.keys(pending).length > 0) {
      console.log("Pending details:", JSON.stringify(pending, null, 2));
    }
    if (Object.keys(queued).length > 0) {
      console.log("Queued details:", JSON.stringify(queued, null, 2));
    }
  } catch (err) {
    console.log("txpool_content not supported:", err.message);
  }
}

main().catch(console.error);
