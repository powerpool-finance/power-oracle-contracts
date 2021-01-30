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

  /// @notice The event emitted when an existing user is updated
  event Deposit(uint256 indexed userId, address indexed depositor, uint256 amount, uint256 depositAfter);

  /// @notice The event emitted when a valid admin key withdraws funds deposited for the given user ID
  event Withdraw(
    uint256 indexed userId,
    address indexed adminKey,
    address indexed to,
    uint256 amount,
    uint256 depositAfter
  );

  /// @notice The event emitted when the owner withdraws the extra CVP amount from the contract
  event WithdrawExtraCVP(
    bool indexed sent,
    address indexed to,
    uint256 diff,
    uint256 erc20Balance,
    uint256 accountedTotalDeposits
  );

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
  }

  /// @notice CVP token address
  IERC20 public immutable CVP_TOKEN;

  /// @notice The reservoir which holds CVP tokens
  address public reservoir;

  /// @notice The PowerOracle contract
  address public powerPoke;

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

  constructor(address cvpToken_) public {
    CVP_TOKEN = IERC20(cvpToken_);
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
    powerPoke = slasher_;
    slasherSlashingRewardPct = slasherSlashingRewardPct_;
    protocolSlashingRewardPct = reservoirSlashingRewardPct_;
  }

  /*** User Interface ***/

  /**
   * @notice An arbitrary user deposits CVP stake to the contract for the given user ID
   * @param userId_ The user ID to make deposit for
   * @param amount_ The amount in CVP tokens to deposit
   */
  function deposit(uint256 userId_, uint256 amount_) external override whenNotPaused {
    require(amount_ > 0, "PowerOracleStaking::deposit: Missing amount");
    require(users[userId_].adminKey != address(0), "PowerOracleStaking::deposit: Admin key can't be empty");

    _deposit(userId_, amount_);
  }

  function _deposit(uint256 userId_, uint256 amount_) internal {
    User storage user = users[userId_];

    uint256 depositAfter = user.deposit.add(amount_);
    user.deposit = depositAfter;
    totalDeposit = totalDeposit.add(amount_);

    _lastDepositChange[userId_] = block.timestamp;

    _trySetHighestDepositHolder(userId_, depositAfter);

    emit Deposit(userId_, msg.sender, amount_, depositAfter);
    CVP_TOKEN.transferFrom(msg.sender, address(this), amount_);
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
   * @param to_ The address to send the CVP tokens to
   * @param amount_ The amount in CVP tokens to withdraw
   */
  function withdraw(
    uint256 userId_,
    address to_,
    uint256 amount_
  ) external override {
    require(amount_ > 0, "PowerOracleStaking::withdraw: Missing amount");
    require(to_ != address(0), "PowerOracleStaking::withdraw: Can't transfer to 0 address");

    User storage user = users[userId_];
    require(msg.sender == user.adminKey, "PowerOracleStaking::withdraw: Only user's admin key allowed");

    uint256 depositBefore = user.deposit;
    require(amount_ <= depositBefore, "PowerOracleStaking::withdraw: Amount exceeds deposit");

    uint256 depositAfter = depositBefore - amount_;
    users[userId_].deposit = depositAfter;
    totalDeposit = totalDeposit.sub(amount_);

    _lastDepositChange[userId_] = block.timestamp;

    emit Withdraw(userId_, msg.sender, to_, amount_, depositAfter);
    CVP_TOKEN.transfer(to_, amount_);
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

    users[userId] = User(adminKey_, pokerKey_, 0);

    emit CreateUser(userId, adminKey_, pokerKey_, initialDeposit_);

    if (initialDeposit_ > 0) {
      _deposit(userId, initialDeposit_);
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
    require(msg.sender == user.adminKey, "PowerOracleStaking::updateUser: Only admin allowed");

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
   * @param amount_ The amount in CVP to slash
   */
  function slashHDH(uint256 slasherId_, uint256 amount_) external virtual override {
    require(msg.sender == powerPoke, "ONLY_POWER_POKE_ALLOWED");

    uint256 hdhId = _hdhId;
    uint256 hdhDeposit = users[hdhId].deposit;
    require(hdhDeposit >= amount_, "INSUFFICIENT_SLASHEE_DEPOSIT");

    uint256 slasherReward = amount_.mul(slasherSlashingRewardPct) / HUNDRED_PCT;
    uint256 reservoirReward = amount_.mul(protocolSlashingRewardPct) / HUNDRED_PCT;

    // users[reporterId].deposit = reporterDeposit - slasherReward - reservoirReward;
    users[hdhId].deposit = hdhDeposit.sub(slasherReward).sub(reservoirReward);

    // totalDeposit = totalDeposit - reservoirReward;
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
   * @notice The owner withdraws the surplus of CVP tokens
   * @param to_ The address to transfer the surplus
   */
  function withdrawExtraCVP(address to_) external override onlyOwner {
    require(to_ != address(0), "PowerOracleStaking::withdrawExtraCVP: Cant withdraw to 0 address");

    uint256 erc20Balance = CVP_TOKEN.balanceOf(address(this));
    uint256 totalBalance = totalDeposit;
    bool sent = false;
    uint256 diff;

    if (erc20Balance > totalBalance) {
      diff = erc20Balance - totalBalance;

      CVP_TOKEN.transfer(to_, diff);
      sent = true;
    }

    emit WithdrawExtraCVP(sent, to_, diff, erc20Balance, totalBalance);
  }

  /**
   * @notice The owner sets a new slasher address
   * @param slasher_ The slasher address to set
   */
  function setSlasher(address slasher_) external override onlyOwner {
    powerPoke = slasher_;
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
    require(
      slasherSlashingRewardPct_.add(protocolSlashingRewardPct_) <= HUNDRED_PCT,
      "PowerOracleStaking::setSlashingPct: Invalid reward sum"
    );

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

    require(
      candidateDeposit > currentReporterDeposit,
      "PowerOracleStaking::setReporter: Insufficient candidate deposit"
    );

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
    require(userId_ == _hdhId, "PowerOracleStaking::authorizeHdh: Not the HDH");
    require(users[userId_].pokerKey == pokerKey_, "PowerOracleStaking::authorizeHDH: Invalid poker key");
  }

  function authorizeNonHDH(
    uint256 userId_,
    address pokerKey_,
    uint256 minDeposit_
  ) external view override {
    require(userId_ != _hdhId, "PowerOracleStaking::authorizeNonHDH: Is HDH");
    authorizeMember(userId_, pokerKey_, minDeposit_);
  }

  function authorizeMember(
    uint256 userId_,
    address pokerKey_,
    uint256 minDeposit_
  ) public view override {
    require(users[userId_].deposit >= minDeposit_, "PowerOracleStaking::authorizeMember: Insufficient deposit");
    require(users[userId_].pokerKey == pokerKey_, "PowerOracleStaking::authorizeMember: Invalid poker key");
  }

  function requireValidAdminKey(uint256 userId_, address adminKey_) external view override {
    require(users[userId_].adminKey == adminKey_, "PowerOracleStaking::requireValidAdminKey: Invalid admin key");
  }

  function getLastDepositChange(uint256 userId_) external view override returns (uint256) {
    return _lastDepositChange[userId_];
  }
}
