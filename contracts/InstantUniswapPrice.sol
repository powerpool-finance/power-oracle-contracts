// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./Uniswap/UniswapV2Library.sol";
import "./interfaces/IUniswapV2Pair.sol";
import "./interfaces/IUniswapV2Factory.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract InstantUniswapPrice {
  using SafeMath for uint256;

  address public constant WETH_TOKEN = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
  address public constant USDC_MARKET = 0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc;
  address public constant UNISWAP_FACTORY = 0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f;

  function currentEthPriceInUsdc() public view returns (uint) {
    return currentTokenPrice(USDC_MARKET, WETH_TOKEN);
  }

  function currentTokenUsdcPrice(address token) public view returns (uint price) {
    uint256 ethPriceInUsdc = currentEthPriceInUsdc();
    uint256 tokenEthPrice = currentTokenEthPrice(token);
    return tokenEthPrice.mul(ethPriceInUsdc).div(1 ether);
  }

  function currentTokenEthPrice(address token) public view returns (uint price) {
    address market = IUniswapV2Factory(UNISWAP_FACTORY).getPair(token, WETH_TOKEN);
    if (market == address(0)) {
      market = IUniswapV2Factory(UNISWAP_FACTORY).getPair(WETH_TOKEN, token);
      return currentTokenPrice(market, token);
    } else {
      return currentTokenPrice(market, token);
    }
  }

  function currentTokenPrice(address uniswapMarket, address token) public view returns (uint price) {
    (uint112 reserve0, uint112 reserve1, ) = IUniswapV2Pair(uniswapMarket).getReserves();
    address token0 = IUniswapV2Pair(uniswapMarket).token0();
    address token1 = IUniswapV2Pair(uniswapMarket).token1();

    uint8 decimals;
    try ERC20(token == token0 ? token1 : token0).decimals() returns (uint8 _decimals) {
      decimals = _decimals;
    } catch (bytes memory /*lowLevelData*/) {
      decimals = uint8(18);
    }

    price = UniswapV2Library.getAmountOut(
      1 ether,
      token == token0 ? reserve0 : reserve1,
      token == token0 ? reserve1 : reserve0
    );

    if (decimals != 18) {
      price = price.mul(10 ** uint256((uint8(18) - decimals)));
    }
  }
}
