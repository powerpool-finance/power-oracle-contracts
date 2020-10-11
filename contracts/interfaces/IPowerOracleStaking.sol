// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.10;

interface IPowerOracleStaking {
  enum UserStatus {
    UNAUTHORIZED,
    CAN_REPORT,
    CAN_SLASH
  }

  /*** User Interface ***/
  /// Financier makes deposit for it's userId
  function deposit(uint256 userId_, uint256 amount_) external;

  /// Financier withdraws their deposit
  function withdraw(uint256 userId_, address to_, uint256 amount_) external;

  /// Creates a new user ID and stores the given keys
  function createUser(address adminKey_, address reporterKey_, address financierKey_) external;

  /// Updates an existing user, only the current adminKey is eligible calling this method
  function updateUser(uint256 userId, address adminKey_, address reporterKey_, address financierKey_) external;


  /*** Owner Interface ***/
  /// The owner withdraws the diff between ERC20 balance and the actual total deposits tracker.
  function withdrawExtraCVP() external;

  function setMinimalSlashingDeposit(uint256 amount) external;

  function setPowerOracle(address powerOracle) external;

  function setSlashingPct(uint256 slasherRewardPct, uint256 reservoirRewardPct) external;


  /*** PowerOracle Contract Interface ***/
  /// Slashes the current reporter if it did not make poke() call during the given report interval
  function slash(uint256 slasherId_, uint256 overdueCount_) external;


  /*** Permissionless Interface ***/
  /// Set a given address as a reporter if his deposit is higher than the current highestDeposit
  function setReporter(uint256 reporterId) external;


  /*** Viewers ***/
  /// The current reporter
  function getReporterId() external view returns (uint256);

  /// The highest deposit in CVP tokens
  function getHighestDeposit() external view returns (uint256);

  /// The amount of CVP staked by the given user id
  function getDepositOf(uint256 userId) external view returns (uint256);

  /// Checks whether the userId and reporterKey belong to the current reporter
  function getUserStatus(uint256 userId_, address reporterKey_) external view returns (UserStatus);

  function authorizeReporter(uint256 userId_, address reporterKey_) external view;

  function authorizeSlasher(uint256 userId_, address reporterKey_) external view;

  /// Check whether the reporter key belongs to the userId
  function isValidReporterKey(uint256 userId_, address reporter_) external view returns (bool);

  /// Check whether the reporter key belongs to the userId
  function requireValidReporterKey(uint256 userId_, address reporter_) external view;

  /// Check whether the financier key belongs to the userId
  function requireValidFinancierKey(uint256 userId_, address financier_) external view;
}
