// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

interface IPowerOracleV3TokenManagement {
  function getTokens() external view returns (address[] memory);

  function getTokenCount() external view returns (uint256);
}
