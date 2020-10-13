const fs = require('fs');
usePlugin('@nomiclabs/buidler-truffle5');
const pIteration = require('p-iteration');


task('deploy-testnet', 'Deploys testnet contracts')
  .setAction(async (taskArgs) => {
    const { deployProxied, ether, address, keccak256, uint } = require('../test/helpers');
    const { constants } = require('@openzeppelin/test-helpers');

    const I1E30 = '1000000000000000000000000000000';
    const REPORT_REWARD_IN_ETH = ether('0.05');
    const MAX_CVP_REWARD = ether(15);
    const ANCHOR_PERIOD = 30;
    const MIN_REPORT_INTERVAL = 60;
    const MAX_REPORT_INTERVAL = 90;
    const MIN_SLASHING_DEPOSIT = ether(40);
    const SLASHER_REWARD_PCT = ether(15);
    const RESERVOIR_REWARD_PCT = ether(5);
    const MockCVP = artifacts.require('MockCVP');
    const OWNER = '0xe7F2f6bb028E2c01C2C34e01BFFe5f534E7f1901';
    // The same as deployer
    // const RESERVOIR = '0x0A243E1867F682D6c6e7b446a43800977ff58024';
    const RESERVOIR = '0xfE2AB24d7855093E3d90aa298a676FEDA9fab7a0';

    const PowerOracleStaking = artifacts.require('PowerOracleStaking');
    const PowerOracle = artifacts.require('PowerOracle');
    const MockERC20 = artifacts.require('MockERC20');
    const MockUniswapFactory = artifacts.require('UniswapV2Factory');
    const MockUniswapV2Router02 = artifacts.require('UniswapV2Router02');

    const { web3 } = PowerOracleStaking;

    PowerOracleStaking.numberFormat = 'String';
    PowerOracle.numberFormat = 'String';

    const networkId = await web3.eth.net.getId();
    const [deployer] = await web3.eth.getAccounts();
    console.log('Deployer address is', deployer);

    const PriceSource = {
      FIXED_ETH: 0,
      FIXED_USD: 1,
      REPORTER: 2
    };
    const FIXED_ETH_AMOUNT = 0.005e18;

    const dummyAddress = address(0);

    const uniswapPairs = require('../config/uniswapPairs');
    const withPairKeys = Object.keys(uniswapPairs.withPair);
    withPairKeys.push('USDC');
    const cToken = {};
    const totalErc20StubsToDeploy = withPairKeys.concat(uniswapPairs.noPair);

    totalErc20StubsToDeploy.forEach((k, i) => {
      cToken[k] = address(i + 1);
    });
    console.log('>>> cToken to deploy', cToken);

    console.log('>>> Deploying underlying token stubs...');
    const deployed = await pIteration.mapSeries(totalErc20StubsToDeploy, (k) => {
      return MockERC20.new(k, k, I1E30);
    });

    console.log('>>> Stub tokens deployed');
    console.log('>>> Deploying uniswap factory...');
    const factory = await MockUniswapFactory.new(deployer);
    console.log('>>> Factory deployed at', factory.address);

    console.log('>>> Deploying uniswap router...');
    const router = await MockUniswapV2Router02.new(factory.address, deployed[totalErc20StubsToDeploy.indexOf('USDT')].address);

    console.log('>>> Deploying uniswap pairs...');

    console.log('withPairKeys', withPairKeys);
    const pairBySymbol = {};

    const deployedPairs = await pIteration.mapSeries(withPairKeys, async (symbol) => {
      if (['ETH', 'USDT'].includes(symbol)) {
        return;
      }
      const token1 = deployed[totalErc20StubsToDeploy.indexOf(symbol)].address;
      const token2 = deployed[totalErc20StubsToDeploy.indexOf('ETH')].address;

      return {
        symbol,
        res: await factory.createPair(token1, token2)
      };
    }).then(arr => arr.filter(v => v).map(({res, symbol}) => {
      pairBySymbol[symbol] = res.logs[0].args.pair;
      if(symbol === 'USDC') {
        pairBySymbol['ETH'] = res.logs[0].args.pair;
      }
      return res.logs[0].args.pair;
    }));
    console.log('>>> Deployed pairs', deployedPairs);

    console.log('>>> Depositing to uniswap pairs...');

    const snapshot = JSON.parse(fs.readFileSync('./tmp/pairValues.json').toString('utf-8'));
    for (const symbol of withPairKeys) {
      if (symbol === 'ETH') {
        continue;
      }
      console.log('>>> Adding liquidity to', symbol);
      const token1 = await MockERC20.at(deployed[totalErc20StubsToDeploy.indexOf(symbol)].address);
      const token2 = await MockERC20.at(deployed[totalErc20StubsToDeploy.indexOf('ETH')].address);

      await token1.approve(router.address, snapshot[symbol] ? snapshot[symbol].reserve0 : ether('1000'));
      await token2.approve(router.address, snapshot[symbol] ? snapshot[symbol].reserve1 : ether('1000'));

      await router.addLiquidity(
        token1.address,
        token2.address,
        // snapshot[symbol].reserve0,
        // snapshot[symbol].reserve1,
        ether('5'),
        ether('5'),
        0,
        0,
        deployer,
        1702603082,
      )
    }

    let custom;
    async function getTokenConfigs() {
      custom = [
        {cToken: cToken.ETH, underlying: deployed[totalErc20StubsToDeploy.indexOf('ETH')].address, symbolHash: keccak256('ETH'), baseUnit: ether(1), priceSource: PriceSource.REPORTER, fixedPrice: 0, uniswapMarket: pairBySymbol.ETH, isUniswapReversed: true},
        // {cToken: cToken.USDT, underlying: deployed[totalErc20StubsToDeploy.indexOf('USDT')].address, symbolHash: keccak256('USDT'), baseUnit: uint(1e6), priceSource: PriceSource.FIXED_USD, fixedPrice: uint(1e6), uniswapMarket: address(0), isUniswapReversed: false},
        // {cToken: cToken.USDC, underlying: deployed[totalErc20StubsToDeploy.indexOf('USDC')].address, symbolHash: keccak256('USDC'), baseUnit: uint(1e6), priceSource: PriceSource.FIXED_USD, fixedPrice: uint(1e6), uniswapMarket: address(0), isUniswapReversed: false},
      ];

      withPairKeys.forEach(pairSymbol => {
        if(!pairBySymbol[pairSymbol]) {
          return;
        }
        custom.push(
          {cToken: cToken[pairSymbol], underlying: deployed[totalErc20StubsToDeploy.indexOf(pairSymbol)].address, symbolHash: keccak256(pairSymbol), baseUnit: uint(1e18), priceSource: PriceSource.REPORTER, fixedPrice: 0, uniswapMarket: pairBySymbol[pairSymbol], isUniswapReversed: false},
        )
      });
      return custom;
      // console.log('custom>', custom);
    }
    await getTokenConfigs();

    console.log('>>> Deploying CVP token...');
    const cvpToken = networkId === 42 ? await MockCVP.at('0x86D0FFCf65eE225217e0Fe85DDB2B79A8CE7eDE2') : await MockCVP.new(deployer);
    console.log('>>> CVP Token deployed at', cvpToken.address);

    console.log('>>> Deploying PowerOracleStaking...');
    const staking = await deployProxied(
      PowerOracleStaking,
      [cvpToken.address],
      [deployer, constants.ZERO_ADDRESS, MIN_SLASHING_DEPOSIT, SLASHER_REWARD_PCT, RESERVOIR_REWARD_PCT, '1'],
      { proxyAdminOwner: OWNER }
    );
    console.log('>>> PowerOracleStaking (proxy) deployed at', staking.address);
    console.log('>>> PowerOracleStaking implementation deployed at', staking.initialImplementation.address);

    console.log('>>> Deploying PowerOracle...');
    const oracle = await deployProxied(
      PowerOracle,
      [cvpToken.address, RESERVOIR, ANCHOR_PERIOD, await getTokenConfigs()],
      [OWNER, staking.address, REPORT_REWARD_IN_ETH, MAX_CVP_REWARD, MIN_REPORT_INTERVAL, MAX_REPORT_INTERVAL],
      { proxyAdminOwner: OWNER }
    );
    console.log('>>> PowerOracle (proxy) deployed at', oracle.address);
    console.log('>>> PowerOracle implementation deployed at', oracle.initialImplementation.address);

    console.log('>>> Setting powerOracle address in powerOracleStaking');
    await staking.setPowerOracle(oracle.address);

    console.log('>>> Transferring powerStaking address to the owner');
    await staking.transferOwnership(OWNER);

    console.log('>>> Approving 10 000 CVP from fake reservoir (deployer) to PowerOracle');
    await cvpToken.approve(oracle.address, 10000);

    console.log('>>> Making the initial poke');
    await oracle.poke(withPairKeys.filter(s => pairBySymbol[s]));

    console.log('Done');
  });

module.exports = {};
