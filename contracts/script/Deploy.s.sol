// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/CodeAuditor.sol";

/**
 * Deploy CodeAuditor to Ritual Chain (Chain ID 1979)
 *
 * Usage:
 *   forge script script/Deploy.s.sol \
 *     --rpc-url https://rpc.ritualfoundation.org \
 *     --broadcast \
 *     --private-key $PRIVATE_KEY
 */
contract DeployScript is Script {

    // Ritual Chain testnet — use RITUAL token as payment
    // Replace with actual USDC/stablecoin address when available
    address constant PAYMENT_TOKEN = 0x0000000000000000000000000000000000000000; // set before deploy
    uint256 constant AUDIT_FEE     = 1e15; // 0.001 RITUAL (18 decimals)

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        console.log("=== CodeAuditor Deployment ===");
        console.log("Chain ID:      ", block.chainid);
        console.log("Deployer:      ", deployer);
        console.log("Balance:       ", deployer.balance);
        console.log("Payment token: ", PAYMENT_TOKEN);
        console.log("Audit fee:     ", AUDIT_FEE);

        require(block.chainid == 1979, "Must deploy to Ritual Chain (1979)");
        require(PAYMENT_TOKEN != address(0), "Set PAYMENT_TOKEN before deploying");

        vm.startBroadcast(deployerKey);

        CodeAuditor auditor = new CodeAuditor(PAYMENT_TOKEN, AUDIT_FEE);

        vm.stopBroadcast();

        console.log("\n=== Deployed ===");
        console.log("CodeAuditor:   ", address(auditor));
        console.log("Explorer:      https://explorer.ritualfoundation.org/address/", address(auditor));

        // Write address to file for frontend
        string memory out = string(abi.encodePacked(
            '{\n',
            '  "CodeAuditor": "', vm.toString(address(auditor)), '",\n',
            '  "chainId": 1979,\n',
            '  "paymentToken": "', vm.toString(PAYMENT_TOKEN), '",\n',
            '  "auditFee": "', vm.toString(AUDIT_FEE), '"\n',
            '}'
        ));
        vm.writeFile("../frontend/src/lib/deployment.json", out);
        console.log("\nDeployment info written to frontend/src/lib/deployment.json");
    }
}
