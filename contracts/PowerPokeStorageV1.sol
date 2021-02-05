// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;

pragma experimental ABIEncoderV2;

import "./interfaces/IPowerOracle.sol";

contract PowerPokeStorageV1 {
  struct Client {
    bool active;
    bool canSlash;
    bool allowPokerWithdrawingRewards;
    address owner;
    uint256 credit;
    uint256 minReportInterval;
    uint256 maxReportInterval;
    uint256 slasherHeartbeat;
    uint256 gasPriceLimit;
    uint256 defaultMinDeposit;
  }

  struct BonusPlan {
    bool active;
    uint64 bonusNumerator;
    uint64 bonusDenominator;
    uint64 perGas;
  }

  IPowerOracle public oracle;

  uint256 public totalCredits;

  mapping(uint256 => uint256) public rewards;

  mapping(uint256 => bool) public pokerKeyRewardWithdrawAllowance;

  mapping(address => Client) public clients;

  mapping(address => mapping(uint256 => BonusPlan)) public bonusPlans;
}
