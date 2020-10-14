// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/upgrades-core/contracts/Initializable.sol";
import "./utils/Ownable.sol";
import "./utils/SafeMath.sol";
import "./interfaces/IERC20.sol";
import "./interfaces/IPowerOracle.sol";
import "./interfaces/IPowerOracleStaking.sol";
import "./UniswapTWAPProvider.sol";
import "./interfaces/IPowerOracleStaking.sol";


contract PowerOracle is IPowerOracle, Ownable, Initializable, UniswapTWAPProvider {
  using SafeMath for uint256;

  uint256 public constant REWARD_USER_EXTERNAL_HARD_COUNT_LIMIT = 100;

  struct Price {
    uint128 timestamp;
    uint128 value;
  }

  event SetReportReward(uint256 reportReward);
  event SetReportIntervals(uint256 minReportInterval, uint256 maxReportInterval);

  /// @notice The event emitted when a reporter receives their reward for the report
  event RewardUser(uint256 indexed userId, uint count, uint ethPrice, uint cvpPrice, uint calculatedReward);

  /// @notice The event emitted when a reporter is not eligible for a reward or rewards are disabled
  event RewardIgnored(uint256 indexed userId, uint count, uint ethPrice, uint cvpPrice, uint256 calculatedReward, uint maxCvpReward);

  event NothingToReward(uint256 indexed userId, uint ethPrice);
  event RewardAddress(address indexed to, uint256 count, uint256 amount);

  /// @notice The event emitted when the stored price is updated
  event PriceUpdated(string symbol, uint price);
  event PokeFromReporter(uint256 indexed reporterId, uint256 tokenCount, uint256 rewardCount);
  event PokeFromSlasher(uint256 indexed slasherId, uint256 tokenCount, uint256 overdueCount);
  event Poke(address indexed poker, uint256 tokenCount);
  event SetMaxCvpReward(uint256 maxCvpReward);
  event SetPowerOracleStaking(address powerOracleStaking);

  IERC20 public immutable cvpToken;
  address public immutable reservoir;
  IPowerOracleStaking public powerOracleStaking;

  /// @notice The limit in CVP for a reward for reportin a single token
  uint256 public maxCvpReward;

  /// @notice The reward in ETH for reporting a single token
  uint256 public reportReward;
  uint256 public minReportInterval;
  uint256 public maxReportInterval;

  mapping(uint256 => uint256) public rewards;

  /// @notice Official prices and timestamps by symbol hash
  mapping(bytes32 => Price) public prices;

  constructor(
    address cvpToken_,
    address reservoir_,
    uint256 anchorPeriod_,
    TokenConfig[] memory configs
  ) public UniswapTWAPProvider(anchorPeriod_, configs) UniswapConfig(configs) {
    cvpToken = IERC20(cvpToken_);
    reservoir = reservoir_;
  }

  function initialize(
    address owner_,
    address powerOracleStaking_,
    uint256 reportReward_,
    uint256 maxCvpReward_,
    uint256 minReportInterval_,
    uint256 maxReportInterval_
  ) external initializer {
    _transferOwnership(owner_);
    powerOracleStaking = IPowerOracleStaking(powerOracleStaking_);
    reportReward = reportReward_;
    maxCvpReward = maxCvpReward_;
    minReportInterval = minReportInterval_;
    maxReportInterval = maxReportInterval_;
  }

  /*** Current Poke Interface ***/

  function _updateEthPrice() internal returns (uint256) {
    uint256 ethPrice = fetchEthPrice();
    _savePrice("ETH", ethPrice);
    return ethPrice;
  }

  function _updateCvpPrice() internal returns (uint256) {
    uint256 cvpPrice = fetchCvpPrice();
    _savePrice("CVP", cvpPrice);
    return cvpPrice;
  }

  function pokeFromReporter(uint256 reporterId_, string[] memory symbols_) external {
    uint256 len = symbols_.length;
    require(len > 0, "PowerOracle::pokeFromReporter: Missing token symbols");

    powerOracleStaking.authorizeReporter(reporterId_, msg.sender);

    uint256 ethPrice = _updateEthPrice();
    uint256 cvpPrice = _updateCvpPrice();
    uint256 rewardCount = 0;

    // Try to update the view storage
    for (uint256 i = 0; i < len; i++) {
      if (_fetchAndSavePrice(symbols_[i], ethPrice) != ReportInterval.LESS_THAN_MIN) {
        rewardCount++;
      }
    }

    emit PokeFromReporter(reporterId_, len, rewardCount);
    _rewardUser(reporterId_, rewardCount, ethPrice, cvpPrice);
  }

  function pokeFromSlasher(uint256 slasherId_, string[] memory symbols_) external {
    uint256 len = symbols_.length;
    require(len > 0, "PowerOracle::pokeFromSlasher: Missing token symbols");

    powerOracleStaking.authorizeSlasher(slasherId_, msg.sender);

    uint256 ethPrice = _updateEthPrice();
    uint256 overdueCount = 0;

    // Try to update the view storage
    for (uint256 i = 0; i < len; i++) {
      if (_fetchAndSavePrice(symbols_[i], ethPrice) == ReportInterval.GREATER_THAN_MAX) {
        overdueCount++;
      }
    }

    emit PokeFromSlasher(slasherId_, len, overdueCount);
    if (overdueCount > 0) {
      powerOracleStaking.slash(slasherId_, overdueCount);
    }
  }

  function poke(string[] memory symbols_) public {
    uint256 len = symbols_.length;
    require(len > 0, "PowerOracle::poke: Missing token symbols");

    uint256 ethPrice = _updateEthPrice();

    // Try to update the view storage
    for (uint256 i = 0; i < len; i++) {
      _fetchAndSavePrice(symbols_[i], ethPrice);
    }

    emit Poke(msg.sender, len);
  }

  function _fetchAndSavePrice(string memory symbol_, uint ethPrice_) internal returns (ReportInterval) {
    TokenConfig memory config = getTokenConfigBySymbol(symbol_);
    require(config.priceSource == PriceSource.REPORTER, "only reporter prices get posted");

    uint256 price = fetchAnchorPrice(symbol_, config, ethPrice_);

    return _savePrice(symbol_, price);
  }

  function _savePrice(string memory symbol_, uint256 price_) internal returns (ReportInterval) {
    bytes32 symbolHash = keccak256(abi.encodePacked(symbol_));

    uint256 delta = block.timestamp - prices[symbolHash].timestamp;
    // TODO: use a safe Uint128 case
    prices[keccak256(abi.encodePacked(symbol_))] = Price(uint128(block.timestamp), uint128(price_));

    if (delta < minReportInterval) {
      return ReportInterval.LESS_THAN_MIN;
    }

    if (delta < maxReportInterval) {
      return ReportInterval.OK;
    }

    return ReportInterval.GREATER_THAN_MAX;
  }

  function _rewardUser(uint256 userId_, uint256 count_, uint256 ethPrice_, uint256 cvpPrice_) internal {
    if (count_ == 0) {
      emit NothingToReward(userId_, ethPrice_);
      return;
    }

    uint256 amount = calculateReward(count_, ethPrice_, cvpPrice_);

    if (amount > 0) {
      rewards[userId_] = rewards[userId_].add(amount);
      emit RewardUser(userId_, count_, ethPrice_, cvpPrice_, amount);
    } else {
      emit RewardIgnored(userId_, count_, ethPrice_, cvpPrice_, amount, maxCvpReward);
    }
  }

  function calculateReward(uint256 count_, uint256 ethPrice_, uint256 cvpPrice_) public view returns(uint) {
    if (count_ == 0) {
      return 0;
    }

    require(ethPrice_ > 0, "calculateReward: ETH price is 0");
    require(cvpPrice_ > 0, "calculateReward: CVP price is 0");
    require(reportReward > 0, "calculateReward: ethReward is 0");

    // return count * cvpReward * ethPrice / cvpPrice
    uint singleTokenCvpReward = mul(reportReward, ethPrice_) / cvpPrice_;

    return mul(count_, singleTokenCvpReward > maxCvpReward ? maxCvpReward : singleTokenCvpReward);
  }

  function priceInternal(TokenConfig memory config_) internal view returns (uint) {
    if (config_.priceSource == PriceSource.REPORTER) return prices[config_.symbolHash].value;
    if (config_.priceSource == PriceSource.FIXED_USD) return config_.fixedPrice;
    if (config_.priceSource == PriceSource.FIXED_ETH) {
      uint usdPerEth = prices[ethHash].value;
      require(usdPerEth > 0, "ETH price not set, cannot convert to dollars");
      return mul(usdPerEth, config_.fixedPrice) / ethBaseUnit;
    }
    revert("UniswapTWAPProvider::priceInternal: Unsupported case");
  }

  function rewardAddress(address to_, uint256 count_) public override virtual {
    require(msg.sender == address(powerOracleStaking), "PowerOracle::rewardUser: Only Staking contract allowed");
    require(count_ < REWARD_USER_EXTERNAL_HARD_COUNT_LIMIT, "PowerOracle::rewardUser: Count has a hard limit of 100");
    require(count_ > 0, "PowerOracle::rewardUser: Count should be positive");

    uint256 ethPrice = _updateEthPrice();
    uint256 cvpPrice = _updateCvpPrice();

    uint256 amount = calculateReward(count_, ethPrice, cvpPrice);
    if (amount > 0) {
      cvpToken.transferFrom(reservoir, to_, amount);
    }
    emit RewardAddress(to_, count_, amount);
  }

  /// Withdraw available rewards
  function withdrawRewards(uint256 userId_, address to_) external override {
    powerOracleStaking.requireValidFinancierKey(userId_, msg.sender);
    require(to_ != address(0), "PowerOracle::withdrawRewards: Can't withdraw to 0 address");
    uint256 rewardAmount = rewards[userId_];
    require(rewardAmount > 0, "PowerOracle::withdrawRewards: Nothing to withdraw");
    rewards[userId_] = 0;

    cvpToken.transferFrom(reservoir, to_, rewardAmount);
  }

  /*** Owner Interface ***/
  /// The owner sets the current reward per report in ETH tokens
  function setReportReward(uint256 reportReward_) external override onlyOwner {
    reportReward = reportReward_;
    emit SetReportReward(reportReward_);
  }

  function setMaxCvpReward(uint256 maxCvpReward_) external override onlyOwner {
    maxCvpReward = maxCvpReward_;
    emit SetMaxCvpReward(maxCvpReward_);
  }

  /// The owner sets the current report min/max in seconds
  function setReportIntervals(uint256 minReportInterval_, uint256 maxReportInterval_) external override onlyOwner {
    minReportInterval = minReportInterval_;
    maxReportInterval = maxReportInterval_;
    emit SetReportIntervals(minReportInterval_, maxReportInterval_);
  }

  function setPowerOracleStaking(address powerOracleStaking_) external override onlyOwner {
    powerOracleStaking = IPowerOracleStaking(powerOracleStaking_);
    emit SetPowerOracleStaking(powerOracleStaking_);
  }

  /*** Viewers ***/

  /**
   * @notice Get the underlying price of a token
   * @param token_ The token address for price retrieval
   * @return Price denominated in USD, with 6 decimals, for the given asset address
   */
  function getPriceByAsset(address token_) external view override returns (uint) {
    TokenConfig memory config = getTokenConfigByUnderlying(token_);
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
   * @notice Get the underlying price of a cToken
   * @dev Implements the PriceOracle interface for Compound v2.
   * @param cToken_ The cToken address for price retrieval
   * @return Price denominated in USD, with 18 decimals, for the given cToken address
   */
  function getUnderlyingPrice(address cToken_) external view override returns (uint) {
    TokenConfig memory config = getTokenConfigByCToken(cToken_);
    // Comptroller needs prices in the format: ${raw price} * 1e(36 - baseUnit)
    // Since the prices in this view have 6 decimals, we must scale them by 1e(36 - 6 - baseUnit)
    return mul(1e30, priceInternal(config)) / config.baseUnit;
  }
}
