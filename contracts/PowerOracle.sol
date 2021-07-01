// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/upgrades-core/contracts/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "./interfaces/IPowerOracleV3.sol";
import "./interfaces/IPowerPoke.sol";
import "./UniswapTWAPProvider.sol";
import "./utils/PowerPausable.sol";
import "./utils/PowerOwnable.sol";
import "./PowerPoke.sol";
import "./PowerOracleTokenManagement.sol";

contract PowerOracle is
  IPowerOracle,
  PowerOwnable,
  Initializable,
  PowerPausable,
  PowerOracleTokenManagement,
  UniswapTWAPProvider
{
  using SafeMath for uint256;
  using SafeCast for uint256;

  uint256 public constant POWER_ORACLE_VERSION = 3;

  uint256 internal constant COMPENSATION_PLAN_1_ID = 1;
  uint256 internal constant COMPENSATION_PLAN_2_ID = 2;
  uint256 public constant HUNDRED_PCT = 100 ether;

  /// @notice The event emitted when a reporter calls a poke operation
  event PokeFromReporter(uint256 indexed reporterId, uint256 tokenCount);

  /// @notice The event emitted when a slasher executes poke and slashes the current reporter
  event PokeFromSlasher(uint256 indexed slasherId, uint256 tokenCount);

  /// @notice The event emitted when an arbitrary user calls poke operation
  event Poke(address indexed poker, uint256 tokenCount);

  /// @notice The event emitted when the owner updates the powerOracleStaking address
  event SetPowerPoke(address powerPoke);

  /// @notice The event emitted when the slasher timestamps are updated
  event SlasherHeartbeat(uint256 indexed slasherId, uint256 prevSlasherTimestamp, uint256 newSlasherTimestamp);

  /// @notice CVP token address
  IERC20 public immutable CVP_TOKEN;

  modifier onlyReporter(uint256 reporterId_, bytes calldata rewardOpts) {
    uint256 gasStart = gasleft();
    powerPoke.authorizeReporter(reporterId_, msg.sender);
    _;
    powerPoke.reward(reporterId_, gasStart.sub(gasleft()), COMPENSATION_PLAN_1_ID, rewardOpts);
  }

  modifier onlySlasher(uint256 slasherId_, bytes calldata rewardOpts) {
    uint256 gasStart = gasleft();
    powerPoke.authorizeNonReporter(slasherId_, msg.sender);
    _;
    powerPoke.reward(slasherId_, gasStart.sub(gasleft()), COMPENSATION_PLAN_1_ID, rewardOpts);
  }

  modifier onlyEOA() {
    require(msg.sender == tx.origin, "CONTRACT_CALL");
    _;
  }

  constructor(address cvpToken_, uint256 anchorPeriod_) public UniswapTWAPProvider(anchorPeriod_) {
    CVP_TOKEN = IERC20(cvpToken_);
  }

  function initialize(address owner_, address powerPoke_) external initializer {
    _transferOwnership(owner_);
    powerPoke = IPowerPoke(powerPoke_);
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
    address token = tokenBySymbol[symbol_];
    TokenConfig memory basicConfig = getActiveTokenConfig(token);
    TokenConfigUpdate memory updateConfig = getTokenUpdateConfig(token);

    require(basicConfig.priceSource == PRICE_SOURCE_REPORTER, "NOT_REPORTED_PRICE_SOURCE");
    bytes32 symbolHash = keccak256(abi.encodePacked(symbol_));

    ReportInterval intervalStatus = getIntervalStatusForIntervals(symbolHash, minReportInterval_, maxReportInterval_);
    if (intervalStatus == ReportInterval.LESS_THAN_MIN) {
      return intervalStatus;
    }

    uint256 price;
    if (symbolHash == ethHash) {
      price = ethPrice_;
    } else {
      price = fetchAnchorPrice(symbol_, basicConfig, updateConfig, ethPrice_);
    }

    _savePrice(symbolHash, price);

    return intervalStatus;
  }

  function _savePrice(bytes32 _symbolHash, uint256 price_) internal {
    prices[_symbolHash] = Price(block.timestamp.toUint128(), price_.toUint128());
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
    bytes calldata rewardOpts_
  ) external override onlyReporter(reporterId_, rewardOpts_) onlyEOA whenNotPaused {
    uint256 len = symbols_.length;
    require(len > 0, "MISSING_SYMBOLS");

    uint256 ethPrice = _fetchEthPrice();
    _fetchCvpPrice(ethPrice);

    (uint256 minReportInterval, uint256 maxReportInterval) = _getMinMaxReportInterval();

    for (uint256 i = 0; i < len; i++) {
      require(
        _fetchAndSavePrice(symbols_[i], ethPrice, minReportInterval, maxReportInterval) != ReportInterval.LESS_THAN_MIN,
        "TOO_EARLY_UPDATE"
      );
    }

    emit PokeFromReporter(reporterId_, len);
  }

  /**
   * @notice A slasher pokes symbols with incentive to be rewarded
   * @param slasherId_ The slasher's user ID
   * @param symbols_ Asset symbols to poke
   */
  function pokeFromSlasher(
    uint256 slasherId_,
    string[] memory symbols_,
    bytes calldata rewardOpts_
  ) external override onlySlasher(slasherId_, rewardOpts_) onlyEOA whenNotPaused {
    uint256 len = symbols_.length;
    require(len > 0, "MISSING_SYMBOLS");

    uint256 ethPrice = _fetchEthPrice();
    _fetchCvpPrice(ethPrice);

    (uint256 minReportInterval, uint256 maxReportInterval) = _getMinMaxReportInterval();

    for (uint256 i = 0; i < len; i++) {
      require(
        _fetchAndSavePrice(symbols_[i], ethPrice, minReportInterval, maxReportInterval) ==
          ReportInterval.GREATER_THAN_MAX,
        "INTERVAL_IS_OK"
      );
    }

    _updateSlasherTimestamp(slasherId_, false);
    powerPoke.slashReporter(slasherId_, len);

    emit PokeFromSlasher(slasherId_, len);
  }

  function slasherHeartbeat(uint256 slasherId_) external override whenNotPaused onlyEOA {
    uint256 gasStart = gasleft();
    powerPoke.authorizeNonReporter(slasherId_, msg.sender);

    _updateSlasherTimestamp(slasherId_, true);

    PowerPoke.PokeRewardOptions memory opts = PowerPoke.PokeRewardOptions(msg.sender, false);
    bytes memory rewardConfig = abi.encode(opts);
    // reward in CVP
    powerPoke.reward(slasherId_, gasStart.sub(gasleft()), COMPENSATION_PLAN_2_ID, rewardConfig);
  }

  function _updateSlasherTimestamp(uint256 _slasherId, bool assertOnTimeDelta) internal {
    uint256 prevSlasherUpdate = lastSlasherUpdates[_slasherId];

    if (assertOnTimeDelta) {
      uint256 delta = block.timestamp.sub(prevSlasherUpdate);
      require(delta >= powerPoke.getSlasherHeartbeat(address(this)), "BELOW_HEARTBEAT_INTERVAL");
    }

    lastSlasherUpdates[_slasherId] = block.timestamp;
    emit SlasherHeartbeat(_slasherId, prevSlasherUpdate, block.timestamp);
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

    require(minReportInterval > 0 && maxReportInterval > 0, "0_INTERVAL");

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
}
