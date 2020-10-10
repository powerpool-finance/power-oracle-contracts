const { address, keccak256, ether, uint } = require('./helpers');
const { constants, time } = require('@openzeppelin/test-helpers');
const { buildPair, buildCvpPair, buildUsdcEth } = require('./builders');

const PriceSource = {
  FIXED_ETH: 0,
  FIXED_USD: 1,
  REPORTER: 2
};
const FIXED_ETH_AMOUNT = 0.005e18;

const dummyAddress = address(0);
const cToken = {ETH: address(1), DAI: address(2), REP: address(3), USDT: address(4), SAI: address(5), WBTC: address(6), CVP: address(7)};

// let cvpPair;
// let ethPair;
async function getTokenConfigs() {
  const mockPair = await buildPair();
  // cvpPair = await buildCvpPair((await time.latestBlock()).toString());
  // ethPair = await buildUsdcEth((await time.latestBlock()).toString());

  return [
    {cToken: cToken.ETH, underlying: dummyAddress, symbolHash: keccak256('ETH'), baseUnit: ether(1), priceSource: PriceSource.REPORTER, fixedPrice: 0, uniswapMarket: mockPair.address, isUniswapReversed: true},
    {cToken: cToken.CVP, underlying: dummyAddress, symbolHash: keccak256('CVP'), baseUnit: ether(1), priceSource: PriceSource.REPORTER, fixedPrice: 0, uniswapMarket: mockPair.address, isUniswapReversed: false},
    {cToken: cToken.DAI, underlying: dummyAddress, symbolHash: keccak256('DAI'), baseUnit: ether(1), priceSource: PriceSource.REPORTER, fixedPrice: 0, uniswapMarket: mockPair.address, isUniswapReversed: false},
    {cToken: cToken.REP, underlying: dummyAddress, symbolHash: keccak256('REP'), baseUnit: ether(1), priceSource: PriceSource.REPORTER, fixedPrice: 0, uniswapMarket: mockPair.address, isUniswapReversed: false},
    {cToken: cToken.USDT, underlying: dummyAddress, symbolHash: keccak256('USDT'), baseUnit: uint(1e6), priceSource: PriceSource.FIXED_USD, fixedPrice: uint(1e6), uniswapMarket: address(0), isUniswapReversed: false},
    {cToken: cToken.SAI, underlying: dummyAddress, symbolHash: keccak256('SAI'), baseUnit: ether(1), priceSource: PriceSource.FIXED_ETH, fixedPrice: uint(FIXED_ETH_AMOUNT), uniswapMarket: address(0), isUniswapReversed: false},
    {cToken: cToken.WBTC, underlying: dummyAddress, symbolHash: keccak256('BTC'), baseUnit: uint(1e8), priceSource: PriceSource.REPORTER, fixedPrice: 0, uniswapMarket: mockPair.address, isUniswapReversed: false},
  ];
}

// function getCvpPair() {
//   return cvpPair;
// }

module.exports = { getTokenConfigs }
