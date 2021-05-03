// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./interfaces/IPowerPoke.sol";

contract PowerOracleStorageV1 {
  struct Price {
    uint128 timestamp;
    uint128 value;
  }

  struct Observation {
    uint256 timestamp;
    uint256 acc;
  }

  struct TokenConfig {
    // Slot #1
    uint96 baseUnit;
    uint96 fixedPrice;
    uint8 priceSource;
    uint8 active;
    // Slot #2
    bytes32 symbolHash;
  }

  struct TokenConfigUpdate {
    address uniswapMarket;
    bool isUniswapReversed;
  }

  /// @notice The linked PowerOracleStaking contract address
  IPowerPoke public powerPoke;

  /// @notice Official reported prices and timestamps by symbol hash
  mapping(bytes32 => Price) public prices;

  /// @notice Last slasher update time by a user ID
  mapping(uint256 => uint256) public lastSlasherUpdates;

  /// @notice The old observation for each symbolHash
  mapping(bytes32 => Observation) public oldObservations;

  /// @notice The new observation for each symbolHash
  mapping(bytes32 => Observation) public newObservations;

  address[] public tokens;

  mapping(string => address) public tokenBySymbol;
  mapping(bytes32 => address) public tokenBySymbolHash;

  // token => TokenConfig, push-only
  mapping(address => TokenConfig) internal tokenConfigs;

  // token => TokenUpdateConfig, push-only
  mapping(address => TokenConfigUpdate) internal tokenUpdateConfigs;
}
