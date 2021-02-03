// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;

import "@openzeppelin/upgrades-core/contracts/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./interfaces/IPowerPokeStaking.sol";
import "./interfaces/IPowerOracle.sol";
import "./utils/Ownable.sol";
import "./utils/Pausable.sol";

contract PowerPokeStaking is IPowerPokeStaking, Ownable, Initializable, Pausable {
  using SafeMath for uint256;

  uint256 public constant HUNDRED_PCT = 100 ether;

  /// @notice The event emitted when a new user is created
  event CreateUser(uint256 indexed userId, address indexed adminKey, address indexed pokerKey, uint256 initialDeposit);

  /// @notice The event emitted when an existing user is updated
  event UpdateUser(uint256 indexed userId, address indexed adminKey, address indexed pokerKey);

  /// @notice The event emitted when the user creates pending deposit
  event CreateDeposit(
    uint256 indexed userId,
    address indexed depositor,
    uint256 pendingTimeout,
    uint256 amount,
    uint256 pendingDepositAfter
  );

  /// @notice The event emitted when the user transfers his deposit from pending to the active
  event ExecuteDeposit(uint256 indexed userId, uint256 pendingTimeout, uint256 amount, uint256 depositAfter);

  /// @notice The event emitted when the user creates pending deposit
  event CreateWithdrawal(
    uint256 indexed userId,
    uint256 pendingTimeout,
    uint256 amount,
    uint256 pendingWithdrawalAfter,
    uint256 depositAfter
  );

  /// @notice The event emitted when a valid admin key withdraws funds from
  event ExecuteWithdrawal(uint256 indexed userId, address indexed to, uint256 pendingTimeout, uint256 amount);

  /// @notice The event emitted when the owner sets new slashing percent values, where 1ether == 1%
  event SetSlashingPct(uint256 slasherSlashingRewardPct, uint256 protocolSlashingRewardPct);

  /// @notice The event emitted when the owner sets a new PowerOracle linked contract
  event SetSlasher(address powerOracle);

  /// @notice The event emitted when an arbitrary user fixes an outdated reporter userId record
  event SetReporter(uint256 indexed reporterId, address indexed msgSender);

  /// @notice The event emitted when the PowerOracle contract requests to slash a user with the given ID
  event Slash(uint256 indexed slasherId, uint256 indexed reporterId, uint256 slasherReward, uint256 reservoirReward);

  /// @notice The event emitted when the existing reporter is replaced with a new one due some reason
  event ReporterChange(
    uint256 indexed prevId,
    uint256 indexed nextId,
    uint256 highestDepositPrev,
    uint256 actualDepositPrev,
    uint256 actualDepositNext
  );

  struct User {
    address adminKey;
    address pokerKey;
    uint256 deposit;
    uint256 pendingDeposit;
    uint256 pendingDepositTimeout;
    uint256 pendingWithdrawal;
    uint256 pendingWithdrawalTimeout;
  }

  /// @notice CVP token address
  IERC20 public immutable CVP_TOKEN;

  /// @notice The deposit timeout in seconds
  uint256 public immutable DEPOSIT_TIMEOUT;

  /// @notice The withdrawal timeout in seconds
  uint256 public immutable WITHDRAWAL_TIMEOUT;

  /// @notice The reservoir which holds CVP tokens
  address public reservoir;

  /// @notice The slasher address (PowerPoke)
  address public slasher;

  /// @notice The total amount of all deposits
  uint256 public totalDeposit;

  /// @notice The share of a slasher in slashed deposit per one outdated asset (1 eth == 1%)
  uint256 public slasherSlashingRewardPct;

  /// @notice The share of the protocol(reservoir) in slashed deposit per one outdated asset (1 eth == 1%)
  uint256 public protocolSlashingRewardPct;

  /// @notice The incremented user ID counter. Is updated only within createUser function call
  uint256 public userIdCounter;

  /// @dev The highest deposit. Usually of the current reporterId. Is safe to be outdated.
  uint256 internal _highestDeposit;

  /// @dev The current highest deposit holder ID.
  uint256 internal _hdhId;

  /// @notice User details by it's ID
  mapping(uint256 => User) public users;

  /// @dev Last deposit change timestamp by user ID
  mapping(uint256 => uint256) internal _lastDepositChange;

  constructor(
    address cvpToken_,
  // TODO: move to initializer
    uint256 depositTimeout_,
  // TODO: move to initializer
    uint256 withdrawTimeout_
  ) public {
    require(cvpToken_ != address(0), "CVP_ADDR_IS_0");
    require(depositTimeout_ > 0, "DEPOSIT_TIMEOUT_IS_0");
    require(withdrawTimeout_ > 0, "WITHDRAW_TIMEOUT_IS_0");

    CVP_TOKEN = IERC20(cvpToken_);
    DEPOSIT_TIMEOUT = depositTimeout_;
    WITHDRAWAL_TIMEOUT = withdrawTimeout_;
  }

  function initialize(
    address owner_,
    address reservoir_,
    address slasher_,
    uint256 slasherSlashingRewardPct_,
    uint256 reservoirSlashingRewardPct_
  ) public initializer {
    _transferOwnership(owner_);
    reservoir = reservoir_;
    slasher = slasher_;
    slasherSlashingRewardPct = slasherSlashingRewardPct_;
    protocolSlashingRewardPct = reservoirSlashingRewardPct_;
  }

  /*** User Interface ***/

  /**
   * @notice An arbitrary user deposits CVP stake to the contract for the given user ID
   * @param userId_ The user ID to make deposit for
   * @param amount_ The amount in CVP tokens to deposit
   */
  function createDeposit(uint256 userId_, uint256 amount_) external override whenNotPaused {
    require(amount_ > 0, "MISSING_AMOUNT");

    User storage user = users[userId_];

    require(user.adminKey != address(0), "INVALID_USER");

    _createDeposit(userId_, amount_);
  }

  function _createDeposit(uint256 userId_, uint256 amount_) internal {
    User storage user = users[userId_];

    uint256 pendingDepositAfter = user.pendingDeposit.add(amount_);
    uint256 timeout = block.timestamp.add(DEPOSIT_TIMEOUT);

    user.pendingDeposit = pendingDepositAfter;
    user.pendingDepositTimeout = timeout;

    emit CreateDeposit(userId_, msg.sender, timeout, amount_, pendingDepositAfter);
    CVP_TOKEN.transferFrom(msg.sender, address(this), amount_);
  }

  function executeDeposit(uint256 userId_) external override {
    User storage user = users[userId_];
    uint256 amount = user.pendingDeposit;
    uint256 pendingDepositTimeout = user.pendingDepositTimeout;

    // check
    require(user.adminKey == msg.sender, "ONLY_ADMIN_ALLOWED");
    require(amount > 0, "NO_PENDING_DEPOSIT");
    require(block.timestamp >= pendingDepositTimeout, "TIMEOUT_NOT_PASSED");

    // increment deposit
    uint256 depositAfter = user.deposit.add(amount);
    user.deposit = depositAfter;
    totalDeposit = totalDeposit.add(amount);

    // reset pending deposit
    user.pendingDeposit = 0;
    user.pendingDepositTimeout = 0;

    _lastDepositChange[userId_] = block.timestamp;

    _trySetHighestDepositHolder(userId_, depositAfter);

    emit ExecuteDeposit(userId_, pendingDepositTimeout, amount, depositAfter);
  }

  function _trySetHighestDepositHolder(uint256 candidateId_, uint256 candidateDepositAfter_) internal {
    uint256 prevHdhID = _hdhId;
    uint256 prevDeposit = users[prevHdhID].deposit;

    if (candidateDepositAfter_ > prevDeposit && prevHdhID != candidateId_) {
      emit ReporterChange(prevHdhID, candidateId_, _highestDeposit, users[prevHdhID].deposit, candidateDepositAfter_);

      _highestDeposit = candidateDepositAfter_;
      _hdhId = candidateId_;
    }
  }

  /**
   * @notice A valid users admin key withdraws the deposited stake form the contract
   * @param userId_ The user ID to withdraw deposit from
   * @param amount_ The amount in CVP tokens to withdraw
   */
  function createWithdrawal(uint256 userId_, uint256 amount_) external override {
    require(amount_ > 0, "MISSING_AMOUNT");

    User storage user = users[userId_];
    require(msg.sender == user.adminKey, "ONLY_ADMIN_ALLOWED");

    // decrement deposit
    uint256 depositBefore = user.deposit;
    require(amount_ <= depositBefore, "AMOUNT_EXCEEDS_DEPOSIT");

    uint256 depositAfter = depositBefore - amount_;
    user.deposit = depositAfter;
    totalDeposit = totalDeposit.sub(amount_);

    // increment pending withdrawal
    uint256 pendingWithdrawalAfter = user.pendingWithdrawal.add(amount_);
    uint256 timeout = block.timestamp.add(WITHDRAWAL_TIMEOUT);
    user.pendingWithdrawal = pendingWithdrawalAfter;
    user.pendingWithdrawalTimeout = timeout;

    _lastDepositChange[userId_] = block.timestamp;

    emit CreateWithdrawal(userId_, timeout, amount_, pendingWithdrawalAfter, depositAfter);
  }

  function executeWithdrawal(uint256 userId_, address to_) external override {
    require(to_ != address(0), "CANT_WITHDRAW_TO_0");

    User storage user = users[userId_];

    uint256 pendingWithdrawalTimeout = user.pendingWithdrawalTimeout;
    uint256 amount = user.pendingWithdrawal;

    require(msg.sender == user.adminKey, "ONLY_ADMIN_ALLOWED");
    require(amount > 0, "NO_PENDING_WITHDRAWAL");
    require(block.timestamp >= pendingWithdrawalTimeout, "TIMEOUT_NOT_PASSED");

    user.pendingWithdrawal = 0;
    user.pendingWithdrawalTimeout = 0;

    emit ExecuteWithdrawal(userId_, to_, pendingWithdrawalTimeout, amount);
    CVP_TOKEN.transfer(to_, amount);
  }

  /**
   * @notice Creates a new user ID and stores the given keys
   * @param adminKey_ The admin key for the new user
   * @param pokerKey_ The poker key for the new user
   * @param initialDeposit_ The initial deposit to be transferred to this contract
   */
  function createUser(
    address adminKey_,
    address pokerKey_,
    uint256 initialDeposit_
  ) external override whenNotPaused {
    uint256 userId = ++userIdCounter;

    users[userId] = User(adminKey_, pokerKey_, 0, 0, 0, 0, 0);

    emit CreateUser(userId, adminKey_, pokerKey_, initialDeposit_);

    if (initialDeposit_ > 0) {
      _createDeposit(userId, initialDeposit_);
    }
  }

  /**
   * @notice Updates an existing user, only the current adminKey is eligible calling this method.
   * @param adminKey_ The new admin key for the user
   * @param pokerKey_ The new poker key for the user
   */
  function updateUser(
    uint256 userId_,
    address adminKey_,
    address pokerKey_
  ) external override {
    User storage user = users[userId_];
    require(msg.sender == user.adminKey, "ONLY_ADMIN_ALLOWED");

    if (adminKey_ != user.adminKey) {
      user.adminKey = adminKey_;
    }
    if (pokerKey_ != user.pokerKey) {
      user.pokerKey = pokerKey_;
    }

    emit UpdateUser(userId_, adminKey_, pokerKey_);
  }

  /*** SLASHER INTERFACE ***/

  /**
   * @notice Slashes the current reporter if it did not make poke() call during the given report interval
   * @param slasherId_ The slasher ID
   * @param times_ The multiplier for a single slashing percent
   */
  function slashHDH(uint256 slasherId_, uint256 times_) external virtual override {
    require(msg.sender == slasher, "ONLY_SLASHER_ALLOWED");

    uint256 hdhId = _hdhId;
    uint256 hdhDeposit = users[hdhId].deposit;

    uint256 product = times_.mul(hdhDeposit);
    // uint256 slasherReward = times_ * reporterDeposit * slasherRewardPct / HUNDRED_PCT;
    uint256 slasherReward = product.mul(slasherSlashingRewardPct) / HUNDRED_PCT;
    // uint256 reservoirReward = times_ * reporterDeposit * reservoirSlashingRewardPct / HUNDRED_PCT;
    uint256 reservoirReward = product.mul(protocolSlashingRewardPct) / HUNDRED_PCT;

    uint256 amount = slasherReward.add(reservoirReward);
    require(hdhDeposit >= amount, "INSUFFICIENT_HDH_DEPOSIT");

    // users[reporterId].deposit = reporterDeposit - slasherReward - reservoirReward;
    users[hdhId].deposit = hdhDeposit.sub(amount);

    // totalDeposit = totalDeposit - reservoirReward; (slasherReward is kept on the contract)
    totalDeposit = totalDeposit.sub(reservoirReward);

    emit Slash(slasherId_, hdhId, slasherReward, reservoirReward);

    if (slasherReward > 0) {
      // uint256 slasherDepositAfter = users[slasherId_].deposit + slasherReward
      uint256 slasherDepositAfter = users[slasherId_].deposit.add(slasherReward);
      users[slasherId_].deposit = slasherDepositAfter;
      _trySetHighestDepositHolder(slasherId_, slasherDepositAfter);
    }

    if (reservoirReward > 0) {
      CVP_TOKEN.transfer(reservoir, reservoirReward);
    }
  }

  /*** OWNER INTERFACE ***/

  /**
   * @notice The owner sets a new slasher address
   * @param slasher_ The slasher address to set
   */
  function setSlasher(address slasher_) external override onlyOwner {
    slasher = slasher_;
    emit SetSlasher(slasher_);
  }

  /**
   * @notice The owner sets the new slashing percent values
   * @param slasherSlashingRewardPct_ The slasher share will be accrued on the slasher's deposit
   * @param protocolSlashingRewardPct_ The protocol share will immediately be transferred to reservoir
   */
  function setSlashingPct(uint256 slasherSlashingRewardPct_, uint256 protocolSlashingRewardPct_)
    external
    override
    onlyOwner
  {
    require(slasherSlashingRewardPct_.add(protocolSlashingRewardPct_) <= HUNDRED_PCT, "INVALID_SUM");

    slasherSlashingRewardPct = slasherSlashingRewardPct_;
    protocolSlashingRewardPct = protocolSlashingRewardPct_;
    emit SetSlashingPct(slasherSlashingRewardPct_, protocolSlashingRewardPct_);
  }

  /**
   * @notice The owner pauses poke*-operations
   */
  function pause() external override onlyOwner {
    _pause();
  }

  /**
   * @notice The owner unpauses poke*-operations
   */
  function unpause() external override onlyOwner {
    _unpause();
  }

  /*** PERMISSIONLESS INTERFACE ***/

  /**
   * @notice Set a given address as a reporter if his deposit is higher than the current highestDeposit
   * @param candidateId_ Te candidate address to try
   */
  function setHDH(uint256 candidateId_) external override {
    uint256 candidateDeposit = users[candidateId_].deposit;
    uint256 prevHdhId = _hdhId;
    uint256 currentReporterDeposit = users[prevHdhId].deposit;

    require(candidateDeposit > currentReporterDeposit, "INSUFFICIENT_CANDIDATE_DEPOSIT");

    emit ReporterChange(prevHdhId, candidateId_, _highestDeposit, currentReporterDeposit, candidateDeposit);
    emit SetReporter(candidateId_, msg.sender);

    _highestDeposit = candidateDeposit;
    _hdhId = candidateId_;
  }

  /*** VIEWERS ***/

  function getHDHID() external view override returns (uint256) {
    return _hdhId;
  }

  function getHighestDeposit() external view override returns (uint256) {
    return _highestDeposit;
  }

  function getDepositOf(uint256 userId_) external view override returns (uint256) {
    return users[userId_].deposit;
  }

  function getPendingDepositOf(uint256 userId_) external view override returns (uint256 balance, uint256 timeout) {
    return (users[userId_].pendingDeposit, users[userId_].pendingDepositTimeout);
  }

  function getPendingWithdrawalOf(uint256 userId_) external view override returns (uint256 balance, uint256 timeout) {
    return (users[userId_].pendingWithdrawal, users[userId_].pendingWithdrawalTimeout);
  }

  function getUserStatus(
    uint256 userId_,
    address pokerKey_,
    uint256 minDeposit_
  ) external view override returns (UserStatus) {
    if (userId_ == _hdhId && users[userId_].pokerKey == pokerKey_) {
      return UserStatus.HDH;
    }
    if (users[userId_].deposit >= minDeposit_ && users[userId_].pokerKey == pokerKey_) {
      return UserStatus.MEMBER;
    }
    return UserStatus.UNAUTHORIZED;
  }

  function authorizeHDH(uint256 userId_, address pokerKey_) external view override {
    require(userId_ == _hdhId, "NOT_HDH");
    require(users[userId_].pokerKey == pokerKey_, "INVALID_POKER_KEY");
  }

  function authorizeNonHDH(
    uint256 userId_,
    address pokerKey_,
    uint256 minDeposit_
  ) external view override {
    require(userId_ != _hdhId, "IS_HDH");
    authorizeMember(userId_, pokerKey_, minDeposit_);
  }

  function authorizeMember(
    uint256 userId_,
    address pokerKey_,
    uint256 minDeposit_
  ) public view override {
    require(users[userId_].deposit >= minDeposit_, "INSUFFICIENT_DEPOSIT");
    require(users[userId_].pokerKey == pokerKey_, "INVALID_POKER_KEY");
  }

  function requireValidAdminKey(uint256 userId_, address adminKey_) external view override {
    require(users[userId_].adminKey == adminKey_, "INVALID_AMIN_KEY");
  }

  function getLastDepositChange(uint256 userId_) external view override returns (uint256) {
    return _lastDepositChange[userId_];
  }
}
