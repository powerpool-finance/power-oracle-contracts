// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "./Uniswap/UniswapV2OracleLibrary.sol";
import "./Uniswap/UniswapV2Library.sol";
import "./PowerOracleStorageV1.sol";
import "./TokenDetails.sol";
import "./interfaces/IPowerOracleReader.sol";


abstract contract PowerOracleReader is IPowerOracleReader, TokenDetails {
  using FixedPoint for *;
  using SafeMath for uint256;

  function priceInternal(address factory_, TokenConfig memory config_) internal view returns (uint256) {
    if (config_.priceSource == PriceSource.REPORTER) return prices[config_.symbolHash][factory_];
    if (config_.priceSource == PriceSource.FIXED_USD) return config_.fixedPrice;
    if (config_.priceSource == PriceSource.FIXED_ETH) {
      uint256 usdPerEth = prices[ethHash][factory_];
      require(usdPerEth > 0, "ETH_PRICE_NOT_SET");
      return usdPerEth.mul(config_.fixedPrice) / ETH_BASE_UNIT;
    }
    revert("UNSUPPORTED_PRICE_CASE");
  }

  function getLastObservation(address factory_, address token_) public view returns (Observation memory observation) {
    uint256 len = observations[factory_][token_].length;
    if (len == 0) {
      return observation;
    }
    return observations[factory_][token_][len - 1];
  }

  function computeAmountOut(
    uint256 priceCumulativeStart, uint256 priceCumulativeEnd,
    uint256 timeElapsed, uint256 amountIn
  ) private pure returns (uint256 amountOut) {
    // overflow is desired.
    FixedPoint.uq112x112 memory priceAverage = FixedPoint.uq112x112(
      uint224((priceCumulativeEnd - priceCumulativeStart) / timeElapsed)
    );
    amountOut = priceAverage.mul(amountIn).decode144();
  }

  function _valid(address factory_, address pair_, uint256 age_) internal view returns (bool) {
    return (block.timestamp - getLastObservation(factory_, pair_).timestamp) <= age_;
  }

  /*** CURRENT PRICE GETTER ***/

  function current(address factory_, address tokenIn_, uint256 amountIn_, address tokenOut_) external view returns (uint256 amountOut) {
    address pair = UniswapV2Library.pairFor(factory_, tokenIn_, tokenOut_);
    require(_valid(factory_, pair, ANCHOR_PERIOD.mul(2)), "CURRENT_STALE_PRICE");
    (address token0,) = UniswapV2Library.sortTokens(tokenIn_, tokenOut_);

    Observation memory _observation = getLastObservation(factory_, pair);
    (uint256 price0Cumulative, uint256 price1Cumulative,) = UniswapV2OracleLibrary.currentCumulativePrices(pair);
    if (block.timestamp == _observation.timestamp) {
      _observation = observations[factory_][pair][observations[factory_][pair].length - 2];
    }

    uint256 timeElapsed = block.timestamp - _observation.timestamp;
    timeElapsed = timeElapsed == 0 ? 1 : timeElapsed;
    if (token0 == tokenIn_) {
      return computeAmountOut(_observation.price0Cumulative, price0Cumulative, timeElapsed, amountIn_);
    } else {
      return computeAmountOut(_observation.price1Cumulative, price1Cumulative, timeElapsed, amountIn_);
    }
  }

  /*** AVERAGE PRICE GETTER ***/

  function quote(address factory_, address tokenIn_, uint256 amountIn_, address tokenOut_, uint256 granularity_) external view returns (uint256 amountOut) {
    address pair = UniswapV2Library.pairFor(factory_, tokenIn_, tokenOut_);
    require(_valid(factory_, pair, ANCHOR_PERIOD.mul(granularity_)), "QUOTE_STALE_PRICE");
    (address token0,) = UniswapV2Library.sortTokens(tokenIn_, tokenOut_);

    uint256 priceAverageCumulative = 0;
    Observation[] storage obs = observations[factory_][pair];
    uint256 length = obs.length-1;
    uint256 i = length.sub(granularity_);

    uint256 nextIndex = 0;
    if (token0 == tokenIn_) {
      for (; i < length; i++) {
        nextIndex = i+1;
        priceAverageCumulative += computeAmountOut(
          obs[i].price0Cumulative,
          obs[nextIndex].price0Cumulative,
          obs[nextIndex].timestamp - obs[i].timestamp, amountIn_);
      }
    } else {
      for (; i < length; i++) {
        nextIndex = i+1;
        priceAverageCumulative += computeAmountOut(
          obs[i].price1Cumulative,
          obs[nextIndex].price1Cumulative,
          obs[nextIndex].timestamp - obs[i].timestamp, amountIn_);
      }
    }

    return priceAverageCumulative.div(granularity_);
  }

  /*** PRICE SAMPLES GETTER ***/

  function sample(address factory_, address tokenIn_, uint256 amountIn_, address tokenOut_, uint256 points_, uint256 window_) public view returns (uint[] memory) {
    (address token0,) = UniswapV2Library.sortTokens(tokenIn_, tokenOut_);
    uint256[] memory _prices = new uint256[](points_);

    Observation[] storage obs = observations[factory_][UniswapV2Library.pairFor(factory_, tokenIn_, tokenOut_)];
    uint256 length = obs.length-1;
    uint256 i = length.sub(points_ * window_);
    uint256 nextIndex = 0;
    uint256 index = 0;

    if (token0 == tokenIn_) {
      for (; i < length; i+= window_) {
        nextIndex = i + window_;
        _prices[index] = computeAmountOut(
          obs[i].price0Cumulative,
          obs[nextIndex].price0Cumulative,
          obs[nextIndex].timestamp - obs[i].timestamp, amountIn_);
        index = index + 1;
      }
    } else {
      for (; i < length; i+= window_) {
        nextIndex = i + window_;
        _prices[index] = computeAmountOut(
          obs[i].price1Cumulative,
          obs[nextIndex].price1Cumulative,
          obs[nextIndex].timestamp - obs[i].timestamp, amountIn_);
        index = index + 1;
      }
    }

    return _prices;
  }

  /*** DEFAULT CACHED PRICE GETTERS ***/

  /**
   * @notice Get the underlying price of a token
   * @param token_ The token address for price retrieval
   * @return Price denominated in USD, with 6 decimals, for the given asset address
   */
  function getPriceByAsset(address token_) external view override returns (uint256) {
    TokenConfig memory config = tokenConfigs[token_];
    return priceInternal(config.exchanges[0], config);
  }

  /**
   * @notice Get the official price for a symbol, like "COMP"
   * @param symbol_ The symbol for price retrieval
   * @return Price denominated in USD, with 6 decimals
   */
  function getPriceBySymbol(string calldata symbol_) external view override returns (uint256) {
    TokenConfig memory config = getTokenConfigBySymbol(symbol_);
    return priceInternal(config.exchanges[0], config);
  }

  /**
   * @notice Get price by a token symbol hash,
   *    like "0xd6aca1be9729c13d677335161321649cccae6a591554772516700f986f942eaa" for USDC
   * @param symbolHash_ The symbol hash for price retrieval
   * @return Price denominated in USD, with 6 decimals, for the given asset address
   */
  function getPriceBySymbolHash(bytes32 symbolHash_) external view override returns (uint256) {
    TokenConfig memory config = getTokenConfigBySymbolHash(symbolHash_);
    return priceInternal(config.exchanges[0], config);
  }

  /**
   * @notice Get the underlying price of a cToken
   * @dev Implements the PriceOracle interface for Compound v2.
   * @param cToken_ The cToken address for price retrieval
   * @return Price denominated in USD, with 18 decimals, for the given cToken address
   */
  function getUnderlyingPrice(address cToken_) external view override returns (uint256) {
    TokenConfig memory config = getTokenConfigByCToken(cToken_);
    // Comptroller needs prices in the format: ${raw price} * 1e(36 - baseUnit)
    // Since the prices in this view have 6 decimals, we must scale them by 1e(36 - 6 - baseUnit)
    return priceInternal(config.exchanges[0], config).mul(1e30) / config.baseUnit;
  }

  /*** FACTORY PRICE GETTERS ***/

  /**
   * @notice Get the underlying price of a token
   * @param token_ The token address for price retrieval
   * @return Price denominated in USD, with 6 decimals, for the given asset address
   */
  function getPriceByAsset(address factory_, address token_) external view override returns (uint256) {
    TokenConfig memory config = tokenConfigs[token_];
    return priceInternal(factory_, config);
  }

  /**
   * @notice Get the official price for a symbol, like "COMP"
   * @param symbol_ The symbol for price retrieval
   * @return Price denominated in USD, with 6 decimals
   */
  function getPriceBySymbol(address factory_, string calldata symbol_) external view override returns (uint256) {
    TokenConfig memory config = getTokenConfigBySymbol(symbol_);
    return priceInternal(factory_, config);
  }

  /**
   * @notice Get price by a token symbol hash,
   *    like "0xd6aca1be9729c13d677335161321649cccae6a591554772516700f986f942eaa" for USDC
   * @param symbolHash_ The symbol hash for price retrieval
   * @return Price denominated in USD, with 6 decimals, for the given asset address
   */
  function getPriceBySymbolHash(address factory_, bytes32 symbolHash_) external view override returns (uint256) {
    TokenConfig memory config = getTokenConfigBySymbolHash(symbolHash_);
    return priceInternal(factory_, config);
  }

  /**
   * @notice Get the underlying price of a cToken
   * @dev Implements the PriceOracle interface for Compound v2.
   * @param cToken_ The cToken address for price retrieval
   * @return Price denominated in USD, with 18 decimals, for the given cToken address
   */
  function getUnderlyingPrice(address factory_, address cToken_) external view override returns (uint256) {
    TokenConfig memory config = getTokenConfigByCToken(cToken_);
    // Comptroller needs prices in the format: ${raw price} * 1e(36 - baseUnit)
    // Since the prices in this view have 6 decimals, we must scale them by 1e(36 - 6 - baseUnit)
    return priceInternal(factory_, config).mul(1e30) / config.baseUnit;
  }
}
