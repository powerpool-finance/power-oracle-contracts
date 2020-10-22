/* global usePlugin, task */
const fs = require('fs');
const pIteration = require('p-iteration');

usePlugin('@nomiclabs/buidler-truffle5');


task('deploy-testnet', 'Deploys testnet contracts')
  .setAction(async () => {
    const { deployProxied, ether, gwei, address, keccak256, uint } = require('../test/helpers');
    const { constants } = require('@openzeppelin/test-helpers');

    const PowerOracleStaking = artifacts.require('PowerOracleStaking');
    const PowerOracle = artifacts.require('PowerOracle');
    const MockERC20 = artifacts.require('MockERC20');
    const IUniswapV2Pair = artifacts.require('IUniswapV2Pair');
    const MockUniswapFactory = artifacts.require('UniswapV2Factory');
    const MockUniswapV2Router02 = artifacts.require('UniswapV2Router02');

    const { web3 } = PowerOracleStaking;
    const [deployer] = await web3.eth.getAccounts();

    const I1E30 = '1000000000000000000000000000000';
    // Anchor period for uniswap price checkpoint in seconds
    const ANCHOR_PERIOD = 30;
    // In seconds
    const MIN_REPORT_INTERVAL = 30;
    // In seconds
    const MAX_REPORT_INTERVAL = 45;
    // In order to act as a slasher, a user should keep their deposit >= MIN_SLASHING_DEPOSIT
    const MIN_SLASHING_DEPOSIT = ether(40);
    // A slasher reward in pct to the reporter deposit. Is multiplied to the outdated token count.
    const SLASHER_REWARD_PCT = ether('0.015');
    // The protocol reward in pct to the reporter deposit. Is multiplied to the outdated token count.
    const RESERVOIR_REWARD_PCT = ether('0.005');
    // 1 ether == 1%
    const CVP_APY = ether(20);
    // count
    const TOTAL_REPORTS_PER_YEAR = '90000';
    // In gas
    const GAS_EXPENSES_PER_ASSET_REPORT = '110000';
    // In wei
    const GAS_PRICE_LIMIT = gwei(1000);
    const MockCVP = artifacts.require('MockCVP');
    const OWNER = '0xe7F2f6bb028E2c01C2C34e01BFFe5f534E7f1901';
    // The same as deployer
    const RESERVOIR = deployer;

    const networkId = await web3.eth.net.getId();

    PowerOracleStaking.numberFormat = 'String';
    PowerOracle.numberFormat = 'String';
    MockERC20.numberFormat = 'String';
    IUniswapV2Pair.numberFormat = 'String';

    console.log('Deployer address is', deployer);

    const PriceSource = {
      FIXED_ETH: 0,
      FIXED_USD: 1,
      REPORTER: 2
    };

    const uniswapPairs = require('../config/uniswapPairs');
    const withPairKeys = Object.keys(uniswapPairs.withPair);
    const cToken = {};
    const totalErc20StubsToDeploy = withPairKeys.concat(uniswapPairs.noPair);

    totalErc20StubsToDeploy.forEach((k, i) => {
      cToken[k] = address(i + 1);
    });
    console.log('>>> cToken to deploy', cToken);

    console.log('>>> Deploying underlying token stubs...');
    const deployedTokens = await pIteration.mapSeries(totalErc20StubsToDeploy, (k) => {
      return MockERC20.new(k, k, I1E30);
    });

    console.log('>>> Stub tokens deployed');
    console.log('>>> Deploying uniswap factory...');
    const factory = await MockUniswapFactory.new(deployer);
    console.log('>>> Factory deployed at', factory.address);

    console.log('>>> Deploying uniswap router...');
    const router = await MockUniswapV2Router02.new(factory.address, deployedTokens[totalErc20StubsToDeploy.indexOf('USDT')].address);
    console.log('>>> Router is deployed to', router.address)

    console.log('>>> Deploying uniswap pairs...');

    const pairBySymbol = {};

    const deployedPairs = await pIteration.mapSeries(totalErc20StubsToDeploy, async (symbol) => {
      if (['ETH', 'USDT'].includes(symbol)) {
        return;
      }
      const token1 = deployedTokens[totalErc20StubsToDeploy.indexOf(symbol)].address;
      const token2 = deployedTokens[totalErc20StubsToDeploy.indexOf('ETH')].address;
      console.log('>>Pushing pair for', symbol, 'to', 'ETH');

      return {
        symbol,
        res: await factory.createPair(token1, token2)
      };
    }).then(arr => arr.filter(v => v).map(({res, symbol}) => {
      pairBySymbol[symbol] = res.logs[0].args.pair;
      // if(symbol === 'USDC') {
      //   pairBySymbol['ETH'] = res.logs[0].args.pair;
      // }
      return res.logs[0].args.pair;
    }));
    console.log('>>> Deployed pairs', deployedPairs);

    console.log('>>> Depositing to uniswap pairs...');

     // const txs = [];
    const snapshot = JSON.parse(fs.readFileSync('./tmp/pairValues.json').toString('utf-8'));

    const ethTokenAddress = deployedTokens[totalErc20StubsToDeploy.indexOf('ETH')].address;
    const isReseved = {};
    for (let symbol of withPairKeys) {
      // if (symbol === 'ETH') {
      //   symbol = 'USDC';
      // }
      console.log('>>> Adding liquidity to', symbol);
      const oppositeToken = await MockERC20.at(deployedTokens[totalErc20StubsToDeploy.indexOf(symbol)].address);
      const ethToken = await MockERC20.at(ethTokenAddress);

      await oppositeToken.approve(router.address, snapshot[symbol].reserve0);
      await ethToken.approve(router.address, snapshot[symbol].reserve1);

      const pair = await IUniswapV2Pair.at(deployedPairs[totalErc20StubsToDeploy.indexOf(symbol)]);

      if ((await pair.token0()) === ethTokenAddress) {
        await router.addLiquidity(
          ethToken.address,
          oppositeToken.address,
          snapshot[symbol].reserve1,
          snapshot[symbol].reserve0,
          0,
          0,
          deployer,
          1702603082,
        )

        isReseved[symbol] = true;
        console.log('>>> ETH ->', symbol);
      } else {
        await router.addLiquidity(
          oppositeToken.address,
          ethToken.address,
          snapshot[symbol].reserve0,
          snapshot[symbol].reserve1,
          0,
          0,
          deployer,
          1702603082,
        )
        isReseved[symbol] = false;
        console.log('>>>', symbol, '-> ETH');
      }

      if (symbol === 'USDC') {
        const eth = BigInt(ethToken.address);
        const usdc = BigInt(oppositeToken.address);
        if (eth > usdc) {
          console.log('>>> ETH pair is reversed');
          isReseved['ETH'] = true;
        } else {
          console.log('>>> ETH pair is NOT reversed');
          isReseved['ETH'] = false;
        }
      }
      console.log('>>>', await pair.getReserves());
    }

    function getTokenConfigs() {
      let custom = [
        {cToken: cToken.ETH, underlying: deployedTokens[totalErc20StubsToDeploy.indexOf('ETH')].address, symbolHash: keccak256('ETH'), baseUnit: ether(1), priceSource: PriceSource.REPORTER, fixedPrice: 0, uniswapMarket: pairBySymbol['USDC'], isUniswapReversed: isReseved['ETH']},
        {cToken: cToken.USDT, underlying: deployedTokens[totalErc20StubsToDeploy.indexOf('USDT')].address, symbolHash: keccak256('USDT'), baseUnit: uint(1e6), priceSource: PriceSource.FIXED_USD, fixedPrice: uint(1e6), uniswapMarket: address(0), isUniswapReversed: false},
        {cToken: cToken.USDC, underlying: deployedTokens[totalErc20StubsToDeploy.indexOf('USDC')].address, symbolHash: keccak256('USDC'), baseUnit: uint(1e6), priceSource: PriceSource.FIXED_USD, fixedPrice: uint(1e6), uniswapMarket: address(0), isUniswapReversed: false},
      ];

      withPairKeys.forEach(pairSymbol => {
        if (pairSymbol === 'USDC') {
          return;
        }
        const pair = {cToken: cToken[pairSymbol], underlying: deployedTokens[totalErc20StubsToDeploy.indexOf(pairSymbol)].address, symbolHash: keccak256(pairSymbol), baseUnit: uint(1e18), priceSource: PriceSource.REPORTER, fixedPrice: 0, uniswapMarket: pairBySymbol[pairSymbol], isUniswapReversed: isReseved[pairSymbol]};
        console.log('>>', pairSymbol, pair);
        custom.push(pair);
      });
      return custom;
    }

    const cvpToken = networkId === 42 ? await MockCVP.at('0x86D0FFCf65eE225217e0Fe85DDB2B79A8CE7eDE2') : await MockCVP.new(ether(2e9));
    console.log('>>> CVP Token deployed at', cvpToken.address);

    fs.writeFileSync('./tmp/latestStakingDeployArguments.js', `module.exports = ${JSON.stringify(
      [cvpToken.address, deployer],
      null,
      2
    )}`);

    console.log('>>> Deploying PowerOracleStaking...');
    const staking = await deployProxied(
      PowerOracleStaking,
      [cvpToken.address, deployer],
      [deployer, constants.ZERO_ADDRESS, MIN_SLASHING_DEPOSIT, SLASHER_REWARD_PCT, RESERVOIR_REWARD_PCT],
      { proxyAdminOwner: OWNER }
    );
    console.log('>>> PowerOracleStaking (proxy) deployed at', staking.address);
    console.log('>>> PowerOracleStaking implementation deployed at', staking.initialImplementation.address);

    console.log('>>> Deploying PowerOracle...');
    const tokenConfigs = getTokenConfigs();
    fs.writeFileSync('./tmp/latestOracleDeployArguments.js', `module.exports = ${JSON.stringify(
      [cvpToken.address, RESERVOIR, ANCHOR_PERIOD, tokenConfigs],
      null,
      2
    )}`);
    const oracle = await deployProxied(
      PowerOracle,
      [cvpToken.address, RESERVOIR, ANCHOR_PERIOD, tokenConfigs],
      [OWNER, staking.address, CVP_APY, TOTAL_REPORTS_PER_YEAR, GAS_EXPENSES_PER_ASSET_REPORT, GAS_PRICE_LIMIT, MIN_REPORT_INTERVAL, MAX_REPORT_INTERVAL],
      { proxyAdminOwner: OWNER }
    );
    console.log('>>> PowerOracle (proxy) deployed at', oracle.address);
    console.log('>>> PowerOracle implementation deployed at', oracle.initialImplementation.address);
    console.log('>>> PowerOracleStaking (proxy) deployed at', staking.address);
    console.log('>>> PowerOracleStaking implementation deployed at', staking.initialImplementation.address);
    console.log('>>> Factory deployed at', factory.address);
    console.log('>>> Router is deployed at', router.address)
    console.log('>>> WETH deployed at', deployedTokens[totalErc20StubsToDeploy.indexOf('ETH')].address);
    console.log('>>> USDC deployed at', deployedTokens[totalErc20StubsToDeploy.indexOf('USDC')].address);

    console.log('>>> Setting powerOracle address in powerOracleStaking');
    await staking.setPowerOracle(oracle.address);

    console.log('>>> Transferring powerStaking address to the owner');
    await staking.transferOwnership(OWNER);

    console.log('>>> Approving 10 000 CVP from fake reservoir (deployer) to PowerOracle');
    await cvpToken.approve(oracle.address, ether(100000));

    console.log('>>> Making the initial poke');
    await oracle.poke(withPairKeys.filter(p => p !== 'USDC'));

    console.log('Done');
  });

module.exports = {};
