// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "./Uniswap/UniswapV2OracleLibrary.sol";
import "./lib/FixedPoint.sol";
import "./TokenDetails.sol";
import "hardhat/console.sol";
import "./PowerOracleReader.sol";


abstract contract PowerOracleTWAPProvider is PowerOracleReader {
  using FixedPoint for *;
  using SafeMath for uint256;

  /// @notice A common scaling factor to maintain precision
  uint public constant EXP_SCALE = 1e18;

  /// @notice The event emitted when anchor price is updated
  event AnchorPriceUpdated(string symbol, bytes32 indexed symbolHash, uint anchorPrice, uint oldTimestamp, uint newTimestamp);

  /// @notice The event emitted when the uniswap window changes
  event UniswapWindowUpdated(bytes32 indexed symbolHash, uint oldTimestamp, uint newTimestamp, uint oldPrice, uint newPrice);

  /**
   * @dev Fetches the current eth/usd price from uniswap, with 6 decimals of precision.
   *  Conversion factor is 1e18 for eth/usdc market, since we decode uniswap price statically with 18 decimals.
   */
  function fetchEthPrice() internal returns (uint) {
    return fetchAnchorPrice("ETH", UNISWAP_FACTORY, getTokenConfigBySymbolHash(ethHash), ETH_BASE_UNIT);
  }

  function fetchCvpPrice(uint256 ethPrice) internal returns (uint) {
    return fetchAnchorPrice("CVP", UNISWAP_FACTORY, getTokenConfigBySymbolHash(cvpHash), ethPrice);
  }

  /**
   * @dev Fetches the current token/usd price from uniswap, with 6 decimals of precision.
   * @param conversionFactor 1e18 if seeking the ETH price, and a 6 decimal ETH-USDC price in the case of other assets
   */
  function fetchAnchorPrice(
    string memory symbol,
    address factory,
    TokenConfig memory config,
    uint conversionFactor
  ) internal virtual returns (uint) {
    (uint nowCumulativePrice, uint oldCumulativePrice, uint oldTimestamp) = pokeWindowValues(factory, config);

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
    if (tokenExchangeDetails[config.token][factory].isReversed) {
      // unscaledPriceMantissa * ethBaseUnit / config.baseUnit / expScale, but we simplify bc ethBaseUnit == expScale
      anchorPrice = unscaledPriceMantissa / config.baseUnit;
    } else {
      anchorPrice = unscaledPriceMantissa.mul(config.baseUnit) / ETH_BASE_UNIT / EXP_SCALE;
    }

    emit AnchorPriceUpdated(symbol, keccak256(abi.encodePacked(symbol)), anchorPrice, oldTimestamp, block.timestamp);

    return anchorPrice;
  }

  /**
   * @dev Get time-weighted average prices for a token at the current timestamp.
   *  Update new and old observations of lagging window if period elapsed.
   */
  function pokeWindowValues(address factory_, TokenConfig memory config_) internal returns (uint256, uint256, uint256) {
    ExchangePair memory exchange = tokenExchangeDetails[config_.token][factory_];

    (uint cumulativePrice0, uint cumulativePrice1,) = UniswapV2OracleLibrary.currentCumulativePrices(exchange.pair);

    // TODO: avoid redundant sload
    Observation memory lastObservation = getLastObservation(factory_, config_.token);

    uint256 newCumulative;
    uint256 lastCumulative;

    if (exchange.isReversed) {
      newCumulative = cumulativePrice1;
      lastCumulative = lastObservation.price1Cumulative;
    } else {
      newCumulative = cumulativePrice0;
      lastCumulative = lastObservation.price0Cumulative;
    }

    uint timeElapsed = block.timestamp - lastObservation.timestamp;
    if (timeElapsed >= ANCHOR_PERIOD) {
      // tODO: update
      observations[factory_][config_.token].push(Observation(block.timestamp, cumulativePrice0, cumulativePrice1));
//      emit UniswapWindowUpdated(config.symbolHash, lastObservation.timestamp, block.timestamp, lastObservation.acc, cumulativePrice);
    }
    return (newCumulative, lastCumulative, lastObservation.timestamp);
  }
}
