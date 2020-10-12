// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.10;
pragma experimental ABIEncoderV2;

interface IPowerOracle {
  enum ReportInterval {
    LESS_THAN_MIN,
    OK,
    GREATER_THAN_MAX
  }

  /*** Current Reporter Or Slasher Interface ***/
  /// Poke to update the given symbol prices
  //  function poke(uint256 userId, string[] calldata symbolHashes) external;

  /// Withdraw available rewards
  function withdrawRewards(uint256 userId, address to) external;


  /*** Owner Interface ***/
  /// The owner sets the current reward per report in ETH tokens
  function setReportReward(uint256 reportReward) external;

  function setMaxCvpReward(uint256 maxCvpReward) external;

  function setPowerOracleStaking(address powerOracleStaking) external;

    /// The owner sets the current report min/max in seconds
  function setReportIntervals(uint256 minInterval, uint256 maxInterval) external;


  /*** Viewers ***/
  /// Get price by a token address
  function getPriceByAddress(address token) external view returns (uint256);

  /// Get price by a token symbol, like "USDC"
  function getPriceBySymbol(string calldata symbol) external view returns (uint256);

  /// Get price by a token symbol hash, like "0xd6aca1be9729c13d677335161321649cccae6a591554772516700f986f942eaa" for USDC
  function getPriceByHash(bytes32 symbolHash) external view returns (uint256);
}
