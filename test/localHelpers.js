const { address, keccak256, ether, uint } = require('./helpers');
const { buildPair } = require('./builders');

const PriceSource = {
  FIXED_ETH: 0,
  FIXED_USD: 1,
  REPORTER: 2
};
const FIXED_ETH_AMOUNT = 0.005e18;

const cToken = {ETH: address(1), DAI: address(2), REP: address(3), USDT: address(4), SAI: address(5), WBTC: address(6), CVP: address(7)};
const underlyings = {ETH: address(111), DAI: address(222), REP: address(333), USDT: address(444), SAI: address(555), WBTC: address(666), CVP: address(777)};

async function getTokenConfigs(cvpAddress) {
  const mockPair = await buildPair();

  return [
    {cToken: cToken.ETH, underlying: underlyings.ETH, symbolHash: keccak256('ETH'), baseUnit: ether(1), priceSource: PriceSource.REPORTER, fixedPrice: 0, uniswapMarket: mockPair.address, isUniswapReversed: true},
    {cToken: cToken.CVP, underlying: cvpAddress, symbolHash: keccak256('CVP'), baseUnit: ether(1), priceSource: PriceSource.REPORTER, fixedPrice: 0, uniswapMarket: mockPair.address, isUniswapReversed: false},
    {cToken: cToken.DAI, underlying: underlyings.DAI, symbolHash: keccak256('DAI'), baseUnit: ether(1), priceSource: PriceSource.REPORTER, fixedPrice: 0, uniswapMarket: mockPair.address, isUniswapReversed: false},
    {cToken: cToken.REP, underlying: underlyings.REP, symbolHash: keccak256('REP'), baseUnit: ether(1), priceSource: PriceSource.REPORTER, fixedPrice: 0, uniswapMarket: mockPair.address, isUniswapReversed: false},
    {cToken: cToken.USDT, underlying: underlyings.USDT, symbolHash: keccak256('USDT'), baseUnit: uint(1e6), priceSource: PriceSource.FIXED_USD, fixedPrice: uint(1e6), uniswapMarket: address(0), isUniswapReversed: false},
    {cToken: cToken.SAI, underlying: underlyings.SAI, symbolHash: keccak256('SAI'), baseUnit: ether(1), priceSource: PriceSource.FIXED_ETH, fixedPrice: uint(FIXED_ETH_AMOUNT), uniswapMarket: address(0), isUniswapReversed: false},
    {cToken: cToken.WBTC, underlying: underlyings.WBTC, symbolHash: keccak256('BTC'), baseUnit: uint(1e8), priceSource: PriceSource.REPORTER, fixedPrice: 0, uniswapMarket: mockPair.address, isUniswapReversed: false},
  ];
}

module.exports = { getTokenConfigs }
