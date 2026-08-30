// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title DarkPoolVault
/// @notice The Polygon side of DARKMARKET.
///
/// Traders deposit native currency here (POL on Polygon, test POL on Amoy).
/// Positions are matched privately on Midnight, and only what fails to match
/// inside that pool needs a counterparty in the open market. This contract
/// holds the collateral that funds those residual fills.
///
/// The instruction to fill always carries the Midnight epoch it came from, so
/// anyone can line a settlement here up against the aggregate on Midnight's
/// public ledger and check that the two agree. That is the whole cross-chain
/// join: neither chain talks to the other, they are correlated by the epoch.
contract DarkPoolVault {
    enum Side {
        YES,
        NO
    }

    struct Settlement {
        bytes32 midnightContract; // which Midnight contract closed this epoch
        bytes32 conditionId; // Polymarket's market id, the same 32 bytes Midnight stored
        uint64 epoch; // which epoch on that contract
        Side side; // which way the residual went
        uint256 size; // how much reached the open market
        uint256 crossed; // how much matched privately and never did
        uint256 timestamp;
    }

    /// Who may relay a closed epoch. See the trust note in the README: an EVM
    /// contract cannot verify a Midnight proof today, so the relay is trusted
    /// to report honestly and is checkable against Midnight's public ledger.
    address public executor;
    address public owner;

    mapping(address => uint256) public deposits;
    uint256 public totalDeposits;

    /// Collateral committed to residual fills, so it cannot be withdrawn from
    /// underneath an open position.
    uint256 public committed;

    Settlement[] public settlements;

    /// Keyed on the Midnight contract AND the epoch. Every Midnight contract
    /// starts counting at epoch 1, so the epoch alone collides across
    /// deployments and would reject every later contract's first epoch.
    mapping(bytes32 => mapping(uint64 => bool)) public settled;

    event Deposited(address indexed trader, uint256 amount, uint256 balance);
    event Withdrawn(address indexed trader, uint256 amount, uint256 balance);
    event ResidualSettled(
        bytes32 indexed midnightContract,
        uint64 indexed epoch,
        bytes32 indexed conditionId,
        Side side,
        uint256 size,
        uint256 crossed
    );
    event ExecutorChanged(address indexed from, address indexed to);

    error NotOwner();
    error NotExecutor();
    error NothingToDeposit();
    error InsufficientFree(uint256 requested, uint256 available);
    error AlreadySettled(bytes32 midnightContract, uint64 epoch);
    error NoResidual();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyExecutor() {
        if (msg.sender != executor) revert NotExecutor();
        _;
    }

    constructor(address executor_) {
        owner = msg.sender;
        executor = executor_ == address(0) ? msg.sender : executor_;
    }

    /// @notice Put collateral in. This is the only way funds enter.
    function deposit() external payable {
        if (msg.value == 0) revert NothingToDeposit();
        deposits[msg.sender] += msg.value;
        totalDeposits += msg.value;
        emit Deposited(msg.sender, msg.value, deposits[msg.sender]);
    }

    receive() external payable {
        if (msg.value == 0) revert NothingToDeposit();
        deposits[msg.sender] += msg.value;
        totalDeposits += msg.value;
        emit Deposited(msg.sender, msg.value, deposits[msg.sender]);
    }

    /// @notice Take collateral out, so long as it is not committed to a fill.
    function withdraw(uint256 amount) external {
        uint256 balance = deposits[msg.sender];
        uint256 free = freeCollateral();
        if (amount > balance || amount > free) {
            revert InsufficientFree(amount, balance < free ? balance : free);
        }
        deposits[msg.sender] = balance - amount;
        totalDeposits -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(msg.sender, amount, deposits[msg.sender]);
    }

    /// @notice Collateral not already backing a residual fill.
    function freeCollateral() public view returns (uint256) {
        return totalDeposits > committed ? totalDeposits - committed : 0;
    }

    /// @notice Settle one closed Midnight epoch.
    /// @dev `size` is the residual: what the pool could not match internally.
    ///      A fully crossed epoch has no residual and must not be relayed,
    ///      because nothing reached the open market and nothing should be
    ///      committed here.
    function settleResidual(
        bytes32 midnightContract,
        uint64 epoch,
        bytes32 conditionId,
        Side side,
        uint256 size,
        uint256 crossed
    ) external onlyExecutor {
        if (settled[midnightContract][epoch]) {
            revert AlreadySettled(midnightContract, epoch);
        }
        if (size == 0) revert NoResidual();
        if (size > freeCollateral()) revert InsufficientFree(size, freeCollateral());

        settled[midnightContract][epoch] = true;
        committed += size;
        settlements.push(
            Settlement({
                midnightContract: midnightContract,
                conditionId: conditionId,
                epoch: epoch,
                side: side,
                size: size,
                crossed: crossed,
                timestamp: block.timestamp
            })
        );

        emit ResidualSettled(midnightContract, epoch, conditionId, side, size, crossed);
    }

    /// @notice Release collateral once a market resolves and the position closes.
    function releaseEpoch(
        bytes32 midnightContract,
        uint64 epoch,
        uint256 amount
    ) external onlyExecutor {
        if (!settled[midnightContract][epoch]) {
            revert AlreadySettled(midnightContract, epoch);
        }
        committed = committed > amount ? committed - amount : 0;
    }

    function setExecutor(address next) external onlyOwner {
        emit ExecutorChanged(executor, next);
        executor = next;
    }

    function settlementCount() external view returns (uint256) {
        return settlements.length;
    }

    /// @notice Everything a reader needs to check this against Midnight.
    function latestSettlement()
        external
        view
        returns (
            bytes32 midnightContract,
            uint64 epoch,
            bytes32 conditionId,
            Side side,
            uint256 size,
            uint256 crossed
        )
    {
        Settlement storage s = settlements[settlements.length - 1];
        return (s.midnightContract, s.epoch, s.conditionId, s.side, s.size, s.crossed);
    }
}
