const chai = require('chai');
const { expect } = chai;

const MockCToken = artifacts.require('MockCToken');
const UniswapConfig = artifacts.require('UniswapConfig');

function address(n) {
  return `0x${n.toString(16).padStart(40, '0')}`;
}

function keccak256(str) {
  return web3.utils.keccak256(str);
}

function uint(n) {
  return web3.utils.toBN(n).toString();
}

describe('UniswapConfig', () => {
  let deployer;

  before(async function() {
    [deployer] = await web3.eth.getAccounts();
  });

  it('basically works', async () => {
    const unlistedButUnderlying = await MockCToken.new(address(4))
    const unlistedNorUnderlying = await MockCToken.new(address(5))
    const contract = await UniswapConfig.new([
      {cToken: address(1), underlying: address(0), symbolHash: keccak256('ETH'), baseUnit: uint(1e18), priceSource: 0, fixedPrice: 0, uniswapMarket: address(6), isUniswapReversed: false},
      {cToken: address(2), underlying: address(3), symbolHash: keccak256('BTC'), baseUnit: uint(1e18), priceSource: 1, fixedPrice: 1, uniswapMarket: address(7), isUniswapReversed: true},
      {cToken: unlistedButUnderlying.address, underlying: address(4), symbolHash: keccak256('REP'), baseUnit: uint(1e18), priceSource: 1, fixedPrice: 1, uniswapMarket: address(7), isUniswapReversed: true}
    ]);

    const cfg0 = await contract.getTokenConfig(0);
    const cfg1 = await contract.getTokenConfig(1);
    const cfg2 = await contract.getTokenConfig(2);
    const cfgBTC = await contract.getTokenConfigBySymbol('BTC');
    const cfgCT0 = await contract.getTokenConfigByCToken(address(1));
    const cfgETH = await contract.getTokenConfigBySymbol('ETH');
    const cfgCT1 = await contract.getTokenConfigByCToken(address(2));
    const cfgU2 =  await contract.getTokenConfigByCToken(unlistedButUnderlying.address);
    expect(cfg0).to.have.ordered.members(cfgETH);
    expect(cfgETH).to.have.ordered.members(cfgCT0);
    expect(cfg1).to.have.ordered.members(cfgBTC);
    expect(cfgBTC).to.have.ordered.members(cfgCT1);
    expect(cfg0).not.to.have.ordered.members(cfg1);
    expect(cfgU2).to.have.ordered.members(cfg2);

    await expect(contract.getTokenConfig(3)).to.be.revertedWith('UniswapConfig::getTokenConfig: Token config not found');
    await expect(contract.getTokenConfigBySymbol('COMP')).to.be.revertedWith('UniswapConfig::getTokenConfigBySymbolHash: Token cfg not found');
    await expect(contract.getTokenConfigByCToken(address(3))).to.be.reverted; // not a ctoken
    await expect(contract.getTokenConfigByCToken(unlistedNorUnderlying.address)).to.be.revertedWith('UniswapConfig::getTokenConfigByUnderlying: Token cfg not found');
  });

  it('returns configs exactly as specified', async () => {
    const symbols = Array(15).fill(0).map((_, i) => String.fromCharCode('a'.charCodeAt(0) + i));
    const configs = symbols.map((symbol, i) => {
      return {cToken: address(i + 1), underlying: address(i), symbolHash: keccak256(symbol), baseUnit: uint(1e6), priceSource: 0, fixedPrice: 1, uniswapMarket: address(i + 50), isUniswapReversed: i % 2 == 0}
    });
    const contract = await UniswapConfig.new(configs);

    await Promise.all(configs.map(async (config, i) => {
      const cfgByIndex = await contract.getTokenConfig(i);
      const cfgBySymbol = await contract.getTokenConfigBySymbol(symbols[i]);
      const cfgByCToken = await contract.getTokenConfigByCToken(address(i + 1));
      const cfgByUnderlying = await contract.getTokenConfigByUnderlying(address(i));
      expect({
        cToken: cfgByIndex.cToken.toLowerCase(),
        underlying: cfgByIndex.underlying.toLowerCase(),
        symbolHash: cfgByIndex.symbolHash,
        baseUnit: cfgByIndex.baseUnit,
        priceSource: cfgByIndex.priceSource,
        fixedPrice:  cfgByIndex.fixedPrice,
        uniswapMarket: cfgByIndex.uniswapMarket.toLowerCase(),
        isUniswapReversed: cfgByIndex.isUniswapReversed
      }).to.deep.equal({
        cToken: config.cToken,
        underlying: config.underlying,
        symbolHash: config.symbolHash,
        baseUnit: `${config.baseUnit}`,
        priceSource: `${config.priceSource}`,
        fixedPrice: `${config.fixedPrice}`,
        uniswapMarket: config.uniswapMarket,
        isUniswapReversed: config.isUniswapReversed
      });
      expect(cfgByIndex).to.have.ordered.members(cfgBySymbol);
      expect(cfgBySymbol).to.have.ordered.members(cfgByCToken);
      expect(cfgByUnderlying).to.have.ordered.members(cfgBySymbol);
    }));
  });

  it('checks gas', async () => {
    const configs = Array(14).fill(0).map((_, i) => {
      const symbol = String.fromCharCode('a'.charCodeAt(0) + i);
      return {
        cToken: address(i),
        underlying: address(i + 1),
        symbolHash: keccak256(symbol),
        baseUnit: uint(1e6),
        priceSource: 0,
        fixedPrice: 1,
        uniswapMarket: address(i + 50),
        isUniswapReversed: i % 2 == 0}
    });
    const contract = await UniswapConfig.new(configs);

    const cfg9 = await contract.getTokenConfig(9);
    const tx9 = await contract.contract.methods.getTokenConfig(9).send({ from: deployer });
    expect(cfg9.underlying.toLowerCase()).to.be.equal(address(10));
    expect(tx9.gasUsed).to.be.equal(22663);

    const cfg8 = await contract.getTokenConfig(8);
    const tx8 = await contract.contract.methods.getTokenConfig(8).send({ from: deployer });
    expect(cfg8.underlying.toLowerCase()).to.be.equal(address(9));
    expect(tx8.gasUsed).to.be.equal(22637);

    const cfgZ = await contract.getTokenConfigBySymbol('n');
    const txZ = await contract.contract.methods.getTokenConfigBySymbol('n').send({ from: deployer });
    expect(cfgZ.cToken.toLowerCase()).to.be.equal(address(13));
    expect(cfgZ.underlying.toLowerCase()).to.be.equal(address(14));
    expect(txZ.gasUsed).to.be.equal(24638);

    const cfgCT14 = await contract.getTokenConfigByCToken(address(13));
    const txCT14 = await contract.contract.methods.getTokenConfigByCToken(address(13)).send({ from: deployer });
    expect(cfgCT14.cToken.toLowerCase()).to.be.equal(address(13));
    expect(cfgCT14.underlying.toLowerCase()).to.be.equal(address(14));
    expect(txCT14.gasUsed).to.be.equal(24124);

    const cfgU14 = await contract.getTokenConfigByUnderlying(address(14));
    const txU14 = await contract.contract.methods.getTokenConfigByUnderlying(address(14)).send({ from: deployer });
    expect(cfgU14.cToken.toLowerCase()).to.be.equal(address(13));
    expect(cfgU14.underlying.toLowerCase()).to.be.equal(address(14));
    expect(txU14.gasUsed).to.be.equal(24058);
  });
});
