/* global task */

require('@nomiclabs/hardhat-truffle5');
require('@nomiclabs/hardhat-ethers');

const pIteration = require('p-iteration');
const _ = require('lodash');

task('redeploy-oracle-implementation', 'Redeploy oracle implementation')
  .setAction(async (__, { ethers }) => {
    const { keccak256, forkContractUpgrade, deployAndSaveArgs, increaseTime } = require('../test/helpers');
    const PowerOracle = artifacts.require('PowerOracle');
    PowerOracle.numberFormat = 'String';
    const { web3 } = PowerOracle;
    // const [deployer] = await web3.eth.getAccounts();

    const proxyAddress = '0x50f8D7f4db16AA926497993F020364f739EDb988';
    const oracle = await PowerOracle.at(proxyAddress);
    const numTokens = await oracle.numTokens();
    console.log('numTokens', numTokens);
    let configs = [];
    for(let i = 0; i < numTokens; i++) {
      configs[i] = _.pick(await oracle.getTokenConfig(i), ['cToken', 'underlying', 'symbolHash', 'baseUnit', 'priceSource', 'fixedPrice', 'uniswapMarket', 'isUniswapReversed']);
    }

    // configs = configs.filter(p => p.underlying.toLowerCase() !== '0x80fb784b7ed66730e8b1dbd9820afd29931aab03');

    const addPairs = [
      // {market: '0x2e81ec0b8b4022fac83a21b2f2b4b8f5ed744d70', token: '0xc944e90c64b2c07662a292be6244bdf05cda44a7', symbol: keccak256('GRT'), isUniswapReversed: true}
    ];
    await pIteration.forEachSeries(addPairs, (pair) => {
      configs.push({
        cToken: pair.token,
        underlying: pair.token,
        symbolHash: pair.symbol,
        baseUnit: '1000000000000000000',
        priceSource: '2',
        fixedPrice: '0',
        uniswapMarket: pair.market,
        isUniswapReversed: !!pair.isUniswapReversed
      })
    });
    console.log('configs', configs.length);

    const cvpToken = await oracle.CVP_TOKEN();
    const anchorPeriod = await oracle.anchorPeriod();
    console.log('anchorPeriod before', anchorPeriod);
    const newImpl = await deployAndSaveArgs(PowerOracle, [cvpToken, anchorPeriod, configs]);
    console.log('newImpl', newImpl.address);

    const networkId = await web3.eth.net.getId();
    if (networkId === 1) {
      return;
    }

    await forkContractUpgrade(
      ethers,
      '0xb258302c3f209491d604165549079680708581cc',
      '0x7696f9208f9e195ba31e6f4B2D07B6462C8C42bb',
      '0x019e14DA4538ae1BF0BCd8608ab8595c6c6181FB',
      newImpl.address
    );

    console.log('anchorPeriod after', await oracle.anchorPeriod());

    const symbols = ['GRT', 'YFI', 'COMP', 'CVP', 'SNX', 'wNXM', 'MKR', 'UNI', 'UMA', 'AAVE', 'DAI', 'SUSHI', 'CREAM', 'AKRO', 'COVER', 'KP3R', 'PICKLE'];

    await increaseTime(ethers, 60 * 60);

    await oracle.poke(symbols);

    await increaseTime(ethers, 60 * 60);

    await oracle.poke(symbols);

    await increaseTime(ethers, 60 * 60);

    await oracle.poke(symbols);

    await pIteration.forEachSeries(symbols, async (s) => {
      console.log(s, parseInt(await oracle.getPriceBySymbolHash(keccak256(s))) / 10 ** 6);
    });

    console.log('Done');
  });

module.exports = {};
