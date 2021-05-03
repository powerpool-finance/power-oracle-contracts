// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "./Uniswap/UniswapV2OracleLibrary.sol";
import "./PowerOracleReader.sol";

abstract contract UniswapTWAPProvider is PowerOracleReader {
  using FixedPoint for *;
  using SafeMath for uint256;

  /// @notice A common scaling factor to maintain precision
  uint public constant expScale = 1e18;

  /// @notice The event emitted when anchor price is updated
  event AnchorPriceUpdated(string symbol, bytes32 indexed symbolHash, uint anchorPrice, uint oldTimestamp, uint newTimestamp);

  /// @notice The event emitted when the uniswap window changes
  event UniswapWindowUpdated(bytes32 indexed symbolHash, uint oldTimestamp, uint newTimestamp, uint oldPrice, uint newPrice);

  /// @notice The minimum amount of time in seconds required for the old uniswap price accumulator to be replaced
  uint public immutable ANCHOR_PERIOD;

  constructor(uint256 anchorPeriod_) public {
    ANCHOR_PERIOD = anchorPeriod_;
  }

  /**
    * @dev Fetches the current token/eth price accumulator from uniswap.
    */
  function currentCumulativePrice(TokenConfigUpdate memory config) internal view returns (uint) {
    (uint cumulativePrice0, uint cumulativePrice1,) = UniswapV2OracleLibrary.currentCumulativePrices(config.uniswapMarket);
    if (config.isUniswapReversed) {
      return cumulativePrice1;
    } else {
      return cumulativePrice0;
    }
  }

  /**
   * @dev Fetches the current eth/usd price from uniswap, with 6 decimals of precision.
   *  Conversion factor is 1e18 for eth/usdc market, since we decode uniswap price statically with 18 decimals.
   */
  function fetchEthPrice() internal returns (uint) {
    address token = tokenBySymbolHash[ethHash];
    return fetchAnchorPrice("ETH", getTokenConfig(token), getTokenUpdateConfig(token), ethBaseUnit);
  }

  function fetchCvpPrice(uint256 ethPrice) internal returns (uint) {
    address token = tokenBySymbolHash[cvpHash];
    return fetchAnchorPrice("CVP", getTokenConfig(token), getTokenUpdateConfig(token), ethPrice);
  }

  /**
   * @dev Fetches the current token/usd price from uniswap, with 6 decimals of precision.
   * @param conversionFactor 1e18 if seeking the ETH price, and a 6 decimal ETH-USDC price in the case of other assets
   */
  function fetchAnchorPrice(string memory symbol, TokenConfig memory config, TokenConfigUpdate memory updateConfig, uint conversionFactor) internal virtual returns (uint) {
    (uint nowCumulativePrice, uint oldCumulativePrice, uint oldTimestamp) = pokeWindowValues(config.symbolHash, updateConfig);

    // This should be impossible, but better safe than sorry
    require(block.timestamp > oldTimestamp, "TOO_EARLY");
    uint timeElapsed = block.timestamp - oldTimestamp;

    // Calculate uniswap time-weighted average price
    // Underflow is a property of the accumulators: https://uniswap.org/audit.html#orgc9b3190
    FixedPoint.uq112x112 memory priceAverage = FixedPoint.uq112x112(uint224((nowCumulativePrice - oldCumulativePrice) / timeElapsed));
    uint rawUniswapPriceMantissa = priceAverage.decode112with18();
    uint unscaledPriceMantissa = rawUniswapPriceMantissa.mul(conversionFactor);
    uint anchorPrice;

    // Adjust rawUniswapPrice according to the units of the non-ETH asset
    // In the case of ETH, we would have to scale by 1e6 / USDC_UNITS, but since baseUnit2 is 1e6 (USDC), it cancels
    if (updateConfig.isUniswapReversed) {
      // unscaledPriceMantissa * ethBaseUnit / config.baseUnit / expScale, but we simplify bc ethBaseUnit == expScale
      anchorPrice = unscaledPriceMantissa / uint256(config.baseUnit);
    } else {
      anchorPrice = unscaledPriceMantissa.mul(config.baseUnit) / ethBaseUnit / expScale;
    }

    emit AnchorPriceUpdated(symbol, config.symbolHash, anchorPrice, oldTimestamp, block.timestamp);

    return anchorPrice;
  }

  /**
   * @dev Get time-weighted average prices for a token at the current timestamp.
   *  Update new and old observations of lagging window if period elapsed.
   */
  function pokeWindowValues(bytes32 symbolHash, TokenConfigUpdate memory updateConfig) internal returns (uint, uint, uint) {
    uint cumulativePrice = currentCumulativePrice(updateConfig);

    Observation memory newObservation = newObservations[symbolHash];

    // Update new and old observations if elapsed time is greater than or equal to anchor period
    uint timeElapsed = block.timestamp - newObservation.timestamp;
    if (timeElapsed >= ANCHOR_PERIOD) {
      oldObservations[symbolHash].timestamp = newObservation.timestamp;
      oldObservations[symbolHash].acc = newObservation.acc;

      newObservations[symbolHash].timestamp = block.timestamp;
      newObservations[symbolHash].acc = cumulativePrice;
      emit UniswapWindowUpdated(symbolHash, newObservation.timestamp, block.timestamp, newObservation.acc, cumulativePrice);
    }
    return (cumulativePrice, oldObservations[symbolHash].acc, oldObservations[symbolHash].timestamp);
  }
}
