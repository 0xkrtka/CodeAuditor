const { ethers } = require("ethers");

async function main() {
  const txHash = process.argv[2];
  if (!txHash) {
    console.error("❌ Please provide a txHash");
    process.exit(1);
  }
  const RPC_URL = "https://rpc.ritualfoundation.org";
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  console.log(`🔍 Checking raw data for transaction: ${txHash}`);
  try {
    const tx = await provider.send("eth_getTransactionByHash", [txHash]);
    console.log("\nTransaction Details:", JSON.stringify(tx, null, 2));

    const receipt = await provider.send("eth_getTransactionReceipt", [txHash]);
    console.log("\nTransaction Receipt:", JSON.stringify(receipt, null, 2));
  } catch (err) {
    console.error("Error fetching raw data:", err);
  }
}

main().catch(console.error);
