const { ethers } = require("ethers");

async function main() {
  const user = "0xe1e8BD93279529831b789133BD76e7c30D54d200";
  const AUDITOR = "0x8a0237E3eDD7df869948E8e975801eB7d04ddBAa";
  const RPC_URL = "https://rpc.ritualfoundation.org";
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  const iface = new ethers.Interface([
    "function requestAudit(string contractCode, address executor) external returns (uint256 auditId, bytes32 jobId)",
  ]);

  const testCode = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @title Vault — Classic reentrancy vulnerability example
contract Vault {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    // ⚠️  Reentrancy vulnerability: state updated AFTER external call
    function withdraw() external {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "No balance");
        // External call before state update — attacker can re-enter!
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");
        balances[msg.sender] = 0; // BUG: should be BEFORE the call
    }

    function getBalance(address user) external view returns (uint256) {
        return balances[user];
    }
}`;

  const escapedCode = JSON.stringify(testCode).slice(1, -1);
  const calldata = iface.encodeFunctionData("requestAudit", [escapedCode, "0x0000000000000000000000000000000000000000"]);

  console.log(`🤖 Simulating requestAudit call from ${user}...`);
  
  // 1. Try eth_call to see if it reverts
  try {
    const result = await provider.call({
      to: AUDITOR,
      data: calldata,
      from: user,
    });
    console.log(`✅ eth_call succeeded! Result length: ${result.length} bytes`);
    
    // Decode results
    const [auditId, jobId] = ethers.AbiCoder.defaultAbiCoder().decode(["uint256", "bytes32"], result);
    console.log(`  Audit ID: ${auditId.toString()}`);
    console.log(`  Job ID:   ${jobId}`);
  } catch (err) {
    console.error(`❌ eth_call REVERTED:`, err.message);
    if (err.data) {
      console.log(`Revert data: ${err.data}`);
    }
    return;
  }

  // 2. Estimate gas
  try {
    const gasEst = await provider.estimateGas({
      to: AUDITOR,
      data: calldata,
      from: user,
    });
    console.log(`⛽ Estimated Gas: ${gasEst.toString()} units`);
  } catch (err) {
    console.error(`❌ Gas Estimation Failed:`, err.message);
  }
}

main().catch(console.error);
