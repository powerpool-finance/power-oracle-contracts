// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;

interface IPowerPokeStaking {
  enum UserStatus { UNAUTHORIZED, HDH, MEMBER }

  /*** User Interface ***/
  function createDeposit(uint256 userId_, uint256 amount_) external;

  function executeDeposit(uint256 userId_) external;

  function createWithdrawal(uint256 userId_, uint256 amount_) external;

  function executeWithdrawal(uint256 userId_, address to_) external;

  function createUser(
    address adminKey_,
    address reporterKey_,
    uint256 depositAmount
  ) external;

  function updateUser(
    uint256 userId,
    address adminKey_,
    address reporterKey_
  ) external;

  /*** Owner Interface ***/
  function setSlasher(address slasher) external;

  function setSlashingPct(uint256 slasherRewardPct, uint256 reservoirRewardPct) external;

  function pause() external;

  function unpause() external;

  /*** PowerOracle Contract Interface ***/
  function slashHDH(uint256 slasherId_, uint256 times_) external;

  /*** Permissionless Interface ***/
  function setHDH(uint256 candidateId_) external;

  /*** Viewers ***/
  function getHDHID() external view returns (uint256);

  function getHighestDeposit() external view returns (uint256);

  function getDepositOf(uint256 userId) external view returns (uint256);

  function getPendingDepositOf(uint256 userId_) external view returns (uint256 balance, uint256 timeout);

  function getPendingWithdrawalOf(uint256 userId_) external view returns (uint256 balance, uint256 timeout);

  function getSlashAmount(uint256 slasheeId_, uint256 times_)
    external
    view
    returns (
      uint256 slasherReward,
      uint256 reservoirReward,
      uint256 totalSlash
    );

  function getUserStatus(
    uint256 userId_,
    address reporterKey_,
    uint256 minDeposit_
  ) external view returns (UserStatus);

  function authorizeHDH(uint256 userId_, address reporterKey_) external view;

  function authorizeNonHDH(
    uint256 userId_,
    address pokerKey_,
    uint256 minDeposit_
  ) external view;

  function authorizeMember(
    uint256 userId_,
    address reporterKey_,
    uint256 minDeposit_
  ) external view;

  function requireValidAdminKey(uint256 userId_, address adminKey_) external view;

  function requireValidAdminOrPokerKey(uint256 userId_, address adminOrPokerKey_) external view;

  function getLastDepositChange(uint256 userId_) external view returns (uint256);
}
