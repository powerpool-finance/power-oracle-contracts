// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./interfaces/IPowerOracleStaking.sol";

contract PowerOracleStorageV1 {
  /// @dev Describe how to interpret the fixedPrice in the TokenConfig.
  enum PriceSource {
    FIXED_ETH, /// implies the fixedPrice is a constant multiple of the ETH price (which varies)
    FIXED_USD, /// implies the fixedPrice is a constant multiple of the USD price (which is 1)
    REPORTER   /// implies the price is set by the reporter
  }

  struct ExchangePair {
    address pair;
    bool isReversed;
  }

  struct TokenConfigMinimal {
    address token;
    bytes32 symbolHash;
    uint256 baseUnit;
    PriceSource priceSource;
    uint256 fixedPrice;
  }

  /// @dev Describe how the USD price should be determined for an asset.
  ///  There should be 1 TokenConfig object for each supported asset, passed in the constructor.
  struct TokenConfig {
    address cToken;
    address token;
    bytes32 symbolHash;
    uint256 baseUnit;
    PriceSource priceSource;
    uint256 fixedPrice;
    string symbol;
//    mapping(address => TradingPair) pairDetails;
    address[] exchanges;
  }

  struct Observation {
    uint timestamp;
    uint price0Cumulative;
    uint price1Cumulative;
  }

  /// @notice The linked PowerOracleStaking contract address
  IPowerOracleStaking public powerOracleStaking;

  /// @notice Min report interval in seconds
  uint256 public minReportInterval;

  /// @notice Max report interval in seconds
  uint256 public maxReportInterval;

  /// @notice The planned yield from a deposit in CVP tokens
  uint256 public cvpReportAPY;

  /// @notice The total number of reports for all pairs per year
  uint256 public totalReportsPerYear;

  /// @notice The current estimated gas expenses for reporting a single asset
  uint256 public gasExpensesPerAssetReport;

  /// @notice The maximum gas price to be used with gas compensation formula
  uint256 public gasPriceLimit;

  address[] public tokens;

  /// @notice The accrued reward by a user ID
  mapping(uint256 => uint256) public rewards;

  /// @notice Official prices and timestamps by symbol hash
  mapping(bytes32 => mapping(address => uint256)) public prices;

  mapping(bytes32 => uint256) public priceUpdates;

  /// @notice Last slasher update time by a user ID
  mapping(uint256 => uint256) public lastSlasherUpdates;

  /// @notice The current estimated gas expenses for updating a slasher status
  uint256 public gasExpensesForSlasherStatusUpdate;

  /// @notice The planned yield from a deposit in CVP tokens
  uint256 public cvpSlasherUpdateAPY;

  /// @notice The total number of slashers update per year
  uint256 public totalSlasherUpdatesPerYear;

  /// @notice The current estimated gas expenses for updating a slasher status by pokeFromSlasher
  uint256 public gasExpensesForSlasherPokeStatusUpdate;

  mapping(address => bool) public validFactories;
  // token => (exchangeFactory => pair)
  mapping(address => mapping(address => ExchangePair)) public tokenExchangeDetails;

  mapping(address => address) public tokenByCToken;
  mapping(string => address) public tokenBySymbol;
  mapping(bytes32 => address) public tokenBySymbolHash;

  // token => TokenConfig, push-only
  mapping(address => TokenConfig) internal tokenConfigs;

  mapping(address => mapping(address=> Observation[])) public observations;
}
