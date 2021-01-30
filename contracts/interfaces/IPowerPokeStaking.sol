// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;

interface IPowerPokeStaking {
  enum UserStatus { UNAUTHORIZED, HDH, MEMBER }

  /*** User Interface ***/
  function deposit(uint256 userId_, uint256 amount_) external;

  function withdraw(
    uint256 userId_,
    address to_,
    uint256 amount_
  ) external;

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
  function withdrawExtraCVP(address to) external;

  function setSlasher(address slasher) external;

  function setSlashingPct(uint256 slasherRewardPct, uint256 reservoirRewardPct) external;

  function pause() external;

  function unpause() external;

  /*** PowerOracle Contract Interface ***/
  function slashHDH(uint256 slasherId_, uint256 amount_) external;

  /*** Permissionless Interface ***/
  function setHDH(uint256 candidateId_) external;

  /*** Viewers ***/
  function getHDHID() external view returns (uint256);

  function getHighestDeposit() external view returns (uint256);

  function getDepositOf(uint256 userId) external view returns (uint256);

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

  function getLastDepositChange(uint256 userId_) external view returns (uint256);
}
