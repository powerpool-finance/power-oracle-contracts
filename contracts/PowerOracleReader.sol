// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "./interfaces/IPowerOracleReader.sol";
import "./PowerOracleTokenManagement.sol";
pragma experimental ABIEncoderV2;

contract PowerOracleReader is IPowerOracleReader, PowerOracleTokenManagement {
  using SafeMath for uint256;

  /// @notice The number of wei in 1 ETH
  uint256 public constant ethBaseUnit = 1e18;

  bytes32 internal constant cvpHash = keccak256(abi.encodePacked("CVP"));
  bytes32 internal constant ethHash = keccak256(abi.encodePacked("ETH"));

  uint256 internal constant PRICE_SOURCE_FIXED_USD = 0;
  uint256 internal constant PRICE_SOURCE_REPORTER = 1;

  function priceInternal(TokenConfig memory config_) internal view returns (uint256) {
    if (config_.priceSource == PRICE_SOURCE_REPORTER) return prices[config_.symbolHash].value;
    if (config_.priceSource == PRICE_SOURCE_FIXED_USD) return uint256(config_.fixedPrice);
    revert("UNSUPPORTED_PRICE_CASE");
  }

  /**
   * @notice Get the underlying price of a token
   * @param token_ The token address for price retrieval
   * @return Price denominated in USD, with 6 decimals, for the given asset address
   */
  function getPriceByAsset(address token_) external view override returns (uint256) {
    TokenConfig memory config = getActiveTokenConfig(token_);
    return priceInternal(config);
  }

  /**
   * @notice Get the official price for a symbol, like "COMP"
   * @param symbol_ The symbol for price retrieval
   * @return Price denominated in USD, with 6 decimals
   */
  function getPriceBySymbol(string calldata symbol_) external view override returns (uint256) {
    TokenConfig memory config = getTokenConfigBySymbol(symbol_);
    return priceInternal(config);
  }

  /**
   * @notice Get price by a token symbol hash,
   *    like "0xd6aca1be9729c13d677335161321649cccae6a591554772516700f986f942eaa" for USDC
   * @param symbolHash_ The symbol hash for price retrieval
   * @return Price denominated in USD, with 6 decimals, for the given asset address
   */
  function getPriceBySymbolHash(bytes32 symbolHash_) external view override returns (uint256) {
    TokenConfig memory config = getTokenConfigBySymbolHash(symbolHash_);
    return priceInternal(config);
  }

  /**
   * @notice Get the price by underlying address
   * @dev Implements the old PriceOracle interface for Compound v2.
   * @param token_ The underlying address for price retrieval
   * @return Price denominated in USD, with 18 decimals, for the given underlying address
   */
  function assetPrices(address token_) external view override returns (uint256) {
    TokenConfig memory config = getActiveTokenConfig(token_);
    // Return price in the same format as getUnderlyingPrice, but by token address
    return priceInternal(config).mul(1e30) / config.baseUnit;
  }
}
