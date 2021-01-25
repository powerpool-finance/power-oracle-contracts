// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/upgrades-core/contracts/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "./interfaces/IPowerOracle.sol";
import "./interfaces/IPowerOracleStaking.sol";
import "./UniswapTWAPProvider.sol";
import "./utils/Pausable.sol";
import "./utils/Ownable.sol";

contract PowerOracle is IPowerOracle, Ownable, Initializable, Pausable, UniswapTWAPProvider {
  using SafeMath for uint256;
  using SafeCast for uint256;

  uint256 public constant HUNDRED_PCT = 100 ether;

  /// @notice The event emitted when a reporter calls a poke operation
  event PokeFromReporter(uint256 indexed reporterId, uint256 tokenCount, uint256 rewardCount);

  /// @notice The event emitted when a slasher executes poke and slashes the current reporter
  event PokeFromSlasher(uint256 indexed slasherId, uint256 tokenCount, uint256 overdueCount);

  /// @notice The event emitted when an arbitrary user calls poke operation
  event Poke(address indexed poker, uint256 tokenCount);

  /// @notice The event emitted when a reporter receives their reward for the report
  event RewardUserReport(
    uint256 indexed userId,
    uint256 count,
    uint256 deposit,
    uint256 ethPrice,
    uint256 cvpPrice,
    uint256 calculatedReward
  );

  /// @notice The event emitted when a reporter is not eligible for a reward or rewards are disabled
  event RewardIgnored(
    uint256 indexed userId,
    uint256 count,
    uint256 deposit,
    uint256 ethPrice,
    uint256 cvpPrice,
    uint256 calculatedReward
  );

  /// @notice The event emitted when a slasher receives their reward for the update
  event RewardUserSlasherUpdate(
    uint256 indexed slasherId,
    uint256 deposit,
    uint256 ethPrice,
    uint256 cvpPrice,
    uint256 calculatedReward
  );

  /// @notice The event emitted when a slasher receives their reward for the update
  event RewardUserSlasherUpdateIgnored(
    uint256 indexed slasherId,
    uint256 deposit,
    uint256 ethPrice,
    uint256 cvpPrice,
    uint256 calculatedReward
  );

  /// @notice The event emitted when the slasher timestamps are updated
  event UpdateSlasher(uint256 indexed slasherId, uint256 prevSlasherTimestamp, uint256 newSlasherTimestamp);

  /// @notice The event emitted when a reporter is missing pending tokens to update price for
  event NothingToReward(uint256 indexed userId, uint256 ethPrice);

  /// @notice The event emitted when the owner updates the cvpReportAPY value
  event SetCvpApy(uint256 cvpReportAPY, uint256 cvpSlasherUpdateAPY);

  /// @notice The event emitted when the owner updates min/max report intervals
  event SetReportIntervals(uint256 minReportInterval, uint256 maxReportInterval);

  /// @notice The event emitted when the owner updates the totalReportsPerYear value
  event SetTotalReportsPerYear(uint256 totalReportsPerYear, uint256 totalSlasherUpdatePerYear);

  /// @notice The event emitted when the owner updates the powerOracleStaking address
  event SetPowerOracleStaking(address powerOracleStaking);

  /// @notice The event emitted when the owner updates the gasExpensesPerAssetReport value
  event SetGasExpenses(
    uint256 gasExpensesPerAssetReport,
    uint256 gasExpensesForSlasherStatusUpdate,
    uint256 gasExpensesForSlasherPokeStatusUpdate
  );

  /// @notice The event emitted when the owner updates the gasPriceLimit value
  event SetGasPriceLimit(uint256 gasPriceLimit);

  /// @notice The event emitted when an admin withdraw his reward
  event WithdrawRewards(uint256 indexed userId, address indexed to, uint256 amount);

  /// @notice CVP token address
  IERC20 public immutable cvpToken;

  /// @notice CVP reservoir which should pre-approve some amount of tokens to this contract in order to let pay rewards
  address public immutable reservoir;

  modifier denyContracts() {
    require(msg.sender == tx.origin, 'CONTRACT_CALLS_DENIED');
    _;
  }

  constructor(
    address cvpToken_,
    address reservoir_,
    address uniswapFactory_,
    uint256 anchorPeriod_
  ) public UniswapTWAPProvider(anchorPeriod_) TokenDetails(uniswapFactory_) {
    cvpToken = IERC20(cvpToken_);
    reservoir = reservoir_;
  }

  function initialize(
    address owner_,
    address powerOracleStaking_,
    uint256 cvpReportAPY_,
    uint256 cvpSlasherUpdateAPY_,
    uint256 totalReportsPerYear_,
    uint256 totalSlasherUpdatesPerYear_,
    uint256 gasExpensesPerAssetReport_,
    uint256 gasExpensesForSlasherStatusUpdate_,
    uint256 gasExpensesForSlasherPokeStatusUpdate_,
    uint256 gasPriceLimit_,
    uint256 minReportInterval_,
    uint256 maxReportInterval_
  ) external initializer {
    _transferOwnership(owner_);
    powerOracleStaking = IPowerOracleStaking(powerOracleStaking_);
    cvpReportAPY = cvpReportAPY_;
    cvpSlasherUpdateAPY = cvpSlasherUpdateAPY_;
    totalReportsPerYear = totalReportsPerYear_;
    totalSlasherUpdatesPerYear = totalSlasherUpdatesPerYear_;
    gasExpensesPerAssetReport = gasExpensesPerAssetReport_;
    gasExpensesForSlasherStatusUpdate = gasExpensesForSlasherStatusUpdate_;
    gasExpensesForSlasherPokeStatusUpdate = gasExpensesForSlasherPokeStatusUpdate_;
    gasPriceLimit = gasPriceLimit_;
    minReportInterval = minReportInterval_;
    maxReportInterval = maxReportInterval_;
  }

  /*** Current Poke Interface ***/

  function _fetchEthPrice() internal returns (uint256) {
    bytes32 symbolHash = keccak256(abi.encodePacked("ETH"));
    if (getIntervalStatus(symbolHash) == ReportInterval.LESS_THAN_MIN) {
      return uint256(prices[symbolHash][UNISWAP_FACTORY]);
    }
    uint256 ethPrice = fetchEthPrice();
    _savePrice(symbolHash, UNISWAP_FACTORY, ethPrice);
    return ethPrice;
  }

  function _fetchCvpPrice(uint256 ethPrice_) internal returns (uint256) {
    bytes32 symbolHash = keccak256(abi.encodePacked("CVP"));
    if (getIntervalStatus(symbolHash) == ReportInterval.LESS_THAN_MIN) {
      return uint256(prices[symbolHash][UNISWAP_FACTORY]);
    }
    uint256 cvpPrice = fetchCvpPrice(ethPrice_);
    _savePrice(symbolHash, UNISWAP_FACTORY, cvpPrice);
    return cvpPrice;
  }

  function _fetchAndSavePrice(string memory symbol_, uint256 ethPrice_) internal returns (ReportInterval) {
    TokenConfig memory config = getTokenConfigBySymbol(symbol_);
    require(config.priceSource == PriceSource.REPORTER, "NOT_REPORTER");
    bytes32 symbolHash = keccak256(abi.encodePacked(symbol_));

    ReportInterval intervalStatus = getIntervalStatus(symbolHash);
    if (intervalStatus == ReportInterval.LESS_THAN_MIN) {
      return intervalStatus;
    }

    uint256 factoriesLen = config.exchanges.length;
    for (uint256 i = 0; i < factoriesLen; i++) {
      address factory = config.exchanges[i];
      uint256 price;

      if (symbolHash == ethHash) {
        price = ethPrice_;
      } else {
        price = fetchAnchorPrice(symbol_, factory, config, ethPrice_);
      }

      _savePrice(symbolHash, factory, price);
    }

    return intervalStatus;
  }

  function _savePrice(bytes32 _symbolHash, address factory_, uint256 price_) internal {
//    prices[_symbolHash][factory_] = Price(block.timestamp.toUint128(), price_.toUint128());
    prices[_symbolHash][factory_] = price_;
    priceUpdates[_symbolHash] = block.timestamp;
  }

  function priceInternal(address factory_, TokenConfig memory config_) internal view returns (uint256) {
    if (config_.priceSource == PriceSource.REPORTER) return prices[config_.symbolHash][factory_];
    if (config_.priceSource == PriceSource.FIXED_USD) return config_.fixedPrice;
    if (config_.priceSource == PriceSource.FIXED_ETH) {
      uint256 usdPerEth = prices[ethHash][factory_];
      require(usdPerEth > 0, "ETH_PRICE_NOT_SET");
      return mul(usdPerEth, config_.fixedPrice) / ETH_BASE_UNIT;
    }
    revert("UNSUPPORTED_PRICE_CASE");
  }

  function _rewardUser(
    uint256 userId_,
    uint256 count_,
    uint256 ethPrice_,
    uint256 cvpPrice_
  ) internal {
    if (count_ == 0) {
      emit NothingToReward(userId_, ethPrice_);
      return;
    }

    uint256 userDeposit = powerOracleStaking.getDepositOf(userId_);
    uint256 amount = calculateReportReward(count_, userDeposit, ethPrice_, cvpPrice_);

    if (amount > 0) {
      rewards[userId_] = rewards[userId_].add(amount);
      emit RewardUserReport(userId_, count_, userDeposit, ethPrice_, cvpPrice_, amount);
    } else {
      emit RewardIgnored(userId_, count_, userDeposit, ethPrice_, cvpPrice_, amount);
    }
  }

  function _rewardSlasherUpdate(
    uint256 userId_,
    uint256 ethPrice_,
    uint256 cvpPrice_,
    bool byPokeFunc_
  ) internal {
    uint256 userDeposit = powerOracleStaking.getDepositOf(userId_);
    uint256 amount;
    if (byPokeFunc_) {
      amount = calculateSlasherUpdateReward(userDeposit, ethPrice_, cvpPrice_, gasExpensesForSlasherPokeStatusUpdate);
    } else {
      amount = calculateSlasherUpdateReward(userDeposit, ethPrice_, cvpPrice_, gasExpensesForSlasherStatusUpdate);
    }

    if (amount > 0) {
      rewards[userId_] = rewards[userId_].add(amount);
      emit RewardUserSlasherUpdate(userId_, userDeposit, ethPrice_, cvpPrice_, amount);
    } else {
      emit RewardUserSlasherUpdateIgnored(userId_, userDeposit, ethPrice_, cvpPrice_, amount);
    }
  }

  function _updateSlasherAndReward(
    uint256 _slasherId,
    uint256 _ethPrice,
    uint256 _cvpPrice,
    bool byPokeFunc_
  ) internal {
    _updateSlasherTimestamp(_slasherId, true);
    _rewardSlasherUpdate(_slasherId, _ethPrice, _cvpPrice, byPokeFunc_);
  }

  function _updateSlasherTimestamp(uint256 _slasherId, bool _rewardPaid) internal {
    uint256 prevSlasherUpdate = lastSlasherUpdates[_slasherId];
    uint256 delta = block.timestamp.sub(prevSlasherUpdate);

    uint256 lastDepositChange = powerOracleStaking.getLastDepositChange(_slasherId);
    uint256 depositChangeDelta = block.timestamp.sub(lastDepositChange);
    require(depositChangeDelta >= maxReportInterval, "PowerOracle::_updateSlasherAndReward: bellow depositChangeDelta");

    if (_rewardPaid) {
      require(delta >= maxReportInterval, "BELLOW_REPORT_INTERVAL");
    } else {
      require(delta >= maxReportInterval.sub(minReportInterval), "BELLOW_REPORT_INTERVAL_DIFF");
    }
    lastSlasherUpdates[_slasherId] = block.timestamp;
    emit UpdateSlasher(_slasherId, prevSlasherUpdate, lastSlasherUpdates[_slasherId]);
  }

  /*** Pokers ***/

  /**
   * @notice A reporter pokes symbols with incentive to be rewarded
   * @param reporterId_ The valid reporter's user ID
   * @param symbols_ Asset symbols to poke
   */
  function pokeFromReporter(uint256 reporterId_, string[] memory symbols_) external override whenNotPaused denyContracts {
    uint256 len = symbols_.length;
    require(len > 0, "MISSING_SYMBOLS");

    powerOracleStaking.authorizeReporter(reporterId_, msg.sender);

    uint256 ethPrice = _fetchEthPrice();
    uint256 cvpPrice = _fetchCvpPrice(ethPrice);
    uint256 rewardCount = 0;

    for (uint256 i = 0; i < len; i++) {
      if (_fetchAndSavePrice(symbols_[i], ethPrice) != ReportInterval.LESS_THAN_MIN) {
        rewardCount++;
      }
    }

    emit PokeFromReporter(reporterId_, len, rewardCount);
    _rewardUser(reporterId_, rewardCount, ethPrice, cvpPrice);
  }

  /**
   * @notice A slasher pokes symbols with incentive to be rewarded
   * @param slasherId_ The slasher's user ID
   * @param symbols_ Asset symbols to poke
   */
  function pokeFromSlasher(uint256 slasherId_, string[] memory symbols_) external override whenNotPaused denyContracts {
    uint256 len = symbols_.length;
    require(len > 0, "MISSING_SYMBOLS");

    powerOracleStaking.authorizeSlasher(slasherId_, msg.sender);

    uint256 ethPrice = _fetchEthPrice();
    uint256 cvpPrice = _fetchCvpPrice(ethPrice);
    uint256 overdueCount = 0;

    for (uint256 i = 0; i < len; i++) {
      if (_fetchAndSavePrice(symbols_[i], ethPrice) == ReportInterval.GREATER_THAN_MAX) {
        overdueCount++;
      }
    }

    emit PokeFromSlasher(slasherId_, len, overdueCount);

    if (overdueCount > 0) {
      powerOracleStaking.slash(slasherId_, overdueCount);
      _rewardUser(slasherId_, overdueCount, ethPrice, cvpPrice);
      _updateSlasherTimestamp(slasherId_, false);
    } else {
      _updateSlasherAndReward(slasherId_, ethPrice, cvpPrice, true);
    }
  }

  function slasherUpdate(uint256 slasherId_) external override whenNotPaused denyContracts {
    powerOracleStaking.authorizeSlasher(slasherId_, msg.sender);

    uint256 ethPrice = _fetchEthPrice();
    _updateSlasherAndReward(slasherId_, ethPrice, _fetchCvpPrice(ethPrice), false);
  }

  /**
   * @notice Arbitrary user pokes symbols without being rewarded
   * @param symbols_ Asset symbols to poke
   */
  function poke(string[] memory symbols_) external override whenNotPaused {
    uint256 len = symbols_.length;
    require(len > 0, "MISSING_SYMBOLS");

    uint256 ethPrice = _fetchEthPrice();

    for (uint256 i = 0; i < len; i++) {
      _fetchAndSavePrice(symbols_[i], ethPrice);
    }

    emit Poke(msg.sender, len);
  }

  /**
   * @notice Withdraw the available rewards
   * @param userId_ The user ID to withdraw the reward for
   * @param to_ The address to transfer the reward to
   */
  function withdrawRewards(uint256 userId_, address to_) external override {
    powerOracleStaking.requireValidAdminKey(userId_, msg.sender);
    require(to_ != address(0), "0_ADDRESS");
    uint256 rewardAmount = rewards[userId_];
    require(rewardAmount > 0, "NOTHING_TO_WITHDRAW");
    rewards[userId_] = 0;

    cvpToken.transferFrom(reservoir, to_, rewardAmount);

    emit WithdrawRewards(userId_, to_, rewardAmount);
  }

  /*** Owner Interface ***/

  /**
   * @notice Set the planned yield from a deposit in CVP tokens
   * @param cvpReportAPY_ The planned yield in % (1 ether == 1%)
   * @param cvpSlasherUpdateAPY_ The planned yield in % (1 ether == 1%)
   */
  function setCvpAPY(uint256 cvpReportAPY_, uint256 cvpSlasherUpdateAPY_) external override onlyOwner {
    cvpReportAPY = cvpReportAPY_;
    cvpSlasherUpdateAPY = cvpSlasherUpdateAPY_;
    emit SetCvpApy(cvpReportAPY_, cvpSlasherUpdateAPY_);
  }

  /**
   * @notice Set the total number of reports for all pairs per year
   * @param totalReportsPerYear_ The total number of reports
   * @param totalSlasherUpdatesPerYear_ The total number of slasher updates
   */
  function setTotalPerYear(uint256 totalReportsPerYear_, uint256 totalSlasherUpdatesPerYear_)
    external
    override
    onlyOwner
  {
    totalReportsPerYear = totalReportsPerYear_;
    totalSlasherUpdatesPerYear = totalSlasherUpdatesPerYear_;
    emit SetTotalReportsPerYear(totalReportsPerYear_, totalSlasherUpdatesPerYear_);
  }

  /**
   * @notice Set the current estimated gas expenses
   * @param gasExpensesPerAssetReport_ The gas amount for reporting a single asset
   * @param gasExpensesForSlasherStatusUpdate_ The gas amount for updating slasher status
   */
  function setGasExpenses(
    uint256 gasExpensesPerAssetReport_,
    uint256 gasExpensesForSlasherStatusUpdate_,
    uint256 gasExpensesForSlasherPokeStatusUpdate_
  ) external override onlyOwner {
    gasExpensesPerAssetReport = gasExpensesPerAssetReport_;
    gasExpensesForSlasherStatusUpdate = gasExpensesForSlasherStatusUpdate_;
    gasExpensesForSlasherPokeStatusUpdate = gasExpensesForSlasherPokeStatusUpdate_;
    emit SetGasExpenses(
      gasExpensesPerAssetReport_,
      gasExpensesForSlasherStatusUpdate_,
      gasExpensesForSlasherPokeStatusUpdate_
    );
  }

  /**
   * @notice Set the current estimated gas expenses for reporting a single asset
   * @param gasPriceLimit_ The gas amount
   */
  function setGasPriceLimit(uint256 gasPriceLimit_) external override onlyOwner {
    gasPriceLimit = gasPriceLimit_;
    emit SetGasPriceLimit(gasPriceLimit_);
  }

  /**
   * @notice The owner sets the current report min/max in seconds
   * @param minReportInterval_ The minimum report interval for the reporter
   * @param maxReportInterval_ The maximum report interval for the reporter
   */
  function setReportIntervals(uint256 minReportInterval_, uint256 maxReportInterval_) external override onlyOwner {
    minReportInterval = minReportInterval_;
    maxReportInterval = maxReportInterval_;
    emit SetReportIntervals(minReportInterval_, maxReportInterval_);
  }

  /**
   * @notice The owner sets a new powerOracleStaking contract
   * @param powerOracleStaking_ The poserOracleStaking contract address
   */
  function setPowerOracleStaking(address powerOracleStaking_) external override onlyOwner {
    powerOracleStaking = IPowerOracleStaking(powerOracleStaking_);
    emit SetPowerOracleStaking(powerOracleStaking_);
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

  function calculateReportReward(
    uint256 count_,
    uint256 deposit_,
    uint256 ethPrice_,
    uint256 cvpPrice_
  ) public view returns (uint256) {
    if (count_ == 0) {
      return 0;
    }

    return
      count_.mul(
        calculateReporterFixedReward(deposit_).add(
          calculateGasCompensation(ethPrice_, cvpPrice_, gasExpensesPerAssetReport)
        )
      );
  }

  function calculateReporterFixedReward(uint256 deposit_) public view returns (uint256) {
    require(cvpReportAPY > 0, "APY_IS_NULL");
    require(totalReportsPerYear > 0, "TOTAL_REPORTS_PER_YEAR_IS_NULL");
    // return cvpReportAPY * deposit_ / totalReportsPerYear / HUNDRED_PCT;
    return cvpReportAPY.mul(deposit_) / totalReportsPerYear / HUNDRED_PCT;
  }

  function calculateGasCompensation(
    uint256 ethPrice_,
    uint256 cvpPrice_,
    uint256 gasExpenses_
  ) public view returns (uint256) {
    require(ethPrice_ > 0, "ETH_PRICE_IS_NULL");
    require(cvpPrice_ > 0, "CVP_PRICE_IS_NULL");
    require(gasExpenses_ > 0, "GAS_EXPENSES_IS_NULL");

    // return _min(tx.gasprice, gasPriceLimit) * gasExpensesPerAssetReport * ethPrice_ / cvpPrice_;
    return _min(tx.gasprice, gasPriceLimit).mul(gasExpenses_).mul(ethPrice_) / cvpPrice_;
  }

  function calculateSlasherUpdateReward(
    uint256 deposit_,
    uint256 ethPrice_,
    uint256 cvpPrice_,
    uint256 gasExpenses_
  ) public view returns (uint256) {
    return calculateSlasherFixedReward(deposit_).add(calculateGasCompensation(ethPrice_, cvpPrice_, gasExpenses_));
  }

  function calculateSlasherFixedReward(uint256 deposit_) public view returns (uint256) {
    require(cvpSlasherUpdateAPY > 0, "APY_IS_NULL");
    require(totalSlasherUpdatesPerYear > 0, "UPDATES_PER_YEAR_IS_NULL");
    return cvpSlasherUpdateAPY.mul(deposit_) / totalSlasherUpdatesPerYear / HUNDRED_PCT;
  }

  function getIntervalStatus(bytes32 _symbolHash) public view returns (ReportInterval) {
//    uint256 delta = block.timestamp.sub(prices[_symbolHash].timestamp);
    uint256 delta = block.timestamp.sub(priceUpdates[_symbolHash]);

    if (delta < minReportInterval) {
      return ReportInterval.LESS_THAN_MIN;
    }

    if (delta < maxReportInterval) {
      return ReportInterval.OK;
    }

    return ReportInterval.GREATER_THAN_MAX;
  }

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
    return mul(1e30, priceInternal(factory_, config)) / config.baseUnit;
  }

  function _min(uint256 a, uint256 b) internal pure returns (uint256) {
    return a < b ? a : b;
  }
}
