// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./utils/Ownable.sol";
import "./utils/SafeMath.sol";
import "./interfaces/IERC20.sol";
import "./interfaces/IPowerOracle.sol";
import "./interfaces/IPowerOracleStaking.sol";
import "./UniswapTWAPProvider.sol";
import "./interfaces/IPowerOracleStaking.sol";


contract PowerOracle is IPowerOracle, UniswapTWAPProvider, Ownable {
  using SafeMath for uint256;

  struct User {
    address rewards;
  }

  struct Price {
    uint128 timestamp;
    uint128 value;
  }

  event SetReportReward(uint256 reportReward);
  event SetReportIntervals(uint256 minReportInterval, uint256 maxReportInterval);

  /// @notice The event emitted when the stored price is updated
  event PriceUpdated(string symbol, uint price);

  IERC20 public immutable cvpToken;
  address public immutable reservoir;
  IPowerOracleStaking public powerOracleStaking;

  uint256 public reportReward;
  uint256 public minReportInterval;
  uint256 public maxReportInterval;

  mapping(uint256 => uint256) public rewards;

  /// @notice Official prices and timestamps by symbol hash
  mapping(bytes32 => Price) public prices;

  constructor(
    address cvpToken_,
    address reservoir_,
    uint256 anchorToleranceMantissa_,
    uint256 anchorPeriod_,
    TokenConfig[] memory configs
  ) public UniswapTWAPProvider(anchorToleranceMantissa_, anchorPeriod_, configs) UniswapConfig(configs) {
    cvpToken = IERC20(cvpToken_);
    reservoir = reservoir_;
  }

  // TODO: make initializable
  function initialize(
    address powerOracleStaking_,
    uint256 reportReward_,
    uint256 minReportInterval_,
    uint256 maxReportInterval_
  ) external {
    powerOracleStaking = IPowerOracleStaking(powerOracleStaking_);
    reportReward = reportReward_;
    minReportInterval = minReportInterval_;
    maxReportInterval = maxReportInterval_;
  }

  /*** Current Reporter Or Slasher Interface ***/
  /// Poke to update the given symbol prices
  function poke(uint256 reporterId_, string[] memory symbols_) public {
    IPowerOracleStaking.UserStatus status = powerOracleStaking.getUserStatus(reporterId_, msg.sender);

    if (status == IPowerOracleStaking.UserStatus.CAN_REPORT) {
      _pokeFromReporter(symbols_);
    } else if (status == IPowerOracleStaking.UserStatus.CAN_SLASH) {
      _pokeFromSlasher(symbols_);
    } else {
      _pokeWithoutReward(symbols_);
    }
  }

  function _updateEthPrice() internal returns (uint256) {
    uint256 ethPrice = fetchEthPrice();
    _savePrice("ETH", ethPrice);
    return ethPrice;
  }

  function _pokeFromReporter(string[] memory symbols_) internal {
    uint256 ethPrice = _updateEthPrice();
    uint256 rewardCount = 0;
    uint256 len = symbols_.length;

    // Try to update the view storage
    for (uint256 i = 0; i < len; i++) {
      if (_fetchAndSavePrice(symbols_[i], ethPrice) != ReportInterval.LESS_THAN_MIN) {
        rewardCount++;
      }
    }

//    emit PostPrices(msg.sender, len, rewardCount);
//    payoutReward(rewardCount, ethPrice);
  }

  function _pokeFromSlasher(string[] memory symbols_) internal {
    uint256 ethPrice = _updateEthPrice();
    uint256 rewardCount = 0;
    uint256 len = symbols_.length;

    // Try to update the view storage
    for (uint256 i = 0; i < len; i++) {
      if (_fetchAndSavePrice(symbols_[i], ethPrice) == ReportInterval.GREATER_THAN_MAX) {
        rewardCount++;
      }
    }
  }

  function _pokeWithoutReward(string[] memory symbols_) internal {
    uint256 ethPrice = _updateEthPrice();
    uint256 len = symbols_.length;

    // Try to update the view storage
    for (uint256 i = 0; i < len; i++) {
      _fetchAndSavePrice(symbols_[i], ethPrice);
    }
  }

  enum ReportInterval {
    LESS_THAN_MIN,
    OK,
    GREATER_THAN_MAX
  }

  function _fetchAndSavePrice(string memory symbol_, uint ethPrice_) internal returns (ReportInterval) {
    TokenConfig memory config = getTokenConfigBySymbol(symbol_);
    require(config.priceSource == PriceSource.REPORTER, "only reporter prices get posted");

    uint256 price = fetchAnchorPrice(symbol_, config, ethPrice_);

    return _savePrice(symbol_, price);
  }

  function _savePrice(string memory symbol_, uint256 price_) internal returns (ReportInterval) {
    bytes32 symbolHash = keccak256(abi.encodePacked(symbol_));
    Price memory oldPrice = prices[symbolHash];

    uint256 now = block.timestamp;

    uint256 delta = now - oldPrice.timestamp;
    if (delta < minReportInterval) {
      return ReportInterval.LESS_THAN_MIN;
    }

    // TODO: use a safe Uint128 case
    prices[keccak256(abi.encodePacked(symbol_))] = Price(uint128(block.timestamp), uint128(price_));
    emit PriceUpdated(symbol_, price_);

    if (delta < maxReportInterval) {
      return ReportInterval.OK;
    }

    return ReportInterval.GREATER_THAN_MAX;
  }

  function priceInternal(TokenConfig memory config) internal view returns (uint) {
    if (config.priceSource == PriceSource.REPORTER) return prices[config.symbolHash].value;
    if (config.priceSource == PriceSource.FIXED_USD) return config.fixedPrice;
    if (config.priceSource == PriceSource.FIXED_ETH) {
      uint usdPerEth = prices[ethHash].value;
      require(usdPerEth > 0, "ETH price not set, cannot convert to dollars");
      return mul(usdPerEth, config.fixedPrice) / ethBaseUnit;
    }
    revert("UniswapTWAPProvider::priceInternal: Unsupported case");
  }

  /// Withdraw available rewards
  function withdrawRewards(uint256 userId_, address to_) external override {
    powerOracleStaking.requireValidFinancierKey(userId_, msg.sender);
    require(to_ != address(0), "PowerOracle::withdrawRewards: Can't withdraw to 0 address");
    uint256 rewardAmount = rewards[userId_];
    require(rewardAmount > 0, "PowerOracle::withdrawRewards: Nothing to withdraw");

    cvpToken.transferFrom(reservoir, to_, rewardAmount);
  }

  /*** Owner Interface ***/
  /// The owner sets the current reward per report in ETH tokens
  function setReportReward(uint256 reportReward_) external override onlyOwner {
    reportReward = reportReward_;
    emit SetReportReward(reportReward_);
  }

  /// The owner sets the current report min/max in seconds
  function setReportIntervals(uint256 minReportInterval_, uint256 maxReportInterval_) external override onlyOwner {
    minReportInterval = minReportInterval_;
    maxReportInterval = maxReportInterval_;
    emit SetReportIntervals(minReportInterval_, maxReportInterval_);
  }

  /*** Viewers ***/

  /// Get price by a token address
  function getPriceByAddress(address token) external view override returns (uint256) {

  }

  /// Get price by a token symbol, like "USDC"
  function getPriceBySymbol(string calldata symbol) external view override returns (uint256) {

  }

  /// Get price by a token symbol hash, like "0xd6aca1be9729c13d677335161321649cccae6a591554772516700f986f942eaa" for USDC
  function getPriceByHash(bytes32 symbolHash) external view override returns (uint256) {

  }

  /// Get price by a token symbol in bytes32 representation, like "0x5553444300000000000000000000000000000000000000000000000000000000" for USDC
  function getPriceByBytes32(bytes32 symbol) external view override returns (uint256) {

  }

  /// Get rewards by accounts
  function getRewardsAvailable(address userId) external view override returns (uint256) {

  }

  /**
 * @notice Get the official price for a symbol
 * @param symbol The symbol to fetch the price of
 * @return Price denominated in USD, with 6 decimals
 */
  function price(string memory symbol) external view returns (uint) {
    TokenConfig memory config = getTokenConfigBySymbol(symbol);
    return priceInternal(config);
  }
  /**
   * @notice Get the underlying price of a cToken
   * @dev Implements the PriceOracle interface for Compound v2.
   * @param cToken The cToken address for price retrieval
   * @return Price denominated in USD, with 18 decimals, for the given cToken address
   */
  function getUnderlyingPrice(address cToken) external view returns (uint) {
    TokenConfig memory config = getTokenConfigByCToken(cToken);
    // Comptroller needs prices in the format: ${raw price} * 1e(36 - baseUnit)
    // Since the prices in this view have 6 decimals, we must scale them by 1e(36 - 6 - baseUnit)
    return mul(1e30, priceInternal(config)) / config.baseUnit;
  }
}
