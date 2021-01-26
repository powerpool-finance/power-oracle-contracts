const { address, keccak256, ether, uint } = require('./helpers');
const { buildPair } = require('./builders');

const PriceSource = {
  FIXED_ETH: 0,
  FIXED_USD: 1,
  REPORTER: 2
};
const FIXED_ETH_AMOUNT = 0.005e18;
const UNISWAP_FACTORY = address(101);
const SUSHISWAP_FACTORY = address(102);
const FUZZYSWAP_FACTORY = address(103);
const INVALID_FACTORY = address(104);

const cToken = {ETH: address(1), DAI: address(2), REP: address(3), USDT: address(4), SAI: address(5), WBTC: address(6), CVP: address(7)};
const underlyings = {ETH: address(111), DAI: address(222), REP: address(333), USDT: address(444), SAI: address(555), WBTC: address(666), CVP: address(777)};

async function getTokenConfigs() {
  const mockPair = await buildPair();

  return buildAddTokenArgs([
    buildToken(underlyings.ETH, cToken.ETH, 'ETH', uint(1e18), PriceSource.REPORTER, 0, [
      buildExchange(UNISWAP_FACTORY, mockPair.address, true),
    ]),
    buildToken(underlyings.CVP, cToken.CVP, 'CVP', uint(1e18), PriceSource.REPORTER, 0, [
      buildExchange(UNISWAP_FACTORY, mockPair.address, false),
    ]),
    buildToken(underlyings.DAI, cToken.DAI, 'DAI', uint(1e18), PriceSource.REPORTER, 0, [
      buildExchange(UNISWAP_FACTORY, mockPair.address, false),
    ]),
    buildToken(underlyings.REP, cToken.REP, 'REP', uint(1e18), PriceSource.REPORTER, 0, [
      buildExchange(UNISWAP_FACTORY, mockPair.address, false),
    ]),
    buildToken(underlyings.USDT, cToken.USDT, 'USDT', uint(1e6), PriceSource.FIXED_USD, uint(1e6), []),
    buildToken(underlyings.SAI, cToken.SAI, 'SAI', uint(1e18), PriceSource.FIXED_ETH, uint(FIXED_ETH_AMOUNT), []),
    buildToken(underlyings.WBTC, cToken.WBTC, 'BTC', uint(1e8), PriceSource.REPORTER, 0, [
      buildExchange(UNISWAP_FACTORY, mockPair.address, false),
    ]),
    // {cToken: cToken.ETH, underlying: underlyings.ETH, symbolHash: keccak256('ETH'), baseUnit: ether(1), priceSource: PriceSource.REPORTER, fixedPrice: 0, uniswapMarket: mockPair.address, isUniswapReversed: true},
    // {cToken: cToken.CVP, underlying: underlyings.CVP, symbolHash: keccak256('CVP'), baseUnit: ether(1), priceSource: PriceSource.REPORTER, fixedPrice: 0, uniswapMarket: mockPair.address, isUniswapReversed: false},
    // {cToken: cToken.DAI, underlying: underlyings.DAI, symbolHash: keccak256('DAI'), baseUnit: ether(1), priceSource: PriceSource.REPORTER, fixedPrice: 0, uniswapMarket: mockPair.address, isUniswapReversed: false},
    // {cToken: cToken.REP, underlying: underlyings.REP, symbolHash: keccak256('REP'), baseUnit: ether(1), priceSource: PriceSource.REPORTER, fixedPrice: 0, uniswapMarket: mockPair.address, isUniswapReversed: false},
    // {cToken: cToken.USDT, underlying: underlyings.USDT, symbolHash: keccak256('USDT'), baseUnit: uint(1e6), priceSource: PriceSource.FIXED_USD, fixedPrice: uint(1e6), uniswapMarket: address(0), isUniswapReversed: false},
    // {cToken: cToken.SAI, underlying: underlyings.SAI, symbolHash: keccak256('SAI'), baseUnit: ether(1), priceSource: PriceSource.FIXED_ETH, fixedPrice: uint(FIXED_ETH_AMOUNT), uniswapMarket: address(0), isUniswapReversed: false},
    // {cToken: cToken.WBTC, underlying: underlyings.WBTC, symbolHash: keccak256('BTC'), baseUnit: uint(1e8), priceSource: PriceSource.REPORTER, fixedPrice: 0, uniswapMarket: mockPair.address, isUniswapReversed: false},
  ]);
}

function buildToken(token, cToken, symbol, baseUnit, priceSource, fixedPrice, pairs) {
  return {
    token,
    cToken,
    symbol,
    baseUnit,
    priceSource,
    fixedPrice,
    pairs,
  };
}

function buildExchange(factory, pair, isReversed) {
  return { factory, pair, isReversed };
}

function buildAddTokenArgs(tokenInputs) {
  const tokens = [];
  const pairs = [];

  for (let i = 0; i < tokenInputs.length; i++) {
    const token = Object.assign({}, tokenInputs[i]);
    token.exchanges = token.pairs.map(p => p.factory);
    token.symbolHash = web3.utils.keccak256(token.symbol);

    pairs.push(token.pairs.map(p => { return { pair: p.pair, isReversed: p.isReversed }}));
    delete token.pairs;
    tokens.push(token);
  }

  return [ tokens, pairs ]
}

module.exports = { getTokenConfigs, buildToken, buildExchange, buildAddTokenArgs, factories: { UNISWAP_FACTORY, SUSHISWAP_FACTORY, FUZZYSWAP_FACTORY } }
