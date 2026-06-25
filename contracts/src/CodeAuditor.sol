// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CodeAuditor v6
 * @notice On-chain Solidity audit powered by Ritual LLM precompile (0x0802)
 *         Uses zai-org/GLM-4.7-FP8 (64K context, MIT license) inside TEE.
 *
 * Per Enshrined AI docs (30-field ABI, fields 0-29):
 *   - Field 21 (stream): true — enables SSE token streaming to frontend
 *   - Field 28 (piiEnabled): false — mutually exclusive with streaming
 *   - Field 29 (convoHistory): required StorageRef — empty is valid
 *   - TTL max: 500 blocks
 *
 * v6 fixes:
 *   - transferFrom is now skipped when auditFee == 0 (free audit mode)
 *   - Executor address passed as parameter or uses defaultExecutor
 *   - Owner can set default executor via setExecutor()
 *   - depositForFees() to fund RitualWallet for executor escrow
 *   - stream: true for SSE streaming support
 */

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract CodeAuditor {

    // ── Ritual addresses ──────────────────────────────────────────────────────
    address public constant LLM_PRECOMPILE = 0x0000000000000000000000000000000000000802;
    address public constant RITUAL_WALLET  = 0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948;

    // ── State ─────────────────────────────────────────────────────────────────
    address public immutable owner;
    IERC20  public immutable paymentToken;
    uint256 public auditFee;
    uint256 public auditCount;
    address public defaultExecutor; // set by owner, queried off-chain from TEEServiceRegistry

    struct StorageRef {
        string platform;
        string path;
        string key_ref;
    }

    struct AuditReport {
        uint256 id;
        address requester;
        bytes32 codeHash;
        string  auditResult;
        bytes32 jobId;
        uint8   severityScore;
        uint256 timestamp;
        bool    completed;
    }

    mapping(uint256 => AuditReport) public audits;
    mapping(address => uint256[])   public auditsByUser;

    // ── Events ────────────────────────────────────────────────────────────────
    event AuditRequested(uint256 indexed auditId, address indexed requester, bytes32 codeHash, bytes32 jobId, uint256 timestamp);
    event AuditCompleted(uint256 indexed auditId, address indexed requester, uint8 severityScore);
    event FeeUpdated(uint256 oldFee, uint256 newFee);
    event ExecutorUpdated(address oldExecutor, address newExecutor);

    // ── Errors ────────────────────────────────────────────────────────────────
    error Unauthorized();
    error EmptyCode();
    error CodeTooLong();
    error AuditNotFound();
    error PaymentFailed();
    error NoExecutor();

    constructor(address _paymentToken, uint256 _auditFee, address _defaultExecutor) {
        owner           = msg.sender;
        paymentToken    = IERC20(_paymentToken);
        auditFee        = _auditFee;
        defaultExecutor = _defaultExecutor;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  FUNDING: Deposit native RITUAL into RitualWallet for executor fees
    //  Must have >= 0.4 RITUAL before LLM calls work.
    // ─────────────────────────────────────────────────────────────────────────
    function depositForFees() external payable {
        require(msg.value > 0, "Send RITUAL to deposit");
        (bool ok,) = RITUAL_WALLET.call{value: msg.value}(
            abi.encodeWithSignature("deposit(uint256)", 7776000) // 90 days lock duration to ensure it never expires during normal usage
        );
        require(ok, "RitualWallet deposit failed");
    }

    receive() external payable {}

    // ─────────────────────────────────────────────────────────────────────────
    //  PUBLIC: Submit Solidity code for AI audit
    //  @param contractCode  Solidity source (max 8KB)
    //  @param executor      TEE executor address (pass 0x0 to use defaultExecutor)
    // ─────────────────────────────────────────────────────────────────────────
    function requestAudit(string calldata contractCode, address executor)
        external
        returns (uint256 auditId, bytes32 jobId)
    {
        uint256 codeLen = bytes(contractCode).length;
        if (codeLen == 0)    revert EmptyCode();
        if (codeLen > 8_192) revert CodeTooLong();

        address exec = executor == address(0) ? defaultExecutor : executor;
        if (exec == address(0)) revert NoExecutor();

        // Only collect fee when auditFee > 0 (free audit mode skips transferFrom)
        if (auditFee > 0) {
            bool paid = paymentToken.transferFrom(msg.sender, address(this), auditFee);
            if (!paid) revert PaymentFailed();
        }

        string memory responseText = _callLLM(exec, contractCode);

        auditId = ++auditCount;
        jobId   = bytes32(uint256(uint160(msg.sender)) ^ block.number);

        audits[auditId] = AuditReport({
            id:            auditId,
            requester:     msg.sender,
            codeHash:      keccak256(bytes(contractCode)),
            auditResult:   responseText,
            jobId:         jobId,
            severityScore: _parseSeverity(responseText),
            timestamp:     block.timestamp,
            completed:     true
        });

        auditsByUser[msg.sender].push(auditId);

        emit AuditRequested(auditId, msg.sender, audits[auditId].codeHash, jobId, block.timestamp);
        emit AuditCompleted(auditId, msg.sender, audits[auditId].severityScore);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  READ
    // ─────────────────────────────────────────────────────────────────────────
    function getAudit(uint256 auditId) external view returns (AuditReport memory) {
        if (audits[auditId].requester == address(0)) revert AuditNotFound();
        return audits[auditId];
    }

    function getMyAudits(address user) external view returns (uint256[] memory) {
        return auditsByUser[user];
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  ADMIN
    // ─────────────────────────────────────────────────────────────────────────
    function setAuditFee(uint256 newFee) external onlyOwner {
        emit FeeUpdated(auditFee, newFee);
        auditFee = newFee;
    }

    function setExecutor(address newExecutor) external onlyOwner {
        emit ExecutorUpdated(defaultExecutor, newExecutor);
        defaultExecutor = newExecutor;
    }

    function withdrawFees(address to, uint256 amount) external onlyOwner {
        paymentToken.transfer(to, amount);
    }

    /// @notice Rescue native RITUAL locked in RitualWallet by this contract.
    ///         Can only be called AFTER the lock expires (lockUntil block < current block).
    ///         Calls RitualWallet.withdraw() on behalf of this contract.
    function rescueRitualWallet(uint256 amount) external onlyOwner {
        (bool ok,) = RITUAL_WALLET.call(
            abi.encodeWithSignature("withdraw(uint256)", amount)
        );
        require(ok, "RitualWallet withdraw failed - lock may not have expired");
    }

    /// @notice Rescue any native RITUAL held directly in this contract (not in RitualWallet).
    ///         Transfers to owner.
    function rescueNative() external onlyOwner {
        uint256 bal = address(this).balance;
        require(bal > 0, "No native balance");
        (bool ok,) = owner.call{value: bal}("");
        require(ok, "Native transfer failed");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  INTERNAL: Call LLM precompile
    // ─────────────────────────────────────────────────────────────────────────
    function _callLLM(address executor, string calldata code)
        internal
        returns (string memory responseText)
    {
        string memory messagesJson = string(abi.encodePacked(
            '[{"role":"system","content":"You are a senior Solidity security auditor. Respond with:\\nSEVERITY_SCORE: [0-100]\\nSUMMARY: [2 sentences]\\nFINDINGS:\\n[numbered list with severity]\\nRECOMMENDATIONS:\\n[fixes]"},',
            '{"role":"user","content":"Audit this contract:\\n```solidity\\n',
            code,
            '\\n```"}]'
        ));

        bytes memory input = _encodeLLMRequest(executor, messagesJson);
        (bool success, bytes memory result) = LLM_PRECOMPILE.call(input);
        if (!success) return "LLM precompile call failed";

        responseText = _decodeLLMResult(result);
    }

    function _encodeLLMRequest(address executor, string memory messagesJson)
        internal
        pure
        returns (bytes memory)
    {
        StorageRef memory convoHistory = StorageRef("", "", "");
        // 30-field ABI per Enshrined AI docs (fields 0-29)
        return abi.encode(
            executor,               // [0]  executor
            new bytes[](0),         // [1]  encryptedSecrets
            uint256(500),           // [2]  ttl (500 blocks — maximum allowed by validator)
            new bytes[](0),         // [3]  secretSignatures
            bytes(""),              // [4]  userPublicKey
            messagesJson,           // [5]  messagesJson (OpenAI-compatible JSON array)
            "zai-org/GLM-4.7-FP8", // [6]  model (64K context, MIT license)
            int256(0),              // [7]  frequencyPenalty
            "",                     // [8]  logitBiasJson
            false,                  // [9]  logprobs
            int256(4096),           // [10] maxCompletionTokens (≥4096 for GLM reasoning)
            "",                     // [11] metadataJson
            "",                     // [12] modalitiesJson
            uint256(1),             // [13] n
            true,                   // [14] parallelToolCalls
            int256(0),              // [15] presencePenalty
            "medium",               // [16] reasoningEffort
            bytes(""),              // [17] responseFormatData
            int256(-1),             // [18] seed (null = -1)
            "auto",                 // [19] serviceTier
            "",                     // [20] stopJson
            false,                  // [21] stream — false: result stored on-chain, frontend polls via getAudit()
            int256(700),            // [22] temperature (0.7 × 1000)
            bytes(""),              // [23] toolChoiceData
            bytes(""),              // [24] toolsData
            int256(-1),             // [25] topLogprobs (null = -1)
            int256(1000),           // [26] topP (1.0 × 1000)
            "",                     // [27] user
            false,                  // [28] piiEnabled (mutually exclusive with stream:true)
            convoHistory            // [29] convoHistory — REQUIRED StorageRef (empty = no history)
        );
    }

    function _decodeLLMResult(bytes memory result)
        internal
        view
        returns (string memory)
    {
        if (result.length < 64) return "";

        try this._decodeEnvelope(result) returns (bytes memory actualOutput) {
            if (actualOutput.length == 0) return "";

            try this._decodeLLMResponse(actualOutput) returns (bool hasError, bytes memory completionData, string memory errorMsg) {
                if (hasError) return errorMsg;
                if (completionData.length == 0) return "";

                try this._extractText(completionData) returns (string memory text) {
                    return text;
                } catch { return ""; }
            } catch { return ""; }
        } catch { return ""; }
    }

    // ── External helpers (try/catch from internal) ────────────────────────────
    function _decodeEnvelope(bytes calldata data) external pure returns (bytes memory actualOutput) {
        (, actualOutput) = abi.decode(data, (bytes, bytes));
    }


    function _decodeLLMResponse(bytes calldata data)
        external
        pure
        returns (bool hasError, bytes memory completionData, string memory errorMsg)
    {
        // Ritual LLM output: (bool hasError, bytes completionData, bytes modelMeta, string errorMsg[, StorageRef])
        // abi.decode with 4 params safely ignores trailing StorageRef bytes
        bytes memory modelMeta;
        (hasError, completionData, modelMeta, errorMsg) = abi.decode(data, (bool, bytes, bytes, string));
    }

    function _extractText(bytes calldata completionData)
        external
        pure
        returns (string memory content)
    {
        (, , , , , , , bytes[] memory choicesData, ) =
            abi.decode(completionData, (string, string, uint256, string, string, string, uint256, bytes[], bytes));
        if (choicesData.length == 0) return "";
        (, , bytes memory messageData) = abi.decode(choicesData[0], (uint256, string, bytes));
        (content, , , ,) = abi.decode(messageData, (string, string, string, uint256, bytes[]));
    }

    // ── Parse severity score ──────────────────────────────────────────────────
    function _parseSeverity(string memory text) internal pure returns (uint8) {
        bytes memory b = bytes(text);
        bytes memory pattern = bytes("SEVERITY_SCORE: ");
        uint256 patLen = pattern.length;
        for (uint256 i = 0; i + patLen + 1 < b.length; i++) {
            bool found = true;
            for (uint256 j = 0; j < patLen; j++) {
                if (b[i + j] != pattern[j]) { found = false; break; }
            }
            if (found) {
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
        return 50;
    }
}
