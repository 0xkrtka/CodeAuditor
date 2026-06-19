const { ethers } = require("ethers");

async function main() {
  const targetTime = 1781673836181; // in milliseconds
  const RPC_URL = "https://rpc.ritualfoundation.org";
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  let low = 33800000;
  const latestBlockHex = await provider.send("eth_blockNumber", []);
  let high = parseInt(latestBlockHex, 16);

  console.log(`Binary searching blocks from ${low} to ${high} for timestamp ${targetTime}...`);

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const midHex = "0x" + mid.toString(16);
    try {
      const block = await provider.send("eth_getBlockByNumber", [midHex, false]);
      if (!block) {
        high = mid - 1;
        continue;
      }
      const time = Number(block.timestamp); // Keep as returned (milliseconds)
      
      if (Math.abs(time - targetTime) < 5000) { // Within 5 seconds
        console.log(`\n🎉 Found matching block: ${mid} (Timestamp: ${time})`);
        break;
      } else if (time < targetTime) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    } catch (err) {
      console.error(`Error fetching block ${mid}:`, err.message);
      break;
    }
  }
}

main().catch(console.error);
