// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.10;
pragma experimental ABIEncoderV2;

interface IPowerOracle {
  /*** Current Reporter Or Slasher Interface ***/
  /// Poke to update the given symbol prices
//  function poke(uint256 userId, string[] calldata symbolHashes) external;

  /// Withdraw available rewards
  function withdrawRewards(uint256 userId, address to) external;


  /*** Owner Interface ***/
  /// The owner sets the current reward per report in ETH tokens
  function setReportReward(uint256 reportReward) external ;

  /// The owner sets the current report min/max in seconds
  function setReportIntervals(uint256 minInterval, uint256 maxInterval) external;


  /*** Viewers ***/
  /// Get price by a token address
  function getPriceByAddress(address token) external view returns (uint256);

  /// Get price by a token symbol, like "USDC"
  function getPriceBySymbol(string calldata symbol) external view returns (uint256);

  /// Get price by a token symbol hash, like "0xd6aca1be9729c13d677335161321649cccae6a591554772516700f986f942eaa" for USDC
  function getPriceByHash(bytes32 symbolHash) external view returns (uint256);

  /// Get price by a token symbol in bytes32 representation, like "0x5553444300000000000000000000000000000000000000000000000000000000" for USDC
  function getPriceByBytes32(bytes32 symbol) external view returns (uint256);

  /// Get rewards by accounts
  function getRewardsAvailable(address userId) external view returns (uint256);
}