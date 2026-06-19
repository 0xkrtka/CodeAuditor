const { ethers } = require("ethers");

async function main() {
  const AUDITOR = "0x8a0237E3eDD7df869948E8e975801eB7d04ddBAa";
  const RPC_URL = "https://rpc.ritualfoundation.org";
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  const latestBlock = await provider.getBlockNumber();
  // Scan last 3000 blocks (~2.5 hours)
  const startBlock = latestBlock - 3000;

  console.log(`Scanning blocks ${startBlock} to ${latestBlock} for txs TO CodeAuditor...`);

  let found = [];
  const chunkSize = 50;
  for (let i = startBlock; i <= latestBlock; i += chunkSize) {
    const end = Math.min(i + chunkSize - 1, latestBlock);
    process.stdout.write(`\r  Scanning ${i}...`);
    const promises = [];
    for (let j = i; j <= end; j++) {
      const hexNum = "0x" + j.toString(16);
      promises.push(
        provider.send("eth_getBlockByNumber", [hexNum, true]).then(block => {
          if (!block || !block.transactions) return [];
          return block.transactions
            .filter(tx => tx.to && tx.to.toLowerCase() === AUDITOR.toLowerCase())
            .map(tx => ({
              blockNumber: parseInt(tx.blockNumber, 16),
              hash: tx.hash,
              from: tx.from,
              nonce: parseInt(tx.nonce, 16),
              gas: parseInt(tx.gas, 16),
            }));
        }).catch(() => [])
      );
    }
    const results = (await Promise.all(promises)).flat();
    found.push(...results);
  }

  console.log(`\n\nTotal found: ${found.length} transaction(s)`);
  for (const tx of found) {
    console.log(`\n  TX: ${tx.hash}`);
    console.log(`  From: ${tx.from}`);
    console.log(`  Block: ${tx.blockNumber}, Nonce: ${tx.nonce}, Gas: ${tx.gas}`);
    try {
      const receipt = await provider.getTransactionReceipt(tx.hash);
      if (receipt) {
        console.log(`  Status: ${receipt.status === 1 ? "✅ SUCCESS" : "❌ REVERTED"}`);
        console.log(`  Gas Used: ${receipt.gasUsed.toString()}`);
      }
    } catch (e) {
      console.log(`  Receipt error: ${e.message}`);
    }
  }
}

main().catch(console.error);
