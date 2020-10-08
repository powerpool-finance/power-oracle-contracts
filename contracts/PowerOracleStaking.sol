// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;

import "./interfaces/IPowerOracleStaking.sol";
import "./utils/Ownable.sol";
import "./utils/SafeMath.sol";
import "./interfaces/IERC20.sol";

contract PowerOracleStaking is IPowerOracleStaking, Ownable {
  using SafeMath for uint256;

  uint256 public constant HUNDRED_PCT = 100 ether;

  event CreateUser(uint256 indexed userId, address adminKey, address reporterKey, address financier);
  event UpdateUser(uint256 indexed userId, address adminKey, address reporterKey, address financier);
  event Deposit(uint256 indexed userId, address indexed financier, uint256 amount, uint256 depositAfter);
  event Withdraw(uint256 indexed userId, address indexed financier, address indexed to, uint256 amount, uint256 depositAfter);
  event WithdrawExtraCVP(bool indexed sent, uint256 erc20Balance, uint256 totalBalance);
  event SetMinimalSlashingDeposit(uint256 amount);
  event SetSlashingPct(uint256 slasherRewardPct, uint256 reservoirSlashingRewardPct);
  event SetPowerOracle(address powerOracle);
  event SetReporter(bool indexed changed, uint256 indexed reporterId, address indexed msgSender);
  event Slash(uint256 indexed slasherId, uint256 indexed reporterId, uint256 slasherReward, uint256 reservoirReward);

  struct User {
    address adminKey;
    address reporterKey;
    address financierKey;
    uint256 deposit;
  }

  IERC20 public immutable cvpToken;
  address public powerOracle;

  uint256 public totalDeposit;
  uint256 public minimalSlashingDeposit;
  /// 100 eth == 100%
  uint256 public slasherRewardPct;
  uint256 public reservoirSlashingRewardPct;

  uint256 internal _userIdCounter;
  uint256 internal _highestDeposit;
  uint256 internal _reporterId;

  mapping(uint256 => User) public users;

  constructor(address cvpToken_) public {
    cvpToken = IERC20(cvpToken_);
  }

  function initialize(
    address powerOracle_,
    uint256 minimalSlashingDeposit_,
    uint256 slasherRewardPct_,
    uint256 reservoirSlashingRewardPct_
  ) public {
    powerOracle = powerOracle_;
    minimalSlashingDeposit = minimalSlashingDeposit_;
    slasherRewardPct = slasherRewardPct_;
    reservoirSlashingRewardPct = reservoirSlashingRewardPct_;
  }

  /*** User Interface ***/

  function deposit(uint256 userId_, uint256 amount_) external override {
    require(amount_ > 0, "PowerOracleStaking::deposit: missing amount");

    User storage user = users[userId_];
    require(msg.sender == user.financierKey, "PowerOracleStaking::deposit: Only user's financier key allowed");

    uint256 depositAfter = user.deposit.add(amount_);
    user.deposit = depositAfter;

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

    emit Withdraw(userId_, msg.sender, to_, amount_, depositAfter);
    cvpToken.transfer(to_, amount_);
  }

  /// Creates a new user ID and stores the given keys
  function createUser(address adminKey_, address reporterKey_, address financierKey_) external override {
    uint256 userId = ++_userIdCounter;
    users[userId] = User(adminKey_, reporterKey_, financierKey_, 0);
    emit CreateUser(userId, adminKey_, reporterKey_, financierKey_);
  }

  /// Updates an existing user, only the current adminKey is eligible calling this method
  function updateUser(uint256 userId, address adminKey_, address reporterKey_, address financierKey_) external override {
    User storage user = users[userId];
    require(msg.sender == user.adminKey, "PowerOracleStaking::updateUser: Only admin allowed");

    if (adminKey_ != user.adminKey) {
      user.adminKey = adminKey_;
    }
    if (reporterKey_ != user.reporterKey) {
      user.reporterKey = reporterKey_;
    }
    if (financierKey_ != user.financierKey) {
      user.financierKey = financierKey_;
    }

    emit UpdateUser(userId, adminKey_, reporterKey_, financierKey_);
  }

  /*** PowerOracle Contract Interface ***/

  /// Slashes the current reporter if it did not make poke() call during the given report interval
  function slash(uint256 slasherId_, uint256 newReporterId_) external override {
    User storage slasher = users[slasherId_];
    require(slasher.deposit >= minimalSlashingDeposit, "PowerOracleStaking::slash: Insufficient slasher deposit");

    uint256 reporterDeposit = users[_reporterId].deposit;

    // uint256 slasherReward = reporterDeposit * slasherRewardPct / HUNDRED_PCT;
    uint256 slasherReward = reporterDeposit.mul(slasherRewardPct) / HUNDRED_PCT;
    // uint256 reservoirReward = reporterDeposit * reservoirSlashingRewardPct / HUNDRED_PCT;
    uint256 reservoirReward = reporterDeposit.mul(reservoirSlashingRewardPct) / HUNDRED_PCT;

    emit Slash(slasherId_, _reporterId, slasherReward, reservoirReward);
  }

  /*** Owner Interface ***/

  function withdrawExtraCVP() external override onlyOwner {
    uint256 erc20Balance = cvpToken.balanceOf(address(this));
    uint256 totalBalance = totalDeposit;
    bool sent = false;

    if (totalBalance > erc20Balance) {
      uint256 diff = erc20Balance - totalBalance;

      cvpToken.transfer(msg.sender, diff);
      sent = true;
    }

    emit WithdrawExtraCVP(sent, erc20Balance, totalBalance);
  }

  function setMinimalSlashingDeposit(uint256 amount_) external override onlyOwner {
    minimalSlashingDeposit = amount_;
    emit SetMinimalSlashingDeposit(amount_);
  }

  function setPowerOracle(address powerOracle_) external override onlyOwner {
    powerOracle = powerOracle_;
    emit SetPowerOracle(powerOracle_);
  }

  function setSlashingPct(uint256 slasherRewardPct_, uint256 reservoirSlashingRewardPct_) external override onlyOwner {
    slasherRewardPct = slasherRewardPct_;
    reservoirSlashingRewardPct = reservoirSlashingRewardPct_;
    emit SetSlashingPct(slasherRewardPct_, reservoirSlashingRewardPct_);
  }

  /*** Permissionless Interface ***/

  /// Set a given address as a reporter if his deposit is higher than the current highestDeposit
  function setReporter(uint256 reporterId_) external override {
    _setReporter(reporterId_);
  }

  function _setReporter(uint256 reporterId_) internal {
    uint256 reporterDeposit = users[reporterId_].deposit;
    bool changed = false;

    if (reporterDeposit > _highestDeposit) {
      _highestDeposit = reporterDeposit;
      _reporterId = reporterId_;
      changed = true;
    }

    emit SetReporter(changed, reporterId_, msg.sender);
  }

  /*** Viewers ***/

  /// The amount of CVP staked by the given user id
  function reporterId() external view override returns (uint256) {
    return _reporterId;
  }

  function highestDeposit() external view override returns (uint256) {
    return _highestDeposit;
  }

  function getDeposit(uint256 userId_) external view override returns (uint256) {
    return users[userId_].deposit;
  }

  function getUserStatus(uint256 userId_, address reporterKey_) external view override returns (UserStatus) {
    if (userId_ == _reporterId && users[userId_].reporterKey == reporterKey_) {
      return UserStatus.CAN_REPORT;
    }
    if (users[userId_].deposit > minimalSlashingDeposit) {
      return UserStatus.CAN_SLASH;
    }
    return UserStatus.UNAUTHORIZED;
  }

  function isValidReporterKey(uint256 userId_, address reporter_) external view override returns (bool) {
    return users[userId_].reporterKey == reporter_;
  }

  function requireValidReporterKey(uint256 userId_, address reporter_) external view override {
    require(users[userId_].reporterKey == reporter_, "PowerOracleStaking::requireValidReporter: Invalid reporter");
  }

  function requireValidFinancierKey(uint256 userId_, address financier_) external view override {
    require(users[userId_].financierKey == financier_, "PowerOracleStaking::requireValidFinancier: Invalid financier");
  }
}
