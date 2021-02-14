/* global task */
require('@nomiclabs/hardhat-truffle5');

const pIteration = require('p-iteration');

task('deploy-testnet', 'Deploys testnet contracts')
  .setAction(async () => {
    const { deployProxied, ether, gwei, keccak256 } = require('../test/helpers');
    const { getTokenConfigs } = require('../test/localHelpers');
    const { constants } = require('@openzeppelin/test-helpers');

    // const REPORT_REWARD_IN_ETH = ether('0.05');
    // const MAX_CVP_REWARD = ether(15);
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
    const POOL_ADDRESS = '0x56038007b8de3CDbFd19da17909DBDc2bB5c0c45';

    const PowerPoke = artifacts.require('PowerPoke');
    const PowerPokeStaking = artifacts.require('PowerPokeStaking');
    const PowerOracle = artifacts.require('PowerOracle');
    const MockWETH = artifacts.require('MockWETH');
    const MockFastGasOracle = artifacts.require('MockFastGasOracle');

    const { web3 } = PowerPokeStaking;

    PowerPokeStaking.numberFormat = 'String';
    PowerOracle.numberFormat = 'String';

    const [deployer] = await web3.eth.getAccounts();
    console.log('Deployer address is', deployer);

    console.log('>>> Deploying CVP token...');
    const cvpToken = await MockCVP.at('0xc7ee325C2F3aDAC5256D38A55A0d1374B9c6f87B');
    console.log('>>> CVP Token deployed at', cvpToken.address);

    const mockWeth = await MockWETH.new();
    const uniswapRouter = mockWeth;
    const mockFastOracle = await MockFastGasOracle.new(gwei(2));

    console.log('\n>>> Deploying PowerPokeStaking...');
    const staking = await deployProxied(
      PowerPokeStaking,
      [cvpToken.address],
      [deployer, RESERVOIR, constants.ZERO_ADDRESS, SLASHER_REWARD_PCT, RESERVOIR_REWARD_PCT, 60 * 5, 60 * 5],
      { proxyAdminOwner: OWNER }
    );
    console.log('>>> PowerPokeStaking (proxy) deployed at', staking.address);
    console.log('>>> PowerPokeStaking implementation deployed at', staking.initialImplementation.address);

    console.log('\n>>> Deploying PowerPoke...');
    const powerPoke = await deployProxied(
      PowerPoke,
      [cvpToken.address, mockWeth.address, mockFastOracle.address, uniswapRouter.address, staking.address],
      [deployer, constants.ZERO_ADDRESS],
      { proxyAdminOwner: OWNER }
    );
    console.log('>>> PowerPoke (proxy) deployed at', powerPoke.address);
    console.log('>>> PowerPoke implementation deployed at', powerPoke.initialImplementation.address);

    await staking.setSlasher(powerPoke.address);

    console.log('\n>>> Deploying PowerOracle...');
    let oracle;
    let tokensSymbols = [];
    if(POOL_ADDRESS) {
      const IUniswapV2Factory = artifacts.require('IUniswapV2Factory');
      const IERC20 = artifacts.require('IERC20Detailed');
      // const BPool = artifacts.require('BPoolInterface');
      // const bpool = await BPool.at(POOL_ADDRESS);
      const uniswapFactory = await IUniswapV2Factory.at('0x4b2387242d2E1415A7Ce9ee584082d4B9d796061');
      const wethAddress = '0xed0F538448Cc27B1deF57feAc43201C79e6bDCf7';
      const usdcAddress = '0xdbb2b2550bd5f6091756ed9bb674388283d42bf4';
      const tokensConfig = [
        {cToken: wethAddress, underlying: wethAddress, symbolHash: keccak256('ETH'), baseUnit: ether(1), priceSource: 2, fixedPrice: 0, uniswapMarket: await uniswapFactory.getPair(usdcAddress, wethAddress), isUniswapReversed: true},
      ];
      tokensSymbols.push('ETH');
      const poolTokens = [
        '0xB771f325877b18977A44e2A26c9B202E3a2F4E80',
        '0x07e081Bcc6Cd8B7Cb68D4B9dB36B46Dd9663E8b4',
        '0x8D27d7cb7569467FA1d2f860c90e5C0D79dC10FD',
        '0xD6bf1F32da9F194e3b5aaf40c056F5079317bE89',
        '0xB76C1c2C49ccB707De99DbE207dd8eAEDF9aA751',
        '0x73c82a86866699E6ecE9cE5b3113F4B63A93AF87',
        '0xb0b4f73240Ed3907e2550F35397D266E4E86A3a8',
        '0xED98CaEe836eA4dABbD5FDD9b2c34AB26a47FD41'
      ]; // = pool.getCurrentTokens();

      await pIteration.forEach(poolTokens, async (tokenAddr) => {
        const token = await IERC20.at(tokenAddr);
        const symbol = await token.symbol();
        tokensSymbols.push(symbol);
        tokensConfig.push({cToken: tokenAddr, underlying: tokenAddr, symbolHash: keccak256(symbol), baseUnit: ether(1), priceSource: 2, fixedPrice: 0, uniswapMarket: await uniswapFactory.getPair(tokenAddr, wethAddress), isUniswapReversed: false})
      })
      oracle = await deployProxied(
        PowerOracle,
        [cvpToken.address, ANCHOR_PERIOD, tokensConfig],
        [OWNER, powerPoke.address],
        { proxyAdminOwner: OWNER }
      );
    } else {
      const tokenConfigs = await getTokenConfigs(cvpToken.address);
      tokensSymbols = ['ETH', 'DAI', 'REP', 'BTC', 'CVP'];
      oracle = await deployProxied(
        PowerOracle,
        [cvpToken.address, ANCHOR_PERIOD, tokenConfigs],
        [OWNER, powerPoke.address],
        { proxyAdminOwner: OWNER }
      );
    }
    console.log('>>> PowerOracle (proxy) deployed at', oracle.address);
    console.log('>>> PowerOracle implementation deployed at', oracle.initialImplementation.address);

    console.log('>>> Setting powerOracle address in powerOracleStaking');
    await powerPoke.setOracle(oracle.address);

    await powerPoke.addClient(oracle.address, OWNER, false, gwei(1.5), MIN_REPORT_INTERVAL, MAX_REPORT_INTERVAL);
    await powerPoke.setMinimalDeposit(oracle.address, MIN_SLASHING_DEPOSIT);

    console.log('>>> Transferring powerStaking address to the owner');
    await staking.transferOwnership(OWNER);
    await powerPoke.transferOwnership(OWNER);
    await oracle.transferOwnership(OWNER);

    console.log('>>> Approving 10 000 CVP from fake reservoir (deployer) to PowerOracle');
    await cvpToken.approve(oracle.address, 10000);

    console.log('>>> Making the initial poke');
    console.log('tokensSymbols', tokensSymbols)
    await oracle.poke(tokensSymbols);

    console.log('Done');
  });

module.exports = {};
