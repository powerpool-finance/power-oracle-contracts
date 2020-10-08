// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;

interface IERC20 {
  function transfer(address to, uint amount) external;

  function transferFrom(address from, address to, uint amount) external;

  function allowance(address account, address spender) external view returns (uint);

  function balanceOf(address account) external view returns (uint);
}
