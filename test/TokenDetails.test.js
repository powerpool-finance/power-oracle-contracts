const chai = require('chai');
const { expect } = chai;

const MockCToken = artifacts.require('MockCToken');
const TokenDetails = artifacts.require('TokenDetails');

MockCToken.numberFormat = 'String';
TokenDetails.numberFormat = 'String';

function address(n) {
  return `0x${n.toString(16).padStart(40, '0')}`;
}

function keccak256(str) {
  return web3.utils.keccak256(str);
}

function uint(n) {
  return web3.utils.toBN(n).toString();
}

const UNISWAP_FACTORY = address(101);
const SUSHISWAP_FACTORY = address(102);
const FUZZYSWAP_FACTORY = address(103);
const INVALID_FACTORY = address(104);

const PriceSource = {
  FIXED_ETH: '0', /// implies the fixedPrice is a constant multiple of the ETH price (which varies)
  FIXED_USD: '1', /// implies the fixedPrice is a constant multiple of the USD price (which is 1)
  REPORTER: '2', /// implies the price is set by the reporter
};

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

function buildPair(factory, pair, isReversed) {
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

describe('TokenDetails', () => {
  let deployer;
  let contract;

  before(async function () {
    // [deployer] = await web3.eth.getAccounts();

    contract = await TokenDetails.new(UNISWAP_FACTORY);
    await contract.addValidFactories([UNISWAP_FACTORY, SUSHISWAP_FACTORY, FUZZYSWAP_FACTORY]);

    const token1 = buildToken(address(1), address(2), 'ETH', uint(1e18), PriceSource.REPORTER, 0, [
      buildPair(UNISWAP_FACTORY, address(3), false),
    ]);
    const token2 = buildToken(address(4), address(5), 'USDC', uint(1e18), PriceSource.FIXED_USD, 1, []);
    const token3 = buildToken(address(7), address(8), 'REP', uint(1e9), PriceSource.REPORTER, 1, [
      buildPair(UNISWAP_FACTORY, address(9), true),
      buildPair(SUSHISWAP_FACTORY, address(10), false),
      buildPair(FUZZYSWAP_FACTORY, address(11), false),
    ]);
    const blah = buildAddTokenArgs([token1, token2, token3]);
    await contract.addTokens(...blah);
  });

  describe.only('getTokenConfig()', () => {
    it('should provide token details for a token with a single pair', async () => {
      const token = address(1);
      (await Promise.all([
        contract.getTokenConfig(token),
        contract.getTokenConfigBySymbolHash(web3.utils.keccak256('ETH')),
        contract.getTokenConfigBySymbol('ETH'),
        contract.getTokenConfigByCToken(address(2))
      ])).forEach(cfg => {
        expect(cfg.token).to.be.equal(address(1));
        expect(cfg.cToken).to.be.equal(address(2));
        expect(cfg.symbol).to.be.equal('ETH');
        expect(cfg.symbolHash).to.be.equal(web3.utils.keccak256('ETH'));
        expect(cfg.baseUnit).to.be.equal(uint(1e18));
        expect(cfg.priceSource).to.be.equal(PriceSource.REPORTER);
        expect(cfg.exchanges).to.have.same.members([UNISWAP_FACTORY]);
      })

      let exchange = await contract.tokenExchangeDetails(token, UNISWAP_FACTORY);
      expect(exchange.pair).to.be.equal(address(3));
      expect(exchange.isReversed).to.be.equal(false);
      exchange = await contract.tokenExchangeDetails(token, SUSHISWAP_FACTORY);
      expect(exchange.pair).to.be.equal(address(0));
      expect(exchange.isReversed).to.be.equal(false);

      const exchanges = await contract.getTokenExchanges(token);
      expect(exchanges.length).to.be.equal(1);
      expect(exchanges[0].pair).to.be.equal(address(3));
      expect(exchanges[0].isReversed).to.be.equal(false);
    });

    it('should provide token details for a token without pairs', async () => {
      const token = address(4);
      (await Promise.all([
        contract.getTokenConfig(token),
        contract.getTokenConfigBySymbolHash(web3.utils.keccak256('USDC')),
        contract.getTokenConfigBySymbol('USDC'),
        contract.getTokenConfigByCToken(address(5))
      ])).forEach(cfg => {
        expect(cfg.token).to.be.equal(address(4));
        expect(cfg.cToken).to.be.equal(address(5));
        expect(cfg.symbol).to.be.equal('USDC');
        expect(cfg.symbolHash).to.be.equal(web3.utils.keccak256('USDC'));
        expect(cfg.baseUnit).to.be.equal(uint(1e18));
        expect(cfg.priceSource).to.be.equal(PriceSource.FIXED_USD);
        expect(cfg.exchanges).to.have.same.members([]);
      })

      let exchange = await contract.tokenExchangeDetails(token, UNISWAP_FACTORY);
      expect(exchange.pair).to.be.equal(address(0));
      expect(exchange.isReversed).to.be.equal(false);
      exchange = await contract.tokenExchangeDetails(token, SUSHISWAP_FACTORY);
      expect(exchange.pair).to.be.equal(address(0));
      expect(exchange.isReversed).to.be.equal(false);

      const exchanges = await contract.getTokenExchanges(token);
      expect(exchanges.length).to.be.equal(0);
    });

    it('should provide token details for a token with multiple pairs', async () => {
      const token = address(7);
      (await Promise.all([
        contract.getTokenConfig(token),
        contract.getTokenConfigBySymbolHash(web3.utils.keccak256('REP')),
        contract.getTokenConfigBySymbol('REP'),
        contract.getTokenConfigByCToken(address(8))
      ])).forEach(cfg => {
        expect(cfg.token).to.be.equal(address(7));
        expect(cfg.cToken).to.be.equal(address(8));
        expect(cfg.symbol).to.be.equal('REP');
        expect(cfg.symbolHash).to.be.equal(web3.utils.keccak256('REP'));
        expect(cfg.baseUnit).to.be.equal(uint(1e9));
        expect(cfg.priceSource).to.be.equal(PriceSource.REPORTER);
        expect(cfg.exchanges).to.have.same.members([UNISWAP_FACTORY, SUSHISWAP_FACTORY, FUZZYSWAP_FACTORY]);
      })

      let exchange = await contract.tokenExchangeDetails(token, UNISWAP_FACTORY);
      expect(exchange.pair).to.be.equal(address(9));
      expect(exchange.isReversed).to.be.equal(true);
      exchange = await contract.tokenExchangeDetails(token, SUSHISWAP_FACTORY);
      expect(exchange.pair.toLowerCase()).to.be.equal(address(10));
      expect(exchange.isReversed).to.be.equal(false);
      exchange = await contract.tokenExchangeDetails(token, FUZZYSWAP_FACTORY);
      expect(exchange.pair).to.be.equal(address(11));
      expect(exchange.isReversed).to.be.equal(false);

      const exchanges = await contract.getTokenExchanges(token);
      expect(exchanges.length).to.be.equal(3);
      expect(exchanges[0].pair).to.be.equal(address(9));
      expect(exchanges[0].isReversed).to.be.equal(true);
      expect(exchanges[1].pair.toLowerCase()).to.be.equal(address(10));
      expect(exchanges[1].isReversed).to.be.equal(false);
      expect(exchanges[2].pair).to.be.equal(address(11));
      expect(exchanges[2].isReversed).to.be.equal(false);
    });
  });
});
