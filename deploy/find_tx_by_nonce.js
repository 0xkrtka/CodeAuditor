const { ethers } = require("ethers");

async function main() {
  const user = "0xf323551231727559a8b2684f8f039c37b693E5d7";
  const targetNonce = 36;
  const RPC_URL = "https://rpc.ritualfoundation.org";
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  let low = 33800000;
  const latestBlockHex = await provider.send("eth_blockNumber", []);
  let high = parseInt(latestBlockHex, 16);

  console.log(`Binary searching blocks to find where nonce ${targetNonce} was mined for ${user}...`);

  let foundBlock = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const midHex = "0x" + mid.toString(16);
    try {
      const count = await provider.getTransactionCount(user, midHex);
      console.log(`Block ${mid}: transaction count is ${count}`);

      if (count > targetNonce) {
        // Nonce 36 was mined at or before mid
        foundBlock = mid;
        high = mid - 1;
      } else {
        // Nonce 36 was mined after mid
        low = mid + 1;
      }
    } catch (err) {
      console.error(`Error at block ${mid}:`, err.message);
      break;
    }
  }

  if (foundBlock !== -1) {
    console.log(`\n🎉 Nonce ${targetNonce} was mined at block: ${foundBlock}`);
    // Inspect this block
    const block = await provider.send("eth_getBlockByNumber", ["0x" + foundBlock.toString(16), true]);
    if (block && block.transactions) {
      const tx = block.transactions.find(t => t.from.toLowerCase() === user.toLowerCase() && parseInt(t.nonce, 16) === targetNonce);
      if (tx) {
        console.log("Transaction Details:");
        console.log("  Hash:", tx.hash);
        console.log("  Gas Limit:", parseInt(tx.gas, 16));
        console.log("  Gas Price:", ethers.formatUnits(tx.gasPrice, "gwei"), "gwei");
        console.log("  To:", tx.to);
        console.log("  Input snippet:", tx.input.slice(0, 100));
      } else {
        console.log("Could not find the transaction with matching nonce inside the block (might be mutated).");
        // Print all transactions in the block
        block.transactions.forEach((t, idx) => {
          console.log(`Tx #${idx}: Hash=${t.hash}, From=${t.from}, To=${t.to}, Nonce=${parseInt(t.nonce, 16)}`);
        });
      }
    }
  } else {
    console.log("❌ Nonce 36 was not found.");
  }
}

main().catch(console.error);
