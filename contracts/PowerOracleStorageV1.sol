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
    uint timestamp;
    uint acc;
  }

  /// @notice The linked PowerOracleStaking contract address
  IPowerPoke public powerPoke;

  /// @notice Official prices and timestamps by symbol hash
  mapping(bytes32 => Price) public prices;

  /// @notice Last slasher update time by a user ID
  mapping(uint256 => uint256) public lastSlasherUpdates;

  /// @notice The old observation for each symbolHash
  mapping(bytes32 => Observation) public oldObservations;

  /// @notice The new observation for each symbolHash
  mapping(bytes32 => Observation) public newObservations;

  // Reserved storage space to allow for layout changes in the future.
  uint256[50] private ______gap;
}
