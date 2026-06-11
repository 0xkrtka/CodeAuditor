// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CodeAuditor v3
 * @notice On-chain Solidity audit powered by Ritual LLM precompile (0x0802)
 *         Pay-per-audit via ERC-20 token.
 *
 * v3 — Per Ritual official docs (skills.ritualfoundation.org/ritual-dapp-llm):
 *   - Low-level .call() to LLM precompile (not custom interface)
 *   - Correct 30-field ABI tuple encoding
 *   - Executor from TEEServiceRegistry (Capability.LLM = 1)
 *   - depositForFees() to fund RitualWallet for executor fees (~0.4 RIT minimum)
 *   - maxCompletionTokens = 4096 (GLM-4.7-FP8 reasoning model requires >=4096)
 *   - ttl = 300 blocks (safe for 10-40s inference)
 *   - stream = false (on-chain result; frontend reads from receipt)
 */

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface ITEEServiceRegistry {
    struct ServiceRecord {
        address teeAddress;
        bytes   publicKey;
        string  endpoint;
        uint8   status;
    }
    function getServicesByCapability(uint8 capability) external view returns (ServiceRecord[] memory);
}

contract CodeAuditor {

    // ── Ritual addresses ──────────────────────────────────────────────────────
    address public constant LLM_PRECOMPILE = 0x0000000000000000000000000000000000000802;
    address public constant RITUAL_WALLET  = 0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948;
    address public constant TEE_REGISTRY   = 0x9644e8562cE0Fe12b4deeC4163c064A8862Bf47F;

    // ── LLM config ────────────────────────────────────────────────────────────
    string  public constant MODEL     = "zai-org/GLM-4.7-FP8";
    uint8   public constant CAP_LLM   = 1;

    // ── State ─────────────────────────────────────────────────────────────────
    address public immutable owner;
    IERC20  public immutable paymentToken;
    uint256 public auditFee;
    uint256 public auditCount;

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

    // ── Errors ────────────────────────────────────────────────────────────────
    error Unauthorized();
    error EmptyCode();
    error CodeTooLong();
    error AuditNotFound();
    error PaymentFailed();
    error NoExecutorFound();

    constructor(address _paymentToken, uint256 _auditFee) {
        owner        = msg.sender;
        paymentToken = IERC20(_paymentToken);
        auditFee     = _auditFee;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  FUNDING: Deposit RITUAL into RitualWallet so executor fees can be paid.
    //  Owner must call this with >= 0.4 RITUAL before audits work.
    // ─────────────────────────────────────────────────────────────────────────
    function depositForFees() external payable {
        require(msg.value > 0, "Send RITUAL to deposit");
        (bool ok,) = RITUAL_WALLET.call{value: msg.value}(
            abi.encodeWithSignature("deposit(uint256)", 5000)
        );
        require(ok, "RitualWallet deposit failed");
    }

    receive() external payable {}

    // ─────────────────────────────────────────────────────────────────────────
    //  PUBLIC: Submit code for on-chain AI audit
    // ─────────────────────────────────────────────────────────────────────────
    function requestAudit(string calldata contractCode)
        external
        returns (uint256 auditId, bytes32 jobId)
    {
        uint256 codeLen = bytes(contractCode).length;
        if (codeLen == 0)    revert EmptyCode();
        if (codeLen > 8_192) revert CodeTooLong();

        bool paid = paymentToken.transferFrom(msg.sender, address(this), auditFee);
        if (!paid) revert PaymentFailed();

        address executor = _getExecutor();
        string memory responseText = _callLLM(executor, contractCode);

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

    function withdrawFees(address to, uint256 amount) external onlyOwner {
        paymentToken.transfer(to, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  INTERNAL: Call LLM precompile with correct 30-field ABI
    // ─────────────────────────────────────────────────────────────────────────
    function _callLLM(address executor, string calldata code)
        internal
        returns (string memory responseText)
    {
        // Build messages JSON
        string memory messagesJson = string(abi.encodePacked(
            '[{"role":"system","content":"You are a senior Solidity security auditor. Analyze the code and respond with:\\nSEVERITY_SCORE: [0-100]\\nSUMMARY: [2 sentences]\\nFINDINGS:\\n[numbered list]\\nRECOMMENDATIONS:\\n[fixes]"},',
            '{"role":"user","content":"```solidity\\n',
            code,
            '\\n```"}]'
        ));

        // Encode 30-field LLM request per Ritual docs
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
        return abi.encode(
            executor,           // address  executor
            new bytes[](0),     // bytes[]  encryptedSecrets
            uint256(300),       // uint256  ttl (blocks)
            new bytes[](0),     // bytes[]  secretSignatures
            bytes(""),          // bytes    userPublicKey
            messagesJson,       // string   messagesJson
            "zai-org/GLM-4.7-FP8", // string model
            int256(0),          // int256   frequencyPenalty
            "",                 // string   logitBiasJson
            false,              // bool     logprobs
            int256(4096),       // int256   maxCompletionTokens (>=4096 for reasoning model)
            "",                 // string   metadataJson
            "",                 // string   modalitiesJson
            uint256(1),         // uint256  n
            true,               // bool     parallelToolCalls
            int256(0),          // int256   presencePenalty
            "medium",           // string   reasoningEffort
            bytes(""),          // bytes    responseFormatData
            int256(-1),         // int256   seed (null)
            "auto",             // string   serviceTier
            "",                 // string   stopJson
            false,              // bool     stream (false = on-chain result in receipt)
            int256(700),        // int256   temperature (0.7 × 1000)
            bytes(""),          // bytes    toolChoiceData
            bytes(""),          // bytes    toolsData
            int256(-1),         // int256   topLogprobs (null)
            int256(1000),       // int256   topP (1.0 × 1000)
            "",                 // string   user
            false,              // bool     piiEnabled
            abi.encode("", "", "") // (string,string,string) convoHistory — empty
        );
    }

    function _decodeLLMResult(bytes memory result)
        internal
        view
        returns (string memory)
    {
        if (result.length < 64) return "";

        // Unwrap async envelope: (bytes simmedInput, bytes actualOutput)
        bytes memory actualOutput;
        try this._decodeEnvelope(result) returns (bytes memory out) {
            actualOutput = out;
        } catch {
            return "";
        }

        if (actualOutput.length == 0) return "";

        // Decode: (bool hasError, bytes completionData, bytes modelMeta, string errorMsg, ...)
        bool hasError;
        bytes memory completionData;
        string memory errorMsg;
        try this._decodeLLMResponse(actualOutput) returns (bool he, bytes memory cd, string memory em) {
            hasError = he;
            completionData = cd;
            errorMsg = em;
        } catch {
            return "";
        }

        if (hasError) return errorMsg;
        if (completionData.length == 0) return "";

        // Extract text content
        try this._extractText(completionData) returns (string memory text) {
            return text;
        } catch {
            return "";
        }
    }

    // External helpers (used with try/catch from internal functions)
    function _decodeEnvelope(bytes calldata data) external pure returns (bytes memory actualOutput) {
        (, actualOutput) = abi.decode(data, (bytes, bytes));
    }

    function _decodeLLMResponse(bytes calldata data)
        external
        pure
        returns (bool hasError, bytes memory completionData, string memory errorMsg)
    {
        bytes memory modelMeta;
        // Decode first 4 dynamic fields, ignore 5th (convoHistory tuple)
        // We decode into a struct to avoid stack-too-deep
        (hasError, completionData, modelMeta, errorMsg) = abi.decode(
            data,
            (bool, bytes, bytes, string)
        );
        // Note: this drops the convoHistory tuple tail, which is fine for our use case
        // as ABI encoding uses offsets for dynamic fields
    }

    function _extractText(bytes calldata completionData)
        external
        pure
        returns (string memory content)
    {
        // completionData: (string id, string obj, uint256 created, string model,
        //                  string sysFingerprint, string svcTier,
        //                  uint256 choicesCount, bytes[] choicesData, bytes usageData)
        (, , , , , , , bytes[] memory choicesData, ) =
            abi.decode(completionData, (string, string, uint256, string, string, string, uint256, bytes[], bytes));

        if (choicesData.length == 0) return "";

        // Each choice: (uint256 index, string finishReason, bytes messageData)
        (, , bytes memory messageData) = abi.decode(choicesData[0], (uint256, string, bytes));

        // messageData: (string role, string content, string refusal, uint256 toolCallsCount, bytes[] toolCallsData)
        (content, , , ,) = abi.decode(messageData, (string, string, string, uint256, bytes[]));
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  INTERNAL: Get executor & parse severity
    // ─────────────────────────────────────────────────────────────────────────
    function _getExecutor() internal view returns (address) {
        try ITEEServiceRegistry(TEE_REGISTRY).getServicesByCapability(CAP_LLM)
            returns (ITEEServiceRegistry.ServiceRecord[] memory records)
        {
            for (uint256 i = 0; i < records.length; i++) {
                if (records[i].status == 1 && records[i].teeAddress != address(0)) {
                    return records[i].teeAddress;
                }
            }
        } catch {}
        revert NoExecutorFound();
    }

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
