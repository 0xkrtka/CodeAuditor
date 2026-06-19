const { ethers } = require("ethers");

async function main() {
  const blockHex = "0x2040bfe";
  const RPC_URL = "https://rpc.ritualfoundation.org";
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  console.log(`🔍 Fetching raw block ${blockHex} (${parseInt(blockHex, 16)})...`);
  try {
    const block = await provider.send("eth_getBlockByNumber", [blockHex, true]);
    console.log("Block details:");
    console.log("  Hash:", block.hash);
    console.log("  Tx Count:", block.transactions.length);
    
    block.transactions.forEach((tx, idx) => {
      console.log(`\n  Tx #${idx}:`);
      console.log("    Hash:", tx.hash);
      console.log("    From:", tx.from);
      console.log("    To:", tx.to);
      console.log("    Nonce:", parseInt(tx.nonce, 16));
      console.log("    Gas:", tx.gas);
      console.log("    Type:", tx.type);
    });
  } catch (err) {
    console.error("Error:", err);
  }
}

main().catch(console.error);
