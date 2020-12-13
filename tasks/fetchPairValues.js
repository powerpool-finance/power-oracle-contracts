/* global task */
require('@nomiclabs/hardhat-truffle5');

task('pair-details', "Prints an account's balance")
  .addParam('account', "The account's address")
  .setAction(async (taskArgs) => {
    const MockUniswapTokenPair = artifacts.require('MockUniswapTokenPair');
    MockUniswapTokenPair.numberFormat = 'String';

    const pair = await MockUniswapTokenPair.at(taskArgs.account);

    // NOTICE: roughly values, but ok for seeding test suite
    console.log('price0CumulativeLast', await pair.price0CumulativeLast());
    console.log('price1CumulativeLast', await pair.price1CumulativeLast());
  });

module.exports = {};
