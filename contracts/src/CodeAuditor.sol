// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CodeAuditor
 * @notice On-chain Solidity audit powered by Ritual LLM precompile (0x0802)
 *         Pay-per-audit via X402 micropayment pattern.
 *         Audit results stream back via SSE; final report stored on-chain.
 */

// ─── Ritual LLM Precompile interface ─────────────────────────────────────────
interface ILLMPrecompile {
    struct LLMRequest {
        string  model;      // e.g. "zai-org/GLM-4.7-FP8"
        string  prompt;
        uint32  maxTokens;
        bool    stream;     // true = SSE streaming tokens to frontend
    }

    struct LLMResponse {
        string  text;
        uint64  inputTokens;
        uint64  outputTokens;
        bytes32 jobId;      // async job reference for SSE
    }

    function complete(LLMRequest calldata req)
        external
        returns (LLMResponse memory);
}

// ─── Minimal ERC-20 for payment token ────────────────────────────────────────
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

// ─── Main contract ────────────────────────────────────────────────────────────
contract CodeAuditor {

    // ── Constants ───────────────────────────────────────────────────────────
    address public constant LLM_PRECOMPILE = address(0x0802);
    string  public constant MODEL          = "zai-org/GLM-4.7-FP8";
    uint32  public constant MAX_TOKENS     = 2048;

    // ── State ────────────────────────────────────────────────────────────────
    address public immutable owner;
    IERC20  public immutable paymentToken;   // USDC or RITUAL token
    uint256 public auditFee;                 // amount in token units (e.g. 1e6 = 1 USDC)

    uint256 public auditCount;

    struct AuditReport {
        uint256 id;
        address requester;
        string  contractCode;       // submitted Solidity source
        string  auditResult;        // LLM response stored on-chain
        bytes32 jobId;              // SSE streaming reference
        uint8   severityScore;      // 0-100 (0=critical, 100=clean)
        uint256 timestamp;
        bool    completed;
    }

    mapping(uint256 => AuditReport) public audits;
    mapping(address => uint256[])   public auditsByUser;

    // ── Events ───────────────────────────────────────────────────────────────
    event AuditRequested(
        uint256 indexed auditId,
        address indexed requester,
        bytes32         jobId,        // frontend polls SSE on this jobId
        uint256         timestamp
    );

    event AuditCompleted(
        uint256 indexed auditId,
        address indexed requester,
        uint8           severityScore,
        uint256         tokensCost
    );

    event FeeUpdated(uint256 oldFee, uint256 newFee);

    // ── Errors ───────────────────────────────────────────────────────────────
    error Unauthorized();
    error EmptyCode();
    error CodeTooLong();
    error AuditNotFound();
    error AlreadyCompleted();
    error PaymentFailed();

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor(address _paymentToken, uint256 _auditFee) {
        owner        = msg.sender;
        paymentToken = IERC20(_paymentToken);
        auditFee     = _auditFee;
    }

    // ── Modifiers ─────────────────────────────────────────────────────────────
    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  PUBLIC: Request an audit
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Submit Solidity source code for on-chain AI audit.
     *         Caller must have approved this contract to spend `auditFee` tokens.
     * @param  contractCode  Raw Solidity source (UTF-8 string, max 32KB)
     * @return auditId       The new audit's ID
     * @return jobId         SSE job reference — pass to frontend for streaming
     */
    function requestAudit(string calldata contractCode)
        external
        returns (uint256 auditId, bytes32 jobId)
    {
        if (bytes(contractCode).length == 0)      revert EmptyCode();
        if (bytes(contractCode).length > 32_768)  revert CodeTooLong();

        // ── Collect payment ──────────────────────────────────────────────────
        bool paid = paymentToken.transferFrom(msg.sender, address(this), auditFee);
        if (!paid) revert PaymentFailed();

        // ── Build audit prompt ───────────────────────────────────────────────
        string memory prompt = _buildPrompt(contractCode);

        // ── Call Ritual LLM precompile ───────────────────────────────────────
        ILLMPrecompile llm = ILLMPrecompile(LLM_PRECOMPILE);

        ILLMPrecompile.LLMRequest memory req = ILLMPrecompile.LLMRequest({
            model:     MODEL,
            prompt:    prompt,
            maxTokens: MAX_TOKENS,
            stream:    true        // enable SSE token streaming
        });

        ILLMPrecompile.LLMResponse memory resp = llm.complete(req);

        // ── Store audit record ───────────────────────────────────────────────
        auditId = ++auditCount;
        jobId   = resp.jobId;

        audits[auditId] = AuditReport({
            id:            auditId,
            requester:     msg.sender,
            contractCode:  contractCode,
            auditResult:   resp.text,
            jobId:         resp.jobId,
            severityScore: _parseSeverity(resp.text),
            timestamp:     block.timestamp,
            completed:     true
        });

        auditsByUser[msg.sender].push(auditId);

        emit AuditRequested(auditId, msg.sender, jobId, block.timestamp);
        emit AuditCompleted(
            auditId,
            msg.sender,
            audits[auditId].severityScore,
            resp.inputTokens + resp.outputTokens
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  READ: Query audits
    // ─────────────────────────────────────────────────────────────────────────

    function getAudit(uint256 auditId)
        external
        view
        returns (AuditReport memory)
    {
        if (audits[auditId].requester == address(0)) revert AuditNotFound();
        return audits[auditId];
    }

    function getMyAudits(address user)
        external
        view
        returns (uint256[] memory)
    {
        return auditsByUser[user];
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  ADMIN
    // ─────────────────────────────────────────────────────────────────────────

    function setAuditFee(uint256 newFee) external onlyOwner {
        emit FeeUpdated(auditFee, newFee);
        auditFee = newFee;
    }

    function withdrawFees(address to, uint256 amount) external onlyOwner {
        paymentToken.transfer(to, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  INTERNAL HELPERS
    // ─────────────────────────────────────────────────────────────────────────

    function _buildPrompt(string memory code)
        internal
        pure
        returns (string memory)
    {
        return string(abi.encodePacked(
            "You are a senior smart contract security auditor. Analyze the following Solidity code for:\n",
            "1. CRITICAL vulnerabilities (reentrancy, integer overflow, unchecked calls, access control)\n",
            "2. HIGH severity issues (gas griefing, front-running, improper validation)\n",
            "3. MEDIUM issues (code quality, gas inefficiency, missing events)\n",
            "4. LOW / informational notes\n\n",
            "Format your response as:\n",
            "SEVERITY_SCORE: [0-100 integer, 0=critical issues, 100=clean]\n",
            "SUMMARY: [2 sentence overview]\n",
            "FINDINGS:\n[numbered list of findings with severity tag]\n",
            "RECOMMENDATIONS:\n[actionable fixes]\n\n",
            "CONTRACT CODE:\n```solidity\n",
            code,
            "\n```"
        ));
    }

    /**
     * @dev Parse SEVERITY_SCORE from LLM text response.
     *      Looks for "SEVERITY_SCORE: <number>" pattern.
     *      Falls back to 50 if not found.
     */
    function _parseSeverity(string memory text)
        internal
        pure
        returns (uint8)
    {
        bytes memory b = bytes(text);
        bytes memory pattern = bytes("SEVERITY_SCORE: ");
        uint256 patLen = pattern.length;

        for (uint256 i = 0; i + patLen + 1 < b.length; i++) {
            bool match = true;
            for (uint256 j = 0; j < patLen; j++) {
                if (b[i + j] != pattern[j]) { match = false; break; }
            }
            if (match) {
                uint256 num = 0;
                uint256 pos = i + patLen;
                while (pos < b.length && b[pos] >= 0x30 && b[pos] <= 0x39) {
                    num = num * 10 + (uint8(b[pos]) - 48);
                    pos++;
                }
                if (num > 100) num = 100;
                return uint8(num);
            }
        }
        return 50; // default: unknown
    }
}
