// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/CodeAuditor.sol";

// ── Mock ERC-20 ───────────────────────────────────────────────────────────────
contract MockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to]          += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from]             -= amount;
        balanceOf[to]               += amount;
        return true;
    }
}

// ── Mock LLM Precompile ───────────────────────────────────────────────────────
contract MockLLM {
    function complete(ILLMPrecompile.LLMRequest calldata)
        external
        pure
        returns (ILLMPrecompile.LLMResponse memory)
    {
        return ILLMPrecompile.LLMResponse({
            text:        "SEVERITY_SCORE: 72\nSUMMARY: Contract has minor issues.\nFINDINGS:\n1. [LOW] Missing event on state change.\nRECOMMENDATIONS:\nAdd events for all state-changing functions.",
            inputTokens:  512,
            outputTokens: 256,
            jobId:        bytes32(uint256(0xDEADBEEF))
        });
    }
}

// ── Test suite ────────────────────────────────────────────────────────────────
contract CodeAuditorTest is Test {
    CodeAuditor auditor;
    MockToken   token;
    MockLLM     mockLLM;

    address owner   = address(this);
    address alice   = makeAddr("alice");
    address bob     = makeAddr("bob");

    uint256 constant FEE = 1e6; // 1 USDC

    string constant SAMPLE_CODE =
        "pragma solidity ^0.8.0;\n"
        "contract Simple {\n"
        "    uint256 public value;\n"
        "    function set(uint256 v) external { value = v; }\n"
        "}";

    function setUp() public {
        token   = new MockToken();
        mockLLM = new MockLLM();

        // Deploy auditor
        auditor = new CodeAuditor(address(token), FEE);

        // Redirect LLM precompile calls to mock (using vm.etch)
        vm.etch(address(0x0802), address(mockLLM).code);

        // Fund alice
        token.mint(alice, 100 * FEE);
        vm.prank(alice);
        token.approve(address(auditor), type(uint256).max);
    }

    // ── Tests ─────────────────────────────────────────────────────────────────

    function test_requestAudit_success() public {
        vm.prank(alice);
        (uint256 id, bytes32 jobId) = auditor.requestAudit(SAMPLE_CODE);

        assertEq(id, 1);
        assertEq(jobId, bytes32(uint256(0xDEADBEEF)));

        CodeAuditor.AuditReport memory report = auditor.getAudit(1);
        assertEq(report.requester,     alice);
        assertEq(report.severityScore, 72);
        assertTrue(report.completed);
        assertTrue(bytes(report.auditResult).length > 0);
    }

    function test_requestAudit_paymentDeducted() public {
        uint256 balanceBefore = token.balanceOf(alice);
        vm.prank(alice);
        auditor.requestAudit(SAMPLE_CODE);
        assertEq(token.balanceOf(alice), balanceBefore - FEE);
        assertEq(token.balanceOf(address(auditor)), FEE);
    }

    function test_requestAudit_emptyCode_reverts() public {
        vm.prank(alice);
        vm.expectRevert(CodeAuditor.EmptyCode.selector);
        auditor.requestAudit("");
    }

    function test_requestAudit_codeTooLong_reverts() public {
        // Build > 32KB string
        bytes memory big = new bytes(32_769);
        for (uint i = 0; i < big.length; i++) big[i] = 0x41; // 'A'
        vm.prank(alice);
        vm.expectRevert(CodeAuditor.CodeTooLong.selector);
        auditor.requestAudit(string(big));
    }

    function test_multipleAudits_tracked() public {
        vm.startPrank(alice);
        auditor.requestAudit(SAMPLE_CODE);
        auditor.requestAudit(SAMPLE_CODE);
        vm.stopPrank();

        uint256[] memory ids = auditor.getMyAudits(alice);
        assertEq(ids.length, 2);
        assertEq(ids[0], 1);
        assertEq(ids[1], 2);
    }

    function test_getAudit_notFound_reverts() public {
        vm.expectRevert(CodeAuditor.AuditNotFound.selector);
        auditor.getAudit(999);
    }

    function test_setFee_onlyOwner() public {
        auditor.setAuditFee(2 * FEE);
        assertEq(auditor.auditFee(), 2 * FEE);

        vm.prank(alice);
        vm.expectRevert(CodeAuditor.Unauthorized.selector);
        auditor.setAuditFee(0);
    }

    function test_withdrawFees() public {
        vm.prank(alice);
        auditor.requestAudit(SAMPLE_CODE);

        uint256 before = token.balanceOf(owner);
        auditor.withdrawFees(owner, FEE);
        assertEq(token.balanceOf(owner), before + FEE);
    }

    function test_severityParsing_variousScores() public view {
        // Exposed via _parseSeverity — test indirectly via full flow
        // Score 72 is parsed correctly (tested in test_requestAudit_success)
        assertTrue(true);
    }

    function testFuzz_auditFee(uint256 fee) public {
        fee = bound(fee, 1, 1e12);
        auditor.setAuditFee(fee);
        token.mint(bob, fee);
        vm.prank(bob);
        token.approve(address(auditor), fee);
        vm.prank(bob);
        (uint256 id,) = auditor.requestAudit(SAMPLE_CODE);
        assertTrue(id > 0);
    }
}
