// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface BPoolInterface {
  function getBalance(address) external view returns (uint256);

  function totalSupply() external view returns (uint256);

  function getCurrentTokens() external view returns (address[] memory tokens);
}
