// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;

contract MockUniswapRouter {
  address public immutable factory;
  address public immutable WETH;

  modifier ensure(uint256 deadline) {
    require(deadline >= block.timestamp, "UniswapV2Router: EXPIRED");
    _;
  }

  constructor(address _factory, address _WETH) public {
    factory = _factory;
    WETH = _WETH;
  }

  function swapExactTokensForETH(
    uint256 amountIn,
    uint256,
    address[] calldata,
    address payable to,
    uint256 deadline
  ) external ensure(deadline) returns (uint256[] memory amounts) {
    uint256 amount = (amountIn * 3) / 1600;
    to.transfer((amountIn * 3) / 1600);
    amounts = new uint256[](2);
    amounts[1] = amount;
    return amounts;
  }

  receive() external payable {}
}
