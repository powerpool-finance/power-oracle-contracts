// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "../PowerOracle.sol";


contract MockOracle is PowerOracle {
  constructor(
    address cvpToken_,
    address reservoir_,
    uint256 anchorPeriod_,
    TokenConfig[] memory configs_
  ) public PowerOracle(cvpToken_, reservoir_, anchorPeriod_, configs_) {
  }

  function mockSetUserReward(uint256 userId_, uint256 reward_) external {
    rewards[userId_] = reward_;
  }

  function mockSetPrice(bytes32 symbolHash_, uint128 value_) external {
    prices[symbolHash_] = Price(uint128(block.timestamp), value_);
  }

  event MockRewardAddress(address to, uint256 count);
  function rewardAddress(address to_, uint256 count_) external override(PowerOracle) {
    emit MockRewardAddress(to_, count_);
  }
}
