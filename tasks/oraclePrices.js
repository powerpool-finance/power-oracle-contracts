usePlugin('@nomiclabs/buidler-truffle5');

task('oracle-prices', 'Prints the oracle prices')
  .addParam('oracle', 'The oracle to fetch prices from')
  .addFlag('poke', 'Whether to poke or not')
  .setAction(async (taskArgs) => {
    const { keccak256 } = require('../test/helpers');
    const PowerOracle = artifacts.require('PowerOracle');
    PowerOracle.numberFormat = 'String';

    let oracle = await PowerOracle.at(taskArgs.oracle);

    const uniswapPairs = ['LEND', 'YFI', 'SNX', 'CVP', 'COMP', 'wNXM', 'MKR', 'UNI', 'UMA', 'AAVE', 'DAI', 'USDC', 'USDT', 'ETH'];
    const toPoke = ['CVP', 'LEND', 'YFI', 'SNX', 'COMP', 'wNXM', 'MKR', 'UNI', 'UMA', 'AAVE', 'DAI'];

    if (taskArgs.poke) {
      console.log('>>> Poking...');
      await oracle.poke(toPoke);
      console.log('>>> Poked');
    }
    const hashes = uniswapPairs.map(keccak256);
    const hashToSymbol = {};
    hashes.map((v, i) => {
      hashToSymbol[v] = uniswapPairs[i];
    })

    for (let i = 0; i < 14; i++) {
      const config = await oracle.getTokenConfig(i);
      console.log('>>>', hashToSymbol[config.symbolHash] || config.symbolHash, (await oracle.getPriceByAsset(config.underlying)) / 1e6);
    }
  });

module.exports = {};
