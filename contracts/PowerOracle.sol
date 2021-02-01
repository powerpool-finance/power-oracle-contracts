// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/upgrades-core/contracts/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "./interfaces/IPowerOracle.sol";
import "./UniswapTWAPProvider.sol";
import "./utils/Pausable.sol";
import "./utils/Ownable.sol";
import "./PowerPoke.sol";

// Gas Compensation Plans:
// 1 - for pokeFromReporter and slashReporter
// 2 - for slasherHeartbeat
contract PowerOracle is IPowerOracle, Ownable, Initializable, Pausable, UniswapTWAPProvider {
  using SafeMath for uint256;
  using SafeCast for uint256;

  uint256 public constant HUNDRED_PCT = 100 ether;

  struct Price {
    uint128 timestamp;
    uint128 value;
  }

  /// @notice The event emitted when a reporter calls a poke operation
  event PokeFromReporter(uint256 indexed reporterId, uint256 tokenCount, uint256 rewardCount);

  /// @notice The event emitted when a slasher executes poke and slashes the current reporter
  event PokeFromSlasher(uint256 indexed slasherId, uint256 tokenCount, uint256 overdueCount);

  /// @notice The event emitted when an arbitrary user calls poke operation
  event Poke(address indexed poker, uint256 tokenCount);

  /// @notice The event emitted when the owner updates the powerOracleStaking address
  event SetPowerPoke(address powerPoke);

  /// @notice The event emitted when the slasher timestamps are updated
  event UpdateSlasher(uint256 indexed slasherId, uint256 prevSlasherTimestamp, uint256 newSlasherTimestamp);

  /// @notice CVP token address
  IERC20 public immutable CVP_TOKEN;

  /// @notice The linked PowerOracleStaking contract address
  PowerPoke public powerPoke;

  /// @notice Official prices and timestamps by symbol hash
  mapping(bytes32 => Price) public prices;

  /// @notice Last slasher update time by a user ID
  mapping(uint256 => uint256) public lastSlasherUpdates;

  modifier onlyReporter(uint256 reporterId_, bytes calldata rewardOpts) {
    uint256 gasStart = gasleft();
    powerPoke.authorizeReporter(reporterId_, msg.sender);
    _;
    uint256 gasUsed = gasStart.sub(gasleft());
    powerPoke.reward(reporterId_, gasUsed, 1, rewardOpts);
  }

  modifier onlySlasher(uint256 slasherId_, bytes calldata rewardOpts) {
    uint256 gasStart = gasleft();
    powerPoke.authorizePoker(slasherId_, msg.sender);
    _;
    uint256 gasUsed = gasStart.sub(gasleft());
    powerPoke.reward(slasherId_, gasUsed, 1, rewardOpts);
  }

  constructor(
    address cvpToken_,
    uint256 anchorPeriod_,
    TokenConfig[] memory configs
  ) public UniswapTWAPProvider(anchorPeriod_, configs) UniswapConfig(configs) {
    CVP_TOKEN = IERC20(cvpToken_);
  }

  function initialize(address owner_, address powerPoke_) external initializer {
    _transferOwnership(owner_);
    powerPoke = PowerPoke(powerPoke_);
  }

  /*** Current Poke Interface ***/

  function _fetchEthPrice() internal returns (uint256) {
    bytes32 symbolHash = keccak256(abi.encodePacked("ETH"));
    if (getIntervalStatus(symbolHash) == ReportInterval.LESS_THAN_MIN) {
      return uint256(prices[symbolHash].value);
    }
    uint256 ethPrice = fetchEthPrice();
    _savePrice(symbolHash, ethPrice);
    return ethPrice;
  }

  function _fetchCvpPrice(uint256 ethPrice_) internal returns (uint256) {
    bytes32 symbolHash = keccak256(abi.encodePacked("CVP"));
    if (getIntervalStatus(symbolHash) == ReportInterval.LESS_THAN_MIN) {
      return uint256(prices[symbolHash].value);
    }
    uint256 cvpPrice = fetchCvpPrice(ethPrice_);
    _savePrice(symbolHash, cvpPrice);
    return cvpPrice;
  }

  function _fetchAndSavePrice(
    string memory symbol_,
    uint256 ethPrice_,
    uint256 minReportInterval_,
    uint256 maxReportInterval_
  ) internal returns (ReportInterval) {
    TokenConfig memory config = getTokenConfigBySymbol(symbol_);
    require(config.priceSource == PriceSource.REPORTER, "NOT_REPORTER");
    bytes32 symbolHash = keccak256(abi.encodePacked(symbol_));

    ReportInterval intervalStatus = getIntervalStatusForIntervals(symbolHash, minReportInterval_, maxReportInterval_);
    if (intervalStatus == ReportInterval.LESS_THAN_MIN) {
      return intervalStatus;
    }

    uint256 price;
    if (symbolHash == ethHash) {
      price = ethPrice_;
    } else {
      price = fetchAnchorPrice(symbol_, config, ethPrice_);
    }

    _savePrice(symbolHash, price);

    return intervalStatus;
  }

  function _savePrice(bytes32 _symbolHash, uint256 price_) internal {
    prices[_symbolHash] = Price(block.timestamp.toUint128(), price_.toUint128());
  }

  function priceInternal(TokenConfig memory config_) internal view returns (uint256) {
    if (config_.priceSource == PriceSource.REPORTER) return prices[config_.symbolHash].value;
    if (config_.priceSource == PriceSource.FIXED_USD) return config_.fixedPrice;
    if (config_.priceSource == PriceSource.FIXED_ETH) {
      uint256 usdPerEth = prices[ethHash].value;
      require(usdPerEth > 0, "ETH_PRICE_NOT_SET");
      return mul(usdPerEth, config_.fixedPrice) / ethBaseUnit;
    }
    revert("UNSUPPORTED_PRICE_CASE");
  }

  /*** Pokers ***/

  /**
   * @notice A reporter pokes symbols with incentive to be rewarded
   * @param reporterId_ The valid reporter's user ID
   * @param symbols_ Asset symbols to poke
   */
  function pokeFromReporter(
    uint256 reporterId_,
    string[] memory symbols_,
    bytes calldata rewardOpts
  ) external override onlyReporter(reporterId_, rewardOpts) whenNotPaused {
    uint256 len = symbols_.length;
    require(len > 0, "MISSING_SYMBOLS");

    uint256 ethPrice = _fetchEthPrice();
    _fetchCvpPrice(ethPrice);
    uint256 rewardCount = 0;
    (uint256 minReportInterval, uint256 maxReportInterval) = _getMinMaxReportInterval();

    for (uint256 i = 0; i < len; i++) {
      if (
        _fetchAndSavePrice(symbols_[i], ethPrice, minReportInterval, maxReportInterval) != ReportInterval.LESS_THAN_MIN
      ) {
        rewardCount++;
      }
    }

    require(rewardCount > 0, "NOTHING_UPDATED");

    emit PokeFromReporter(reporterId_, len, rewardCount);
  }

  /**
   * @notice A slasher pokes symbols with incentive to be rewarded
   * @param slasherId_ The slasher's user ID
   * @param symbols_ Asset symbols to poke
   */
  function pokeFromSlasher(
    uint256 slasherId_,
    string[] memory symbols_,
    bytes calldata rewardOpts
  ) external override onlySlasher(slasherId_, rewardOpts) whenNotPaused {
    uint256 len = symbols_.length;
    require(len > 0, "MISSING_SYMBOLS");

    uint256 ethPrice = _fetchEthPrice();
    _fetchCvpPrice(ethPrice);
    uint256 overdueCount = 0;
    (uint256 minReportInterval, uint256 maxReportInterval) = _getMinMaxReportInterval();

    for (uint256 i = 0; i < len; i++) {
      if (
        _fetchAndSavePrice(symbols_[i], ethPrice, minReportInterval, maxReportInterval) ==
        ReportInterval.GREATER_THAN_MAX
      ) {
        overdueCount++;
      }
    }

    emit PokeFromSlasher(slasherId_, len, overdueCount);

    if (overdueCount > 0) {
      powerPoke.slashReporter(slasherId_, overdueCount);

      // update with no constraints
      _updateSlasherTimestamp(slasherId_, false);
    } else {
      // treat it as a slasherHeartbeat call
      _updateSlasherTimestamp(slasherId_, true);
    }
  }

  function slasherHeartbeat(uint256 slasherId_) external override whenNotPaused {
    uint256 gasStart = gasleft();
    powerPoke.authorizeNonReporter(slasherId_, msg.sender);

    _updateSlasherTimestamp(slasherId_, true);

    PowerPoke.PokeRewardOptions memory opts = PowerPoke.PokeRewardOptions(msg.sender, false);
    bytes memory rewardConfig = abi.encode(opts);
    // reward in CVP
    powerPoke.reward(slasherId_, gasStart.sub(gasleft()), 2, rewardConfig);
  }

  function _updateSlasherTimestamp(uint256 _slasherId, bool assertOnTimeDelta) internal {
    uint256 prevSlasherUpdate = lastSlasherUpdates[_slasherId];

    if (assertOnTimeDelta) {
      uint256 delta = block.timestamp.sub(prevSlasherUpdate);
      require(delta >= powerPoke.getSlasherHeartbeat(address(this)), "BELOW_HEARTBEAT_INTERVAL");
    }

    lastSlasherUpdates[_slasherId] = block.timestamp;
    emit UpdateSlasher(_slasherId, prevSlasherUpdate, block.timestamp);
  }

  /**
   * @notice Arbitrary user pokes symbols without being rewarded
   * @param symbols_ Asset symbols to poke
   */
  function poke(string[] memory symbols_) external override whenNotPaused {
    uint256 len = symbols_.length;
    require(len > 0, "MISSING_SYMBOLS");

    uint256 ethPrice = _fetchEthPrice();
    (uint256 minReportInterval, uint256 maxReportInterval) = _getMinMaxReportInterval();

    for (uint256 i = 0; i < len; i++) {
      _fetchAndSavePrice(symbols_[i], ethPrice, minReportInterval, maxReportInterval);
    }

    emit Poke(msg.sender, len);
  }

  /*** Owner Interface ***/

  /**
   * @notice The owner sets a new powerPoke contract
   * @param powerPoke_ The powerPoke contract address
   */
  function setPowerPoke(address powerPoke_) external override onlyOwner {
    powerPoke = PowerPoke(powerPoke_);
    emit SetPowerPoke(powerPoke_);
  }

  /**
   * @notice The owner pauses poke*-operations
   */
  function pause() external override onlyOwner {
    _pause();
  }

  /**
   * @notice The owner unpauses poke*-operations
   */
  function unpause() external override onlyOwner {
    _unpause();
  }

  /*** Viewers ***/

  function _getMinMaxReportInterval() internal view returns (uint256 min, uint256 max) {
    return powerPoke.getMinMaxReportIntervals(address(this));
  }

  function getIntervalStatus(bytes32 _symbolHash) public view returns (ReportInterval) {
    (uint256 minReportInterval, uint256 maxReportInterval) = _getMinMaxReportInterval();

    return getIntervalStatusForIntervals(_symbolHash, minReportInterval, maxReportInterval);
  }

  function getIntervalStatusForIntervals(
    bytes32 symbolHash_,
    uint256 minReportInterval_,
    uint256 maxReportInterval_
  ) public view returns (ReportInterval) {
    uint256 delta = block.timestamp.sub(prices[symbolHash_].timestamp);

    if (delta < minReportInterval_) {
      return ReportInterval.LESS_THAN_MIN;
    }

    if (delta < maxReportInterval_) {
      return ReportInterval.OK;
    }

    return ReportInterval.GREATER_THAN_MAX;
  }

  /**
   * @notice Get the underlying price of a token
   * @param token_ The token address for price retrieval
   * @return Price denominated in USD, with 6 decimals, for the given asset address
   */
  function getPriceByAsset(address token_) external view override returns (uint256) {
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
  function getUnderlyingPrice(address cToken_) external view override returns (uint256) {
    TokenConfig memory config = getTokenConfigByCToken(cToken_);
    // Comptroller needs prices in the format: ${raw price} * 1e(36 - baseUnit)
    // Since the prices in this view have 6 decimals, we must scale them by 1e(36 - 6 - baseUnit)
    return mul(1e30, priceInternal(config)) / config.baseUnit;
  }

  /**
   * @notice Get the price by underlying address
   * @dev Implements the old PriceOracle interface for Compound v2.
   * @param token_ The underlying address for price retrieval
   * @return Price denominated in USD, with 18 decimals, for the given underlying address
   */
  function assetPrices(address token_) external view override returns (uint256) {
    TokenConfig memory config = getTokenConfigByUnderlying(token_);
    // Return price in the same format as getUnderlyingPrice, but by token address
    return mul(1e30, priceInternal(config)) / config.baseUnit;
  }
}
