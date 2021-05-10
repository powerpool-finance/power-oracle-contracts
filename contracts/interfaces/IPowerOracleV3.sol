// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

interface IPowerOracle {
  enum ReportInterval { LESS_THAN_MIN, OK, GREATER_THAN_MAX }

  function pokeFromReporter(
    uint256 reporterId_,
    string[] memory symbols_,
    bytes calldata rewardOpts
  ) external;

  function pokeFromSlasher(
    uint256 slasherId_,
    string[] memory symbols_,
    bytes calldata rewardOpts
  ) external;

  function poke(string[] memory symbols_) external;

  function slasherHeartbeat(uint256 slasherId) external;

  /*** Owner Interface ***/
  function setPowerPoke(address powerOracleStaking) external;

  function pause() external;

  function unpause() external;
}
