const { ethers } = require("ethers");

async function main() {
  const txHash = "0x78c767f1c0cedf57cceca97f5a597dbb0432e2a72ad73201b9dd2e79fc3bb07a";
  const RPC_URL = "https://rpc.ritualfoundation.org";
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  console.log(`🔍 Checking transaction status for: ${txHash}...`);

  try {
    const tx = await provider.getTransaction(txHash);
    if (tx) {
      console.log("🎉 Transaction found in RPC node!");
      console.log("  Block:", tx.blockNumber ? tx.blockNumber : "Pending (in mempool)");
      console.log("  From:", tx.from);
      console.log("  To:", tx.to);
      console.log("  Nonce:", tx.nonce);
      console.log("  Value:", ethers.formatEther(tx.value), "RITUAL");
      
      const receipt = await provider.getTransactionReceipt(txHash);
      if (receipt) {
        console.log("  Receipt Status:", receipt.status === 1 ? "SUCCESS" : "REVERTED");
        console.log("  Gas Used:", receipt.gasUsed.toString());
      } else {
        console.log("  No receipt yet (still pending or dropped).");
      }
    } else {
      console.log("❌ Transaction NOT found on the RPC node (never reached the mempool or was dropped immediately).");
    }
  } catch (err) {
    console.error("Error:", err.message);
  }
}

main().catch(console.error);
