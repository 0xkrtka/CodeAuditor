const { ethers } = require("ethers");

async function main() {
  const targetUser = "0xf323551231727559a8b2684f8f039c37b693E5d7";
  const RPC_URL = "https://rpc.ritualfoundation.org";
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  const latestBlockHex = await provider.send("eth_blockNumber", []);
  const latestBlock = parseInt(latestBlockHex, 16);
  const startBlock = latestBlock - 100;
  const endBlock = latestBlock;
  console.log(`Scanning blocks ${startBlock} to ${endBlock} for owner: ${targetUser}...`);

  const chunkSize = 20;
  for (let i = startBlock; i <= endBlock; i += chunkSize) {
    const promises = [];
    for (let j = i; j < i + chunkSize && j <= endBlock; j++) {
      const hexNum = "0x" + j.toString(16);
      promises.push(
        provider.send("eth_getBlockByNumber", [hexNum, true]).then(block => {
          if (!block || !block.transactions) return null;
          const txs = [];
          for (const tx of block.transactions) {
            if (tx.from && tx.from.toLowerCase() === targetUser.toLowerCase()) {
              txs.push({
                blockNumber: parseInt(tx.blockNumber, 16),
                hash: tx.hash,
                nonce: parseInt(tx.nonce, 16),
                to: tx.to,
                value: tx.value,
                gas: tx.gas,
                gasPrice: tx.gasPrice,
              });
            }
          }
          return txs.length > 0 ? txs : null;
        }).catch(() => null)
      );
    }
    const results = await Promise.all(promises);
    const found = results.flat().filter(r => r !== null);
    if (found.length > 0) {
      console.log(`\n🎉 Found transactions:`, JSON.stringify(found, null, 2));
    }
  }
  console.log("Scan complete.");
}

main().catch(console.error);
