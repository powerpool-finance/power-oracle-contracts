// SPDX-License-Identifier: MIT

pragma solidity ^0.6.12;

contract MockFastGasOracle {
  uint256 public latestAnswer;

  constructor(uint256 latestAnswer_) public {
    latestAnswer = latestAnswer_;
  }

  function setLatestAnswer(uint256 latestAnswer_) external {
    latestAnswer = latestAnswer_;
  }
}
