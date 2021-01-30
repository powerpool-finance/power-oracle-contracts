// SPDX-License-Identifier: MIT

pragma solidity ^0.6.12;

interface IEACAggregatorProxy {
  function latestAnswer() external view returns (int256);
}
