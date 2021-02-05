// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;

contract PowerPokeStakingStorageV1 {
  struct User {
    address adminKey;
    address pokerKey;
    uint256 deposit;
    uint256 pendingDeposit;
    uint256 pendingDepositTimeout;
    uint256 pendingWithdrawal;
    uint256 pendingWithdrawalTimeout;
  }

  /// @notice The deposit timeout in seconds
  uint256 public depositTimeout;

  /// @notice The withdrawal timeout in seconds
  uint256 public withdrawalTimeout;

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

  // Reserved storage space to allow for layout changes in the future.
  uint256[50] private ______gap;
}
