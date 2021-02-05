// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "../PowerPoke.sol";

contract MockPoke is PowerPoke {
  constructor(
    address cvpToken_,
    address wethToken_,
    address fastGasOracle_,
    address uniswapRouter_,
    address powerPokeStaking_
  ) public PowerPoke(cvpToken_, wethToken_, fastGasOracle_, uniswapRouter_, powerPokeStaking_) {}

  function mockSetReward(uint256 userId_, uint256 amount_) external {
    rewards[userId_] = amount_;
  }
}
