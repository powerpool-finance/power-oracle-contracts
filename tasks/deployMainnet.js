/* global usePlugin, task */

const pIteration = require('p-iteration');
const _ = require('lodash');

usePlugin('@nomiclabs/buidler-truffle5');

task('deploy-mainnet', 'Deploys mainnet contracts')
  .setAction(async () => {
    const { deployProxied, ether, address, keccak256, uint, gwei } = require('../test/helpers');
    const { constants } = require('@openzeppelin/test-helpers');

    const PowerOracleStaking = artifacts.require('PowerOracleStaking');
    const PowerOracle = artifacts.require('PowerOracle');
    const UniswapFactory = artifacts.require('UniswapV2Factory');

    PowerOracleStaking.numberFormat = 'String';
    PowerOracle.numberFormat = 'String';

    const { web3 } = PowerOracleStaking;
    const [deployer] = await web3.eth.getAccounts();

    const uniswapFactory = await UniswapFactory.at('0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f');

    const PriceSource = {
      FIXED_ETH: 0,
      FIXED_USD: 1,
      REPORTER: 2
    };

    const tokens = {
      'LEND': '0x80fB784B7eD66730e8b1DBd9820aFD29931aab03',
      'YFI': '0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e',
      'COMP': '0xc00e94cb662c3520282e6f5717214004a7f26888',
      'USDC': '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      'USDT': '0xdac17f958d2ee523a2206206994597c13d831ec7',
      'CVP': '0x38e4adB44ef08F22F5B5b76A8f0c2d0dCbE7DcA1',
      'SNX': '0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f',
      'wNXM': '0x0d438f3b5175bebc262bf23753c1e53d03432bde',
      'MKR': '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2',
      'UNI': '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
      'UMA': '0x04Fa0d235C4abf4BcF4787aF4CF447DE572eF828',
      'AAVE': '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
      'DAI': '0x6b175474e89094c44da98b954eedeac495271d0f',
      'WETH': '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
    };

    const pairBySymbol = {};

    const tokensArray = _.map(tokens, (address, symbol) => ({address, symbol}));

    const isUniswapReversed = {};
    await pIteration.map(tokensArray, async ({address, symbol}) => {
      if(address === tokens['WETH']) {
        return;
      }
      pairBySymbol[symbol] = await uniswapFactory.getPair(address, tokens['WETH']);

      if(pairBySymbol[symbol] === '0x0000000000000000000000000000000000000000') {
        pairBySymbol[symbol] = await uniswapFactory.getPair(tokens['WETH'], address);
        isUniswapReversed[symbol] = true;
      } else {
        isUniswapReversed[symbol] = false;
      }
    });

    function getTokenConfigs() {
      let custom = [
        {cToken: address(1), underlying: tokens['WETH'], symbol: 'ETH', symbolHash: keccak256('ETH'), baseUnit: ether(1), priceSource: PriceSource.REPORTER, fixedPrice: 0, uniswapMarket: pairBySymbol['USDC'], isUniswapReversed: true},
        {cToken: address(2), underlying: tokens['USDT'], symbol: 'USDT', symbolHash: keccak256('USDT'), baseUnit: uint(1e6), priceSource: PriceSource.FIXED_USD, fixedPrice: uint(1e6), uniswapMarket: address(0), isUniswapReversed: false},
        {cToken: address(3), underlying: tokens['USDC'], symbol: 'USDC', symbolHash: keccak256('USDC'), baseUnit: uint(1e6), priceSource: PriceSource.FIXED_USD, fixedPrice: uint(1e6), uniswapMarket: address(0), isUniswapReversed: false},
      ];

      tokensArray.forEach((token, index) => {
        const pairSymbol = token.symbol;
        if (pairSymbol === 'USDC' || pairSymbol === 'USDT' || pairSymbol === 'WETH') {
          return;
        }
        const pair = {cToken: address(index + 10), underlying: tokens[pairSymbol], symbol: pairSymbol, symbolHash: keccak256(pairSymbol), baseUnit: uint(1e18), priceSource: PriceSource.REPORTER, fixedPrice: 0, uniswapMarket: pairBySymbol[pairSymbol], isUniswapReversed: isUniswapReversed[pairSymbol]};
        console.log('>>', pairSymbol, pair);
        custom.push(pair);
      });
      return custom;
    }

    const tokenConfigs = getTokenConfigs();

    console.log('configs', tokenConfigs);

    const ANCHOR_PERIOD = 1800;
    // In seconds
    const MIN_REPORT_INTERVAL = 2700;
    // In seconds
    const MAX_REPORT_INTERVAL = 3600;
    // In order to act as a slasher, a user should keep their deposit >= MIN_SLASHING_DEPOSIT
    const MIN_SLASHING_DEPOSIT = ether(40);
    // A slasher reward in pct to the reporter deposit. Is multiplied to the outdated token count.
    const SLASHER_REWARD_PCT = '0';//ether('0.015');
    // The protocol reward in pct to the reporter deposit. Is multiplied to the outdated token count.
    const RESERVOIR_REWARD_PCT = '0';//ether('0.005');
    // 1 ether == 1%
    const CVP_APY = ether(20);
    // count
    const TOTAL_REPORTS_PER_YEAR = '105120';
    // In gas
    const GAS_EXPENSES_PER_ASSET_REPORT = '85000';
    // In wei
    const GAS_PRICE_LIMIT = gwei(1000);

    const OWNER = '0xB258302C3f209491d604165549079680708581Cc';
    const PROXY_OWNER = OWNER;
    const RESERVOIR = '0x8EbC56A13Ae7e3cE27B960b16AA57efed3F4e79E';

    console.log('Deployer address is', deployer);

    console.log('>>> Deploying PowerOracleStaking...');
    const staking = await deployProxied(
      PowerOracleStaking,
      [tokens['CVP'], RESERVOIR],
      [deployer, constants.ZERO_ADDRESS, MIN_SLASHING_DEPOSIT, SLASHER_REWARD_PCT, RESERVOIR_REWARD_PCT],
      { proxyAdminOwner: PROXY_OWNER }
    );
    console.log('>>> PowerOracleStaking (proxy) deployed at', staking.address);
    console.log('>>> PowerOracleStaking implementation deployed at', staking.initialImplementation.address);

    console.log('>>> Deploying PowerOracle...');
    const oracle = await deployProxied(
      PowerOracle,
      [tokens['CVP'], RESERVOIR, ANCHOR_PERIOD, tokenConfigs],
      [OWNER, staking.address, CVP_APY, TOTAL_REPORTS_PER_YEAR, GAS_EXPENSES_PER_ASSET_REPORT, GAS_PRICE_LIMIT, MIN_REPORT_INTERVAL, MAX_REPORT_INTERVAL],
      { proxyAdminOwner: PROXY_OWNER }
    );
    console.log('>>> PowerOracle (proxy) deployed at', oracle.address);
    console.log('>>> PowerOracle implementation deployed at', oracle.initialImplementation.address);

    console.log('>>> Setting powerOracle address in powerOracleStaking');
    await staking.setPowerOracle(oracle.address);

    console.log('>>> Transferring powerStaking address to the owner');
    await staking.transferOwnership(OWNER);
    await oracle.transferOwnership(OWNER);

    console.log('Done');
  });

module.exports = {};
