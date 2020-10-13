// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;

import "@openzeppelin/upgrades-core/contracts/Initializable.sol";
import "./interfaces/IPowerOracleStaking.sol";
import "./interfaces/IPowerOracle.sol";
import "./utils/Ownable.sol";
import "./utils/SafeMath.sol";
import "./interfaces/IERC20.sol";

contract PowerOracleStaking is IPowerOracleStaking, Ownable, Initializable {
  using SafeMath for uint256;

  uint256 public constant HUNDRED_PCT = 100 ether;

  event CreateUser(uint256 indexed userId, address indexed adminKey, address pokerKey, address financierKey, uint256 initialDeposit);
  event UpdateUser(uint256 indexed userId, address indexed adminKey, address pokerKey, address financierKey);
  event Deposit(uint256 indexed userId, address indexed depositor, uint256 amount, uint256 depositAfter);
  event Withdraw(uint256 indexed userId, address indexed financier, address indexed to, uint256 amount, uint256 depositAfter);
  event WithdrawExtraCVP(bool indexed sent, address indexed to, uint256 diff, uint256 erc20Balance, uint256 accountedTotalDeposits);
  event SetMinimalSlashingDeposit(uint256 amount);
  event SetSlashingPct(uint256 slasherSlashingRewardPct, uint256 protocolSlashingRewardPct);
  event SetPowerOracle(address powerOracle);
  event SetReporter(uint256 indexed reporterId, address indexed msgSender);
  event Slash(uint256 indexed slasherId, uint256 indexed reporterId, uint256 slasherReward, uint256 reservoirReward);
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
    address financierKey;
    uint256 deposit;
  }

  IERC20 public immutable cvpToken;
  address public powerOracle;

  uint256 public totalDeposit;
  uint256 public minimalSlashingDeposit;
  /// 100 eth == 100%
  uint256 public slasherSlashingRewardPct;
  uint256 public protocolSlashingRewardPct;
  uint256 public setUserRewardCount;

  uint256 internal _userIdCounter;
  uint256 internal _highestDeposit;
  uint256 internal _reporterId;

  mapping(uint256 => User) public users;

  constructor(address cvpToken_) public {
    cvpToken = IERC20(cvpToken_);
  }

  function initialize(
    address owner_,
    address powerOracle_,
    uint256 minimalSlashingDeposit_,
    uint256 slasherRewardPct_,
    uint256 reservoirSlashingRewardPct_,
    uint256 setUserRewardCount_
  ) public initializer {
    _transferOwnership(owner_);
    powerOracle = powerOracle_;
    minimalSlashingDeposit = minimalSlashingDeposit_;
    slasherSlashingRewardPct = slasherRewardPct_;
    protocolSlashingRewardPct = reservoirSlashingRewardPct_;
    setUserRewardCount = setUserRewardCount_;
  }

  /*** User Interface ***/

  function deposit(uint256 userId_, uint256 amount_) external override {
    require(amount_ > 0, "PowerOracleStaking::deposit: Missing amount");
    require(users[userId_].adminKey != address(0), "PowerOracleStaking::deposit: Admin key can't be empty");

    _deposit(userId_, amount_);
  }

  function _deposit(uint256 userId_, uint256 amount_) internal {
    User storage user = users[userId_];

    uint256 depositAfter = user.deposit.add(amount_);
    user.deposit = depositAfter;
    totalDeposit = totalDeposit.add(amount_);

    uint256 highestDeposit = _highestDeposit;
    uint256 prevReporterId = _reporterId;
    if (depositAfter > highestDeposit && prevReporterId != userId_) {
      _highestDeposit = depositAfter;
      _reporterId = userId_;

      emit ReporterChange(prevReporterId, userId_, highestDeposit, users[prevReporterId].deposit, depositAfter);
    }

    emit Deposit(userId_, msg.sender, amount_, depositAfter);
    cvpToken.transferFrom(msg.sender, address(this), amount_);
  }

  function withdraw(uint256 userId_, address to_, uint256 amount_) external override {
    require(amount_ > 0, "PowerOracleStaking::withdraw: Missing amount");
    require(to_ != address(0), "PowerOracleStaking::withdraw: Can't transfer to 0 address");

    User storage user = users[userId_];
    require(msg.sender == user.financierKey, "PowerOracleStaking::withdraw: Only user's financier key allowed");

    uint256 depositBefore = user.deposit;
    require(amount_ <= depositBefore, "PowerOracleStaking::withdraw: Amount exceeds deposit");

    uint256 depositAfter = depositBefore - amount_;
    users[userId_].deposit = depositAfter;
    totalDeposit = totalDeposit.sub(amount_);

    emit Withdraw(userId_, msg.sender, to_, amount_, depositAfter);
    cvpToken.transfer(to_, amount_);
  }

  /// Creates a new user ID and stores the given keys
  function createUser(address adminKey_, address pokerKey_, address financierKey_, uint256 initialDeposit_) external override {
    uint256 userId = ++_userIdCounter;

    users[userId] = User(adminKey_, pokerKey_, financierKey_, 0);

    if (initialDeposit_ > 0) {
      _deposit(userId, initialDeposit_);
    }

    emit CreateUser(userId, adminKey_, pokerKey_, financierKey_, initialDeposit_);
  }

  /// Updates an existing user, only the current adminKey is eligible calling this method
  function updateUser(uint256 userId, address adminKey_, address pokerKey_, address financierKey_) external override {
    User storage user = users[userId];
    require(msg.sender == user.adminKey, "PowerOracleStaking::updateUser: Only admin allowed");

    if (adminKey_ != user.adminKey) {
      user.adminKey = adminKey_;
    }
    if (pokerKey_ != user.pokerKey) {
      user.pokerKey = pokerKey_;
    }
    if (financierKey_ != user.financierKey) {
      user.financierKey = financierKey_;
    }

    emit UpdateUser(userId, adminKey_, pokerKey_, financierKey_);
  }

  /*** PowerOracle Contract Interface ***/

  /// Slashes the current reporter if it did not make poke() call during the given report interval
  function slash(uint256 slasherId_, uint256 overdueCount_) external override virtual {
    User storage slasher = users[slasherId_];
    require(slasher.deposit >= minimalSlashingDeposit, "PowerOracleStaking::slash: Insufficient slasher deposit");

    uint256 reporterDeposit = users[_reporterId].deposit;

    // uint256 slasherReward = reporterDeposit * slasherRewardPct / HUNDRED_PCT;
    uint256 slasherReward = reporterDeposit.mul(slasherSlashingRewardPct) / HUNDRED_PCT;
    // uint256 reservoirReward = reporterDeposit * reservoirSlashingRewardPct / HUNDRED_PCT;
    uint256 reservoirReward = reporterDeposit.mul(protocolSlashingRewardPct) / HUNDRED_PCT;

    emit Slash(slasherId_, _reporterId, slasherReward, reservoirReward);
  }

  /*** Owner Interface ***/

  function withdrawExtraCVP(address to_) external override onlyOwner {
    require(to_ != address(0), "PowerOracleStaking::withdrawExtraCVP: Cant withdraw to 0 address");

    uint256 erc20Balance = cvpToken.balanceOf(address(this));
    uint256 totalBalance = totalDeposit;
    bool sent = false;
    uint256 diff;

    if (erc20Balance > totalBalance) {
      diff = erc20Balance - totalBalance;

      cvpToken.transfer(to_, diff);
      sent = true;
    }

    emit WithdrawExtraCVP(sent, to_, diff, erc20Balance, totalBalance);
  }

  function setMinimalSlashingDeposit(uint256 amount_) external override onlyOwner {
    minimalSlashingDeposit = amount_;
    emit SetMinimalSlashingDeposit(amount_);
  }

  function setPowerOracle(address powerOracle_) external override onlyOwner {
    powerOracle = powerOracle_;
    emit SetPowerOracle(powerOracle_);
  }

  function setSlashingPct(uint256 slasherSlashingRewardPct_, uint256 protocolSlashingRewardPct_) external override onlyOwner {
    require(
      slasherSlashingRewardPct_.add(protocolSlashingRewardPct_) <= HUNDRED_PCT,
      "PowerOracleStaking::setSlashingPct: Invalid reward sum"
    );

    slasherSlashingRewardPct = slasherSlashingRewardPct_;
    protocolSlashingRewardPct = protocolSlashingRewardPct_;
    emit SetSlashingPct(slasherSlashingRewardPct_, protocolSlashingRewardPct_);
  }

  /*** Permissionless Interface ***/

  /// Set a given address as a reporter if his deposit is higher than the current highestDeposit
  function setReporter(uint256 candidateId_) external override {
    uint256 candidateDeposit = users[candidateId_].deposit;
    uint256 prevReporterId = _reporterId;
    uint256 currentReporterDeposit = users[prevReporterId].deposit;

    require(candidateDeposit > currentReporterDeposit, "PowerOracleStaking::setReporter: Insufficient candidate deposit");

    emit ReporterChange(prevReporterId, candidateId_, _highestDeposit, currentReporterDeposit, candidateDeposit);
    emit SetReporter(candidateId_, msg.sender);

    _highestDeposit = candidateDeposit;
    _reporterId = candidateId_;

    IPowerOracle(powerOracle).rewardAddress(msg.sender, setUserRewardCount);
  }

  /*** Viewers ***/

  /// The amount of CVP staked by the given user id
  function getReporterId() external view override returns (uint256) {
    return _reporterId;
  }

  function getHighestDeposit() external view override returns (uint256) {
    return _highestDeposit;
  }

  function getDepositOf(uint256 userId_) external view override returns (uint256) {
    return users[userId_].deposit;
  }

  function getUserStatus(uint256 userId_, address reporterKey_) external view override returns (UserStatus) {
    if (userId_ == _reporterId && users[userId_].pokerKey == reporterKey_) {
      return UserStatus.CAN_REPORT;
    }
    if (users[userId_].deposit > minimalSlashingDeposit && users[userId_].pokerKey == reporterKey_) {
      return UserStatus.CAN_SLASH;
    }
    return UserStatus.UNAUTHORIZED;
  }

  function authorizeReporter(uint256 userId_, address pokerKey_) external view override {
    require(userId_ == _reporterId, "PowerOracleStaking::authorizeReporter: Invalid reporter");
    require(users[userId_].pokerKey == pokerKey_, "PowerOracleStaking::authorizeReporter: Invalid poker key");
  }

  function authorizeSlasher(uint256 userId_, address pokerKey_) external view override {
    require(users[userId_].deposit >= minimalSlashingDeposit, "PowerOracleStaking::authorizeSlasher: Insufficient deposit");
    require(users[userId_].pokerKey == pokerKey_, "PowerOracleStaking::authorizeSlasher: Invalid poker key");
  }

  function isValidReporterKey(uint256 userId_, address reporter_) external view override returns (bool) {
    return users[userId_].pokerKey == reporter_;
  }

  function requireValidReporterKey(uint256 userId_, address reporter_) external view override {
    require(users[userId_].pokerKey == reporter_, "PowerOracleStaking::requireValidReporter: Invalid reporter");
  }

  function requireValidFinancierKey(uint256 userId_, address financier_) external view override {
    require(users[userId_].financierKey == financier_, "PowerOracleStaking::requireValidFinancier: Invalid financier");
  }
}
