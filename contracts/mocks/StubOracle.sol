// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "../PowerOracle.sol";

contract StubOracle is PowerOracle {
  constructor(address cvpToken_, uint256 anchorPeriod_) public PowerOracle(cvpToken_, anchorPeriod_) {}

  function stubSetPrice(bytes32 symbolHash_, uint128 value_) external {
    prices[symbolHash_] = Price(uint128(block.timestamp), value_);
  }
}
