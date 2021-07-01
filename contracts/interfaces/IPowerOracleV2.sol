// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

interface IPowerOracleV2 {
  enum ReportInterval { LESS_THAN_MIN, OK, GREATER_THAN_MAX }

  enum PriceSource {
    FIXED_ETH, /// implies the fixedPrice is a constant multiple of the ETH price (which varies)
    FIXED_USD, /// implies the fixedPrice is a constant multiple of the USD price (which is 1)
    REPORTER /// implies the price is set by the reporter
  }

  struct TokenConfig {
    address cToken;
    address underlying;
    bytes32 symbolHash;
    uint256 baseUnit;
    PriceSource priceSource;
    uint256 fixedPrice;
    address uniswapMarket;
    bool isUniswapReversed;
  }

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

  /*** Token Management ***/
  function maxTokens() external view returns (uint256);

  function numTokens() external view returns (uint256);

  function getTokenConfig(uint256 i) external view returns (TokenConfig memory);
}
