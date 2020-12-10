// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "./Uniswap/UniswapV2Library.sol";
import "./interfaces/IUniswapV2Pair.sol";
import "./interfaces/IUniswapV2Factory.sol";
import "./interfaces/BPoolInterface.sol";
import "./interfaces/IERC20Detailed.sol";

contract InstantUniswapPrice {
  using SafeMath for uint256;

  address public constant WETH_TOKEN = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
  address public constant USDC_MARKET = 0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc;
  address public constant UNISWAP_FACTORY = 0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f;

  function contractUsdTokensSum(address _contract, address[] memory _tokens) public view returns (uint) {
    uint256[] memory balances = getContractTokensBalanceOfArray(_contract, _tokens);
    return usdcTokensSum(_tokens, balances);
  }

  function contractEthTokensSum(address _contract, address[] memory _tokens) public view returns (uint) {
    uint256[] memory balances = getContractTokensBalanceOfArray(_contract, _tokens);
    return ethTokensSum(_tokens, balances);
  }

  function balancerPoolUsdTokensSum(address _balancerPool) public view returns (uint) {
    (address[] memory tokens, uint256[] memory balances) = getBalancerTokensAndBalances(_balancerPool);
    return usdcTokensSum(tokens, balances);
  }

  function balancerPoolEthTokensSum(address _balancerPool) public view returns (uint) {
    (address[] memory tokens, uint256[] memory balances) = getBalancerTokensAndBalances(_balancerPool);
    return ethTokensSum(tokens, balances);
  }

  function usdcTokensSum(address[] memory _tokens, uint256[] memory _balances) public view returns (uint) {
    uint256 ethTokensSumAmount = ethTokensSum(_tokens, _balances);
    uint256 ethPriceInUsdc = currentEthPriceInUsdc();
    return ethTokensSumAmount.mul(ethPriceInUsdc).div(1 ether);
  }

  function ethTokensSum(address[] memory _tokens, uint256[] memory _balances) public view returns (uint) {
    uint256 len = _tokens.length;
    require(len == _balances.length, "LENGTHS_NOT_EQUAL");

    uint256 sum = 0;
    for (uint256 i = 0; i < len; i++) {
      _balances[i] = amountToEther(_balances[i], getTokenDecimals(_tokens[i]));
      sum = sum.add(currentTokenEthPrice(_tokens[i]).mul(_balances[i]).div(1 ether));
    }
    return sum;
  }

  function currentEthPriceInUsdc() public view returns (uint) {
    return currentTokenPrice(USDC_MARKET, WETH_TOKEN);
  }

  function currentTokenUsdcPrice(address _token) public view returns (uint price) {
    uint256 ethPriceInUsdc = currentEthPriceInUsdc();
    uint256 tokenEthPrice = currentTokenEthPrice(_token);
    return tokenEthPrice.mul(ethPriceInUsdc).div(1 ether);
  }

  function currentTokenEthPrice(address _token) public view returns (uint price) {
    if (_token == WETH_TOKEN) {
      return uint(1 ether);
    }
    address market = IUniswapV2Factory(UNISWAP_FACTORY).getPair(_token, WETH_TOKEN);
    if (market == address(0)) {
      market = IUniswapV2Factory(UNISWAP_FACTORY).getPair(WETH_TOKEN, _token);
      return currentTokenPrice(market, _token);
    } else {
      return currentTokenPrice(market, _token);
    }
  }

  function currentTokenPrice(address uniswapMarket, address _token) public view returns (uint price) {
    (uint112 reserve0, uint112 reserve1, ) = IUniswapV2Pair(uniswapMarket).getReserves();
    address token0 = IUniswapV2Pair(uniswapMarket).token0();
    address token1 = IUniswapV2Pair(uniswapMarket).token1();

    uint8 tokenInDecimals = getTokenDecimals(_token);
    uint8 tokenOutDecimals = getTokenDecimals(_token == token0 ? token1 : token0);

    uint256 inAmount = 1 ether;
    if (tokenInDecimals < uint8(18)) {
      inAmount = inAmount.div(10 ** uint256(uint8(18) - tokenInDecimals));
    }

    price = UniswapV2Library.getAmountOut(
      inAmount,
      _token == token0 ? reserve0 : reserve1,
      _token == token0 ? reserve1 : reserve0
    );

    if (tokenInDecimals > tokenOutDecimals) {
      return price.mul(10 ** uint256(tokenInDecimals - tokenOutDecimals));
    } else {
      return price;
    }
  }

  function getBalancerTokensAndBalances(address _balancerPool)
    public view
    returns(address[] memory tokens, uint256[] memory balances)
  {
    tokens = BPoolInterface(_balancerPool).getCurrentTokens();
    uint256 len = tokens.length;

    balances = new uint256[](len);
    for (uint256 i = 0; i < len; i++) {
      balances[i] = BPoolInterface(_balancerPool).getBalance(tokens[i]);
    }
  }

  function getContractTokensBalanceOfArray(address _contract, address[] memory tokens)
    public view
    returns(uint256[] memory balances)
  {
    uint256 len = tokens.length;
    balances = new uint256[](len);
    for (uint256 i = 0; i < len; i++) {
      balances[i] = IERC20Detailed(tokens[i]).balanceOf(_contract);
    }
  }

  function getTokenDecimals(address _token) public view returns(uint8 decimals) {
    try IERC20Detailed(_token).decimals() returns (uint8 _decimals) {
      decimals = _decimals;
    } catch (bytes memory /*lowLevelData*/) {
      decimals = uint8(18);
    }
  }

  function amountToEther(uint256 amount, uint8 decimals) public view returns(uint256) {
    if (decimals == uint8(18)) {
      return amount;
    }
    return amount.mul(10 ** uint256(uint8(18) - decimals));
  }
}
