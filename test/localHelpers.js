const { address, keccak256, ether, uint } = require('./helpers');
const { buildPair } = require('./builders');

const PriceSource = {
  FIXED_USD: 0,
  REPORTER: 1
};

const underlyings = {ETH: address(111), DAI: address(222), REP: address(333), USDT: address(444), SAI: address(555), WBTC: address(666), CVP: address(777)};

async function getTokenConfigs(cvpAddress) {
  const mockPair = await buildPair();

  return [
    {token: underlyings.ETH, symbol: 'ETH', basic: {symbolHash: keccak256('ETH'), baseUnit: ether(1), priceSource: PriceSource.REPORTER, fixedPrice: 0, active: 2}, update: {uniswapMarket: mockPair.address, isUniswapReversed: true}},
    {token: cvpAddress, symbol: 'CVP', basic: {symbolHash: keccak256('CVP'), baseUnit: ether(1), priceSource: PriceSource.REPORTER, fixedPrice: 0, active: 2}, update: {uniswapMarket: mockPair.address, isUniswapReversed: false}},
    {token: underlyings.DAI, symbol: 'DAI', basic: {symbolHash: keccak256('DAI'), baseUnit: ether(1), priceSource: PriceSource.REPORTER, fixedPrice: 0, active: 2}, update: {uniswapMarket: mockPair.address, isUniswapReversed: false}},
    {token: underlyings.REP, symbol: 'REP', basic: {symbolHash: keccak256('REP'), baseUnit: ether(1), priceSource: PriceSource.REPORTER, fixedPrice: 0, active: 2}, update: {uniswapMarket: mockPair.address, isUniswapReversed: false}},
    {token: underlyings.USDT, symbol: 'USDT', basic: {symbolHash: keccak256('USDT'), baseUnit: uint(1e6), priceSource: PriceSource.FIXED_USD, fixedPrice: uint(1e6), active: 2}, update: {uniswapMarket: address(0), isUniswapReversed: false}},
    {token: underlyings.WBTC, symbol: 'BTC', basic: {symbolHash: keccak256('BTC'), baseUnit: uint(1e8), priceSource: PriceSource.REPORTER, fixedPrice: 0, active: 2}, update: {uniswapMarket: mockPair.address, isUniswapReversed: false}},
  ];
}

module.exports = { getTokenConfigs }
