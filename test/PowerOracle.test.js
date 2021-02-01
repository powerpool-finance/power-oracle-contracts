const { constants, time, expectEvent } = require('@openzeppelin/test-helpers');
const { address, kether, ether, mwei, gwei, tether, deployProxied, getResTimestamp, keccak256, fetchLogs } = require('./helpers');
const { getTokenConfigs } = require('./localHelpers');

const { solidity } = require('ethereum-waffle');

const chai = require('chai');
const MockCVP = artifacts.require('MockCVP');
const MockStaking = artifacts.require('MockStaking');
const StubOracle = artifacts.require('StubOracle');
const MockOracle = artifacts.require('MockOracle');
const PowerPoke = artifacts.require('PowerPoke');
const MockFastGasOracle = artifacts.require('MockFastGasOracle');

chai.use(solidity);
const { expect } = chai;

MockCVP.numberFormat = 'String';
MockStaking.numberFormat = 'String';
StubOracle.numberFormat = 'String';
MockOracle.numberFormat = 'String';
PowerPoke.numberFormat = 'String';

const ETH_SYMBOL_HASH = keccak256('ETH');
const CVP_SYMBOL_HASH = keccak256('CVP');
const USDT_SYMBOL_HASH = keccak256('USDT');
const CVP_REPORT_APY = ether(20);
const CVP_SLASHER_UPDATE_APY = ether(10);
const TOTAL_REPORTS_PER_YEAR = '90000';
const TOTAL_SLASHER_UPDATES_PER_YEAR = '50000';
const GAS_EXPENSES_PER_ASSET_REPORT = '110000';
const GAS_EXPENSES_FOR_SLASHER_UPDATE = '84000';
const GAS_EXPENSES_FOR_POKE_SLASHER_UPDATE = '117500';
const GAS_PRICE_LIMIT = gwei(1000);
const ANCHOR_PERIOD = '45';
const MIN_REPORT_INTERVAL = '30';
const MIN_REPORT_INTERVAL_INT = 30;
const MAX_REPORT_INTERVAL = '90';
const MAX_REPORT_INTERVAL_INT = 90;
const WETH = address(111);

function expectPriceUpdateEvent(config) {
  const { response, tokenSymbols, oldTimestamp, newTimestamp } = config;
  tokenSymbols.forEach(symbol => {
    expectEvent(response, 'AnchorPriceUpdated', {
      symbol: symbol,
      oldTimestamp,
      newTimestamp
    });
  })
}

function expectPriceToNotUpdateEvent(config) {
  const { response, tokenSymbols, oldTimestamp, newTimestamp } = config;
  tokenSymbols.forEach(symbol => {
    expectEvent.notEmitted(response, 'AnchorPriceUpdated', {
      symbol: symbol,
      oldTimestamp,
      newTimestamp
    });
  })
}

function expectMockedPriceUpdateEvent(config) {
  const { response, tokenSymbols } = config;
  tokenSymbols.forEach(symbol => {
    expectEvent(response, 'MockFetchMockedAnchorPrice', {
      symbol: symbol
    });
  })
}

function expectMockedPriceToNotUpdateEvent(config) {
  const { response, tokenSymbols } = config;
  tokenSymbols.forEach(symbol => {
    expectEvent.notEmitted(response, 'MockFetchMockedAnchorPrice', {
      symbol: symbol
    });
  })
}

describe('PowerOracle', function () {
  let staking;
  let poke;
  let oracle;
  let cvpToken;
  let fastGasOracle;
  let powerPokeOpts;

  let deployer, owner, oracleClientOwner, reservoir, alice, bob, dan, danSlasher, validReporterPoker, validSlasherPoker, sink, uniswapRouter;

  before(async function() {
    [deployer, owner, oracleClientOwner, reservoir, alice, bob, dan, danSlasher, validReporterPoker, validSlasherPoker, sink, uniswapRouter] = await web3.eth.getAccounts();
    fastGasOracle = await MockFastGasOracle.new(gwei(300 * 1000));

    powerPokeOpts = web3.eth.abi.encodeParameter(
      {
        PowerPokeRewardOpts: {
          to: 'address',
          rewardsInEth: 'bool'
        },
      },
      {
        to: alice,
        rewardsInEth: false
      },
    );
  });

  beforeEach(async function() {
    cvpToken = await MockCVP.new(ether(1000000));
    staking = await MockStaking.new(cvpToken.address);

    // poke = await PowerPoke.new(cvpToken.address, WETH, fastGasOracle.address, uniswapRouter, staking.address);
    poke = await deployProxied(
      PowerPoke,
      [cvpToken.address, WETH, fastGasOracle.address, uniswapRouter, staking.address],
      [owner, sink],
      { proxyAdminOwner: owner }
    );
    oracle = await deployProxied(
      StubOracle,
      [cvpToken.address, reservoir, ANCHOR_PERIOD, await getTokenConfigs(cvpToken.address)],
      [owner, poke.address],
      { proxyAdminOwner: owner }
    );

    await poke.setOracle(oracle.address, { from: owner });
    await cvpToken.transfer(reservoir, ether(100000), { from: deployer });
    await cvpToken.transfer(alice, ether(100000), { from: deployer });
    await cvpToken.approve(oracle.address, ether(100000), { from: reservoir });
  });

  describe('initialization', () => {
    it('should assign constructor and initializer args correctly', async function() {
      expect(await oracle.owner()).to.be.equal(owner);
      expect(await oracle.powerPoke()).to.be.equal(poke.address);
      expect(await oracle.anchorPeriod()).to.be.equal(ANCHOR_PERIOD);
      expect(await oracle.CVP_TOKEN()).to.be.equal(cvpToken.address);
    });

    it('should deny initializing again', async function() {
      await expect(oracle.initialize(owner, poke.address))
        .to.be.revertedWith('Contract instance has already been initialized')
    });
  })

  describe('pokeFromReporter', () => {
    beforeEach(async () => {
      await staking.mockSetUser(1, alice, validReporterPoker, ether(300));
      await staking.mockSetReporter(1, ether(300));

      // Add client
      await poke.addClient(oracle.address, oracleClientOwner, true, gwei(300), MIN_REPORT_INTERVAL, MAX_REPORT_INTERVAL, { from: owner });
      await cvpToken.approve(poke.address, ether(30000), { from: alice })
      await poke.addCredit(oracle.address, ether(30000), { from: alice });
      await poke.setCompensationPlan(oracle.address, 1,  25, 17520000, 100 * 1000, { from: oracleClientOwner });
    });

    it('should allow a valid reporter calling the method', async function() {
      await oracle.pokeFromReporter(1, ['CVP', 'REP'], powerPokeOpts, { from: validReporterPoker });
    });

    it('should deny another user calling an behalf of reporter', async function() {
      await expect(oracle.pokeFromReporter(1, ['CVP', 'REP'], powerPokeOpts, { from: bob }))
        .to.be.revertedWith('PowerPokeStaking::authorizeHDH: Invalid poker key');
    });

    it('should deny calling with an empty array', async function() {
      await expect(oracle.pokeFromReporter(1, [], powerPokeOpts, { from: validReporterPoker }))
        .to.be.revertedWith('MISSING_SYMBOLS');
    });

    it('should deny poking with unknown token symbols', async function() {
      await expect(oracle.pokeFromReporter(1, ['FOO'], powerPokeOpts, { from: validReporterPoker }))
        .to.be.revertedWith('TOKEN_NOT_FOUND');
    });

    it('should deny poking with unknown token symbols', async function() {
      await expect(oracle.pokeFromReporter(1, ['FOO'], powerPokeOpts, { from: validReporterPoker }))
        .to.be.revertedWith('TOKEN_NOT_FOUND');
    });

    it('should deny poking when the contract is paused', async function() {
      await oracle.pause({ from: owner });
      await expect(oracle.pokeFromReporter(1, ['REP'], powerPokeOpts, { from: validReporterPoker }))
        .to.be.revertedWith('PAUSED');
    });

    describe('rewards', () => {
      beforeEach(async function() {
        oracle = await deployProxied(
          MockOracle,
          [cvpToken.address, reservoir, ANCHOR_PERIOD, await getTokenConfigs(cvpToken.address)],
          [owner, poke.address],
          { proxyAdminOwner: owner }
        );
        await poke.addClient(oracle.address, oracleClientOwner, true, gwei(300), MIN_REPORT_INTERVAL, MAX_REPORT_INTERVAL, { from: owner });
        await poke.setOracle(oracle.address, { from: owner });

        await cvpToken.approve(poke.address, ether(30000), { from: alice })
        await poke.addCredit(oracle.address, ether(30000), { from: alice });
        await poke.setCompensationPlan(oracle.address, 1,  25, 17520000, 100 * 1000, { from: oracleClientOwner });

        await oracle.mockSetAnchorPrice('ETH', mwei('320'));
        await oracle.mockSetAnchorPrice('CVP', mwei('5'));
        await staking.mockSetUser(1, alice, validReporterPoker, kether(270));
        // NOTICE: so the 1 token reward with 35 gwei gas price is
        // `1 (count) * 0.6 + 0.2464 = 0.8464 CVP`
      })

      it('should assign ETH/CVP prices correctly', async function() {
        await oracle.pokeFromReporter(1, ['REP'], powerPokeOpts, { from: validReporterPoker });
        expect(await oracle.getPriceBySymbol('ETH')).to.be.equal(mwei('320'))
        expect(await oracle.getPriceBySymbol('CVP')).to.be.equal(mwei('5'))
      });

      it('should update CVP/ETH along with other tokens', async function() {
        const res = await oracle.pokeFromReporter(1, ['REP', 'DAI'], powerPokeOpts, { from: validReporterPoker, gasPrice: gwei(35) });
        const resTimestamp = await getResTimestamp(res);

        expectMockedPriceUpdateEvent({
          response: res,
          tokenSymbols: ['ETH', 'CVP'],
        });
        expectPriceUpdateEvent({
          response: res,
          tokenSymbols: ['REP', 'DAI'],
          oldTimestamp: '0',
          newTimestamp: resTimestamp
        });
        expectEvent(res, 'PokeFromReporter', {
          reporterId: '1',
          tokenCount: '2',
          rewardCount: '2'
        });
        await expectEvent.inTransaction(res.tx, poke, 'RewardUser', {
          userId: '1',
          userDeposit: kether(270),
          bonusCVP: ether('1.155821917808219178')
          // calculatedReward: ether('1.6928')
        });
      });

      it('should revert if there is no token updated', async function() {
        await oracle.pokeFromReporter(1, ['CVP', 'REP'], powerPokeOpts, { from: validReporterPoker, gasPrice: gwei(35) });
        await time.increase(10);
        // expect(await poke.rewards(1)).to.be.equal(ether('0.8464'));

        await expect(oracle.pokeFromReporter(1, ['CVP', 'REP'], powerPokeOpts, { from: validReporterPoker, gasPrice: gwei(35) }))
          .to.be.revertedWith('NOTHING_UPDATED');
      });

      it('should partially update on partially outdated prices', async function() {
        // 1st poke
        let res = await oracle.pokeFromReporter(1, ['CVP', 'REP', 'DAI', 'BTC'], powerPokeOpts, { from: validReporterPoker, gasPrice: gwei(35) });
        const firstTimestamp = await getResTimestamp(res);
        // expect(await poke.rewards(1)).to.be.equal(ether('2.823133703013698630'));

        await time.increase(MIN_REPORT_INTERVAL_INT - 5);

        // 2nd poke
        res = await oracle.poke(['BTC'], { from: bob, gasPrice: gwei(35) });
        // expect(await poke.rewards(1)).to.be.equal(ether('3.334873595616438356'));
        expectEvent.notEmitted(res, 'AnchorPriceUpdated');

        await time.increase(20);

        // 3rd poke
        res = await oracle.pokeFromReporter(1, ['REP', 'DAI', 'BTC'], powerPokeOpts, { from: validReporterPoker, gasPrice: gwei(35) });
        const thirdTimestamp = await getResTimestamp(res);

        expect((await oracle.prices(ETH_SYMBOL_HASH)).timestamp).to.be.equal(thirdTimestamp);
        // expect(await poke.rewards(1)).to.be.equal(ether('4.524355300821917808'));

        expectMockedPriceUpdateEvent({
          response: res,
          tokenSymbols: ['ETH', 'CVP'],
        });
        expectPriceUpdateEvent({
          response: res,
          tokenSymbols: ['REP', 'DAI', 'BTC'],
          oldTimestamp: firstTimestamp,
          newTimestamp: thirdTimestamp
        })
        expectEvent(res, 'PokeFromReporter', {
          reporterId: '1',
          tokenCount: '3',
          rewardCount: '3'
        });
        await expectEvent.inTransaction(res.tx, poke, 'RewardUser', {
          userId: '1',
          userDeposit: kether(270),
          bonusCVP: ether('1.541095890410958904')
          // calculatedReward: ether('2.5392')
        });
      });

      it('should fully update on fully outdated prices', async function() {
        // 1st poke
        let res = await oracle.pokeFromReporter(1, ['CVP', 'REP', 'DAI', 'BTC'], powerPokeOpts, { from: validReporterPoker, gasPrice: gwei(35) });
        const firstTimestamp = await getResTimestamp(res);
        // expect(await poke.rewards(1)).to.be.equal(ether('2.361699730410958904'));

        await time.increase(MIN_REPORT_INTERVAL_INT - 5);

        // 2nd poke
        await oracle.poke(['BTC'], { from: bob, gasPrice: gwei(35) });
        // expect(await poke.rewards(1)).to.be.equal(ether('2.951588743013698630'));
        // NOTICE: the only difference with the example above
        await time.increase(120);

        // 3rd poke
        res = await oracle.pokeFromReporter(1, ['REP', 'DAI', 'BTC'], powerPokeOpts, { from: validReporterPoker, gasPrice: gwei(35) });
        const thirdTimestamp = await getResTimestamp(res);

        expect((await oracle.prices(ETH_SYMBOL_HASH)).timestamp).to.be.equal(thirdTimestamp);

        expectMockedPriceUpdateEvent({
          response: res,
          tokenSymbols: ['ETH', 'CVP'],
        });
        expectPriceUpdateEvent({
          response: res,
          tokenSymbols: ['REP', 'DAI', 'BTC'],
          oldTimestamp: firstTimestamp,
          newTimestamp: thirdTimestamp
        })
        expectEvent(res, 'PokeFromReporter', {
          reporterId: '1',
          tokenCount: '3',
          rewardCount: '3'
        });
        await expectEvent.inTransaction(res.tx, poke, 'RewardUser', {
          client: oracle.address,
          userId: '1',
          rewardInETH: false,
          // gasUsed: '306480',
          gasPrice: gwei(35),
          userDeposit: kether(270),
          // gasCompensationCVP: '686515200000000000',
          ethPrice: '320000000',
          cvpPrice: '5000000',
          // calculatedReward: ether('2.227611090410958904')
        });
      });
    });
  });

  describe('pokeFromSlasher', () => {
    beforeEach(async () => {
      oracle = await deployProxied(
        MockOracle,
        [cvpToken.address, reservoir, ANCHOR_PERIOD, await getTokenConfigs(cvpToken.address)],
        [owner, staking.address, CVP_REPORT_APY, CVP_SLASHER_UPDATE_APY, TOTAL_REPORTS_PER_YEAR, TOTAL_SLASHER_UPDATES_PER_YEAR, GAS_EXPENSES_PER_ASSET_REPORT, GAS_EXPENSES_FOR_SLASHER_UPDATE, GAS_EXPENSES_FOR_POKE_SLASHER_UPDATE, GAS_PRICE_LIMIT, MIN_REPORT_INTERVAL, MAX_REPORT_INTERVAL],
        { proxyAdminOwner: owner }
      );

      await cvpToken.transfer(alice, ether(400), { from: deployer });
      await cvpToken.approve(staking.address, ether(400), { from: alice });
      await staking.createUser(alice, validReporterPoker, ether(300), { from: alice });
      await staking.createUser(alice, validSlasherPoker, ether(100), { from: alice });

      await time.increase(MAX_REPORT_INTERVAL_INT + 1);
    });

    it('should allow a valid slasher calling a method when all token prices are outdated', async function() {
      let res = await oracle.pokeFromReporter(1, ['REP', 'DAI', 'BTC'], { from: validReporterPoker });
      const firstTimestamp = await getResTimestamp(res);
      await time.increase(MAX_REPORT_INTERVAL_INT + 5);

      res = await oracle.pokeFromSlasher(2, ['REP', 'DAI', 'BTC'], { from: validSlasherPoker });
      const secondTimestamp = await getResTimestamp(res);

      expectEvent.notEmitted(res, 'RewardUserSlasherUpdate');
      expectEvent(res, 'PokeFromSlasher', {
        slasherId: '2',
        tokenCount: '3',
        overdueCount: '3'
      });
      expectEvent(res, 'RewardUserReport', {
        userId: '2',
        count: '3'
      });
      expectPriceUpdateEvent({
        response: res,
        tokenSymbols: ['ETH', 'CVP', 'REP', 'DAI', 'BTC'],
        oldTimestamp: firstTimestamp,
        newTimestamp: secondTimestamp
      })

      expectEvent.inTransaction(res.tx, MockStaking, 'MockSlash', {
        userId: '2',
        overdueCount: '3'
      });
    });

    it('should allow a valid slasher calling a method when prices are partially outdated', async function() {
      // 1st poke
      let res = await oracle.pokeFromReporter(1, ['REP', 'DAI', 'BTC'], { from: validReporterPoker });
      await time.increase(MAX_REPORT_INTERVAL_INT + 5);
      const firstTimestamp = await getResTimestamp(res);

      // 2nd poke
      res = await oracle.pokeFromReporter(1, ['REP'], { from: validReporterPoker });
      const secondTimestamp = await getResTimestamp(res);

      expectPriceUpdateEvent({
        response: res,
        tokenSymbols: ['ETH', 'CVP', 'REP'],
        oldTimestamp: firstTimestamp,
        newTimestamp: secondTimestamp
      });

      res = await oracle.slasherUpdate(2, { from: validSlasherPoker });
      const slasherUpdateTimestamp = await getResTimestamp(res);
      await time.increase(5);

      expect(await oracle.lastSlasherUpdates(2)).to.be.equal(slasherUpdateTimestamp);

      await expect(oracle.pokeFromSlasher(2, ['CVP', 'REP', 'DAI', 'BTC'], { from: validSlasherPoker, gasPrice: gwei(35) }))
        .to.be.revertedWith('BELLOW_REPORT_INTERVAL_DIFF');

      await time.increase(MAX_REPORT_INTERVAL_INT - MIN_REPORT_INTERVAL_INT);

      // 3rd poke
      res = await oracle.pokeFromSlasher(2, ['CVP', 'REP', 'DAI', 'BTC'], { from: validSlasherPoker });
      const thirdTimestamp = await getResTimestamp(res);

      expectEvent.notEmitted(res, 'RewardUserSlasherUpdate');
      expectEvent(res, 'PokeFromSlasher', {
        slasherId: '2',
        tokenCount: '4',
        overdueCount: '2'
      });
      expectEvent(res, 'UpdateSlasher', {
        slasherId: '2',
      });
      expectEvent(res, 'RewardUserReport', {
        userId: '2',
        count: '2'
      });
      expectPriceUpdateEvent({
        response: res,
        tokenSymbols: ['DAI', 'BTC'],
        oldTimestamp: firstTimestamp,
        newTimestamp: thirdTimestamp
      });

      expectEvent.inTransaction(res.tx, MockStaking, 'MockSlash', {
        userId: '2',
        overdueCount: '2'
      });

      await expect(oracle.pokeFromSlasher(2, ['CVP', 'REP', 'DAI', 'BTC'], { from: validSlasherPoker, gasPrice: gwei(35) }))
        .to.be.revertedWith('BELLOW_REPORT_INTERVAL');

      await expect(oracle.slasherUpdate(2, { from: validSlasherPoker }))
        .to.be.revertedWith('BELLOW_REPORT_INTERVAL');

      expect(await oracle.lastSlasherUpdates(2)).to.be.equal(thirdTimestamp);

      await expect(oracle.slasherUpdate(2, { from: validSlasherPoker }))
        .to.be.revertedWith('BELLOW_REPORT_INTERVAL');

      await time.increase(MAX_REPORT_INTERVAL_INT + 5);

      res = await oracle.slasherUpdate(2, { from: validSlasherPoker });
      const fourthTimestamp = await getResTimestamp(res);

      expect(await oracle.lastSlasherUpdates(2)).to.be.equal(fourthTimestamp);

      expectPriceUpdateEvent({
        response: res,
        tokenSymbols: ['ETH', 'CVP'],
        oldTimestamp: thirdTimestamp,
        newTimestamp: fourthTimestamp
      })
    });

    it('should not call PowerPokeStaking.slash() method if there are no prices outdated', async function() {
      await oracle.mockSetAnchorPrice('ETH', mwei('320'));
      await oracle.mockSetAnchorPrice('CVP', mwei('5'));
      // 1st poke
      await oracle.pokeFromReporter(1, ['REP', 'DAI', 'BTC'], { from: validReporterPoker });
      await time.increase(5);

      // 2nd poke
      let res = await oracle.pokeFromSlasher(2, ['CVP', 'REP', 'DAI', 'BTC'], { from: validSlasherPoker, gasPrice: gwei(35) });
      const secondTimestamp = await getResTimestamp(res);

      expectEvent(res, 'PokeFromSlasher', {
        slasherId: '2',
        tokenCount: '4',
        overdueCount: '0'
      });

      expectEvent(res, 'UpdateSlasher', {
        slasherId: '2',
      });

      expectEvent(res, 'RewardUserSlasherUpdate', {
        slasherId: '2',
        calculatedReward: ether(0.2634)
      });

      expectEvent.notEmitted(res, 'RewardUserReport');

      expectPriceToNotUpdateEvent({
        response: res,
        tokenSymbols: ['ETH', 'CVP', 'REP', 'DAI', 'BTC'],
        oldTimestamp: '0',
        newTimestamp: secondTimestamp
      })

      const logs = await fetchLogs(MockStaking, res);
      expect(logs.length).to.be.equal(0);
    });

    it('slasherUpdate should works correctly', async function() {
      // 1st poke
      let res = await oracle.pokeFromReporter(1, ['REP', 'DAI', 'BTC'], { from: validReporterPoker });
      await time.increase(5);
      const firstTimestamp = await getResTimestamp(res);

      await expect(oracle.pokeFromSlasher(1, ['CVP', 'REP', 'DAI', 'BTC'], { from: validReporterPoker, gasPrice: gwei(35) }))
        .to.be.revertedWith('PowerPokeStaking::authorizeSlasher: User is reporter');

      // 2nd poke
      res = await oracle.pokeFromSlasher(2, ['CVP', 'REP', 'DAI', 'BTC'], { from: validSlasherPoker, gasPrice: gwei(35) });
      const secondTimestamp = await getResTimestamp(res);

      expect(await oracle.lastSlasherUpdates(2)).to.be.equal(secondTimestamp);

      await expect(oracle.slasherUpdate(2, { from: validSlasherPoker }))
        .to.be.revertedWith('BELLOW_REPORT_INTERVAL');

      const thirdTimestamp = await getResTimestamp(res);

      expect(await oracle.lastSlasherUpdates(2)).to.be.equal(thirdTimestamp);
      await time.increase(MAX_REPORT_INTERVAL_INT + 5);

      res = await oracle.slasherUpdate(2, { from: validSlasherPoker });

      const fourthTimestamp = await getResTimestamp(res);

      expectPriceUpdateEvent({
        response: res,
        tokenSymbols: ['ETH', 'CVP'],
        oldTimestamp: firstTimestamp,
        newTimestamp: fourthTimestamp
      })
    });

    it('sshould deny slasherUpdate right after deposit or withdraw', async function() {
      // 1st poke
      await oracle.pokeFromReporter(1, ['REP', 'DAI', 'BTC'], { from: validReporterPoker });
      await time.increase(5);

      await cvpToken.transfer(dan, ether(1000), { from: deployer });
      await cvpToken.approve(staking.address, ether(30), { from: dan });

      await staking.createUser(dan, danSlasher, ether(30), { from: dan });

      await expect(oracle.slasherUpdate(3, { from: danSlasher }))
        .to.be.revertedWith('PowerOracle::_updateSlasherAndReward: bellow depositChangeDelta');

      await time.increase(MIN_REPORT_INTERVAL_INT);

      await expect(oracle.slasherUpdate(3, { from: danSlasher }))
        .to.be.revertedWith('PowerOracle::_updateSlasherAndReward: bellow depositChangeDelta');

      await time.increase(MAX_REPORT_INTERVAL - MIN_REPORT_INTERVAL_INT);

      let res = await oracle.slasherUpdate(3, { from: danSlasher });
      expectEvent(res, 'RewardUserSlasherUpdate', {
        slasherId: '3'
      });

      await time.increase(MAX_REPORT_INTERVAL + 1);

      await staking.withdraw('3', dan, ether(1), { from: dan });

      await expect(oracle.slasherUpdate(3, { from: danSlasher }))
        .to.be.revertedWith('PowerOracle::_updateSlasherAndReward: bellow depositChangeDelta');

      await time.increase(MIN_REPORT_INTERVAL_INT);

      await expect(oracle.slasherUpdate(3, { from: danSlasher }))
        .to.be.revertedWith('PowerOracle::_updateSlasherAndReward: bellow depositChangeDelta');

      await time.increase(MAX_REPORT_INTERVAL - MIN_REPORT_INTERVAL_INT);

      res = await oracle.slasherUpdate(3, { from: danSlasher });
      expectEvent(res, 'RewardUserSlasherUpdate', {
        slasherId: '3'
      });
    });

    it('should revert slasherUpdate when delta bellow maxReportInterval', async function() {
      // 1st poke
      let res = await oracle.pokeFromReporter(1, ['REP', 'DAI', 'BTC'], { from: validReporterPoker });
      await time.increase(5);

      res = await oracle.slasherUpdate(2, { from: validSlasherPoker });
      const secondTimestamp = await getResTimestamp(res);

      expect(await oracle.lastSlasherUpdates(2)).to.be.equal(secondTimestamp);

      // 2nd poke
      await expect(oracle.pokeFromSlasher(2, ['CVP', 'REP', 'DAI', 'BTC'], { from: validSlasherPoker, gasPrice: gwei(35) }))
        .to.be.revertedWith('BELLOW_REPORT_INTERVAL');

      await expect(oracle.slasherUpdate(2, { from: validSlasherPoker }))
        .to.be.revertedWith('BELLOW_REPORT_INTERVAL');

      await time.increase(MAX_REPORT_INTERVAL_INT + 5);

      res = await oracle.slasherUpdate(2, { from: validSlasherPoker });
      const thirdTimestamp = await getResTimestamp(res);

      expect(await oracle.lastSlasherUpdates(2)).to.be.equal(thirdTimestamp);
    });

    it('should receive correct reward by slasherUpdate method', async function() {
      await oracle.mockSetAnchorPrice('ETH', mwei('320'));
      await oracle.mockSetAnchorPrice('CVP', mwei('5'));
      // 1st poke
      await oracle.pokeFromReporter(1, ['REP', 'DAI', 'BTC'], { from: validReporterPoker });
      await time.increase(5);

      // 2nd poke
      let res = await oracle.slasherUpdate(2, { from: validSlasherPoker, gasPrice: gwei(35) });

      expectEvent(res, 'UpdateSlasher', {
        slasherId: '2',
      });

      expectEvent(res, 'RewardUserSlasherUpdate', {
        slasherId: '2',
        calculatedReward: ether(0.18836)
      });

      expectEvent.notEmitted(res, 'RewardUserReport');
    });

    it('should deny another user calling an behalf of slasher', async function() {
      await expect(oracle.pokeFromSlasher(2, ['REP'], { from: alice }))
        .to.be.revertedWith('PowerPokeStaking::authorizeSlasher: Invalid poker key');
    });

    it('should deny another user calling a slasherUpdate', async function() {
      await expect(oracle.slasherUpdate(2, { from: alice }))
        .to.be.revertedWith('PowerPokeStaking::authorizeSlasher: Invalid poker key');
    });

    it('should deny calling with an empty array', async function() {
      await expect(oracle.pokeFromSlasher(2, [], { from: validSlasherPoker }))
        .to.be.revertedWith('MISSING_SYMBOLS');
    });

    it('should deny poking with unknown token symbols', async function() {
      await expect(oracle.pokeFromSlasher(2, ['FOO'], { from: validSlasherPoker }))
        .to.be.revertedWith('TOKEN_NOT_FOUND');
    });

    it('should deny poking when the contract is paused', async function() {
      await oracle.pause({ from: owner });
      await expect(oracle.pokeFromReporter(2, ['REP'], { from: validSlasherPoker }))
        .to.be.revertedWith('PAUSED');
    });

    it('should deny slasher updating when the contract is paused', async function() {
      await oracle.pause({ from: owner });
      await expect(oracle.slasherUpdate(2, { from: validSlasherPoker }))
        .to.be.revertedWith('PAUSED');
    });
  });

  describe('poke (permissionless)', () => {
    it('should allow anyone calling the poke method', async function() {
      let res = await oracle.poke(['REP', 'DAI', 'BTC'], { from: alice });
      const firstTimestamp = await getResTimestamp(res);
      expectEvent(res, 'Poke', {
        poker: alice,
        tokenCount: '3',
      });
      expectPriceUpdateEvent({
        response: res,
        tokenSymbols: ['ETH', 'REP', 'DAI', 'BTC'],
        oldTimestamp: '0',
        newTimestamp: firstTimestamp
      })

      await time.increase(5);

      res = await oracle.poke(['REP', 'DAI', 'BTC'], { from: alice });
      expectEvent(res, 'Poke', {
        poker: alice,
        tokenCount: '3',
      });
      expectPriceToNotUpdateEvent({
        response: res,
        tokenSymbols: ['ETH', 'REP', 'DAI', 'BTC', 'CVP']
      })
    });

    it('should deny poking with an empty array', async function() {
      await expect(oracle.poke([], { from: bob }))
        .to.be.revertedWith('MISSING_SYMBOLS');
    });

    it('should deny poking with unknown token symbols', async function() {
      await expect(oracle.poke(['FOO'], { from: bob }))
        .to.be.revertedWith('TOKEN_NOT_FOUND');
    });

    it('should deny poking when the contract is paused', async function() {
      await oracle.pause({ from: owner });
      await expect(oracle.poke(['REP'], { from: bob }))
        .to.be.revertedWith('PAUSED');
    });
  });

  describe('withdrawing rewards', async function() {
    const USER_ID = 4;
    beforeEach(async () => {
      await oracle.stubSetUserReward(USER_ID, ether(250));
      await staking.mockSetUserAdmin(USER_ID, alice)
    })

    it('should allow a valid user withdrawing their rewards', async function() {
      expect(await oracle.rewards(USER_ID)).to.be.equal(ether(250));

      expect(await cvpToken.balanceOf(sink)).to.be.equal('0');
      await oracle.withdrawRewards(USER_ID, sink, { from: alice });
      expect(await cvpToken.balanceOf(sink)).to.be.equal(ether(250));

      expect(await oracle.rewards(USER_ID)).to.be.equal(ether(0));
    });

    it('should deny non-admin key withdrawing users rewards', async function() {
      await expect(oracle.withdrawRewards(USER_ID, sink, { from: bob }))
        .to.be.revertedWith('PowerPokeStaking::requireValidAdminKey: Invalid admin key');
    });

    it('should deny withdrawing to 0 address', async function() {
      await expect(oracle.withdrawRewards(USER_ID, constants.ZERO_ADDRESS, { from: alice }))
        .to.be.revertedWith('ADDRESS');
    });
  });

  describe('owner methods', () => {
    describe('setCvpAPY', () => {
      it('should allow the owner setting a new value', async function() {
        await oracle.setCvpAPY(42, 22, { from: owner });
        expect(await oracle.cvpReportAPY()).to.be.equal('42');
        expect(await oracle.cvpSlasherUpdateAPY()).to.be.equal('22');
      });

      it('should deny non-reporter calling the method', async function() {
        await expect(oracle.setCvpAPY(42, 22, { from: alice }))
          .to.be.revertedWith('NOT_THE_OWNER');
      });
    });

    describe('setTotalPerYear', () => {
      it('should allow the owner setting a new value', async function() {
        await oracle.setTotalPerYear(42, 22, { from: owner });
        expect(await oracle.totalReportsPerYear()).to.be.equal('42');
        expect(await oracle.totalSlasherUpdatesPerYear()).to.be.equal('22');
      });

      it('should deny non-reporter calling the method', async function() {
        await expect(oracle.setTotalPerYear(42, 22, { from: alice }))
          .to.be.revertedWith('NOT_THE_OWNER');
      });
    });

    describe('setGasExpenses', () => {
      it('should allow the owner setting a new value', async function() {
        await oracle.setGasExpenses(42, 22, 32, { from: owner });
        expect(await oracle.gasExpensesPerAssetReport()).to.be.equal('42');
        expect(await oracle.gasExpensesForSlasherStatusUpdate()).to.be.equal('22');
        expect(await oracle.gasExpensesForSlasherPokeStatusUpdate()).to.be.equal('32');
      });

      it('should deny non-reporter calling the method', async function() {
        await expect(oracle.setGasExpenses(42, 22, 32, { from: alice }))
          .to.be.revertedWith('NOT_THE_OWNER');
      });
    });

    describe('setGasPriceLimit', () => {
      it('should allow the owner setting value', async function() {
        await oracle.setGasPriceLimit(42, { from: owner });
        expect(await oracle.gasPriceLimit()).to.be.equal('42');
      });

      it('should deny non-reporter calling the method', async function() {
        await expect(oracle.setGasPriceLimit(42, { from: alice }))
          .to.be.revertedWith('NOT_THE_OWNER');
      });
    });

    describe('setGasPriceLimit', () => {
      it('should allow the owner setting a new report reward', async function() {
        await oracle.setPowerPokeStaking(sink, { from: owner });
        expect(await oracle.powerOracleStaking()).to.be.equal(sink);
      });

      it('should deny non-reporter calling the method', async function() {
        await expect(oracle.setPowerOracleStaking(sink, { from: alice }))
          .to.be.revertedWith('NOT_THE_OWNER');
      });
    });

    describe('setReportIntervals', () => {
      it('should allow the owner setting a new report reward', async function() {
        await oracle.setReportIntervals(222, 333, { from: owner });
        expect(await oracle.minReportInterval()).to.be.equal('222');
        expect(await oracle.maxReportInterval()).to.be.equal('333');
      });

      it('should deny non-reporter calling the method', async function() {
        await expect(oracle.setReportIntervals(222, 333, { from: alice }))
          .to.be.revertedWith('NOT_THE_OWNER');
      });
    });

    describe('pause', () => {
      it('should allow the owner pausing the contract', async function() {
        expect(await oracle.paused()).to.be.false;
        await oracle.pause({ from: owner });
        expect(await oracle.paused()).to.be.true;
      });

      it('should deny non-owner pausing the contract', async function() {
        await expect(oracle.pause({ from: alice }))
          .to.be.revertedWith('NOT_THE_OWNER');
      });
    })

    describe('unpause', () => {
      beforeEach(async function() {
        await oracle.pause({ from: owner });
      });

      it('should allow the owner unpausing the contract', async function() {
        expect(await oracle.paused()).to.be.true;
        await oracle.unpause({ from: owner });
        expect(await oracle.paused()).to.be.false;
      });

      it('should deny non-owner unpausing the contract', async function() {
        await expect(oracle.unpause({ from: alice }))
          .to.be.revertedWith('NOT_THE_OWNER');
      });
    })
  });

  describe('viewers', () => {
    // Token configs are stored with static addresses, with no relation to the cvpToken in this file
    const CFG_CVP_ADDRESS = address(777);
    const CFG_USDT_ADDRESS = address(444);
    const CFG_ETH_ADDRESS = address(111);
    const CFG_CVP_CTOKEN_ADDRESS = address(7);
    const CFG_USDT_CTOKEN_ADDRESS = address(4);
    const CFG_ETH_CTOKEN_ADDRESS = address(1);

    it('should respond with a correct values for a reported price', async function() {
      await oracle.stubSetPrice(CVP_SYMBOL_HASH, mwei('1.4'));

      expect(await oracle.getPriceByAsset(CFG_CVP_ADDRESS)).to.be.equal(mwei('1.4'));
      expect(await oracle.getPriceBySymbolHash(CVP_SYMBOL_HASH)).to.be.equal(mwei('1.4'));
      expect(await oracle.getPriceBySymbol('CVP')).to.be.equal(mwei('1.4'));
      expect(await oracle.getUnderlyingPrice(CFG_CVP_CTOKEN_ADDRESS)).to.be.equal(ether('1.4'));
      expect(await oracle.assetPrices(CFG_CVP_ADDRESS)).to.be.equal(ether('1.4'));
    });

    it('should respond with a correct values for FIXED_USD price', async function() {
      await oracle.stubSetPrice(USDT_SYMBOL_HASH, mwei('1.4'));

      expect(await oracle.getPriceByAsset(CFG_USDT_ADDRESS)).to.be.equal(mwei('1'));
      expect(await oracle.getPriceBySymbolHash(USDT_SYMBOL_HASH)).to.be.equal(mwei('1'));
      expect(await oracle.getPriceBySymbol('USDT')).to.be.equal(mwei('1'));
      expect(await oracle.getUnderlyingPrice(CFG_USDT_CTOKEN_ADDRESS)).to.be.equal(tether('1'));
      expect(await oracle.assetPrices(CFG_USDT_ADDRESS)).to.be.equal(tether('1'));
    });

    it('should respond with a correct values for FIXED_ETH price', async function() {
      await oracle.stubSetPrice(ETH_SYMBOL_HASH, mwei('1.4'));

      expect(await oracle.getPriceByAsset(CFG_ETH_ADDRESS)).to.be.equal(mwei('1.4'));
      expect(await oracle.getPriceBySymbolHash(ETH_SYMBOL_HASH)).to.be.equal(mwei('1.4'));
      expect(await oracle.getPriceBySymbol('ETH')).to.be.equal(mwei('1.4'));
      expect(await oracle.getUnderlyingPrice(CFG_ETH_CTOKEN_ADDRESS)).to.be.equal(ether('1.4'));
    });

    describe('calculateReportReward', () => {
      beforeEach(async function() {
        await oracle.setCvpAPY(ether(20), ether(10), { from: owner });
        await oracle.setTotalPerYear(90000, 50000, { from: owner });
        await oracle.setGasPriceLimit(gwei(1000), { from: owner });
        await oracle.setGasExpenses(110000, 84000, 117500, { from: owner });
      });

      it('should correctly calculate a reward', async () => {
        // 3 * (0.6 + 0.2464) = 3 * 0.8464 = 2.5392
        expect(await oracle.calculateReportReward(3, kether(270), String(320e18), String(5e18), { gasPrice: gwei(35) })).to.be.equal(ether('2.5392'));
      })

      it('should return 0 for 0 count', async () => {
        expect(await oracle.calculateReportReward(0, kether(45), 2, 2)).to.be.equal('0');
      })

      it('should should revert when ETH price is 0', async () => {
        await expect(oracle.calculateReportReward(1, 1, 0, 3)).to.be.revertedWith('ETH_PRICE_IS_NULL');
      })

      it('should should revert when CVP price is 0', async () => {
        await expect(oracle.calculateReportReward(1, 1, 1, 0)).to.be.revertedWith('CVP_PRICE_IS_NULL');
      })
    });

    describe('calculateReporterFixedReward', () => {
      beforeEach(async function() {
        await oracle.setCvpAPY(ether(20), ether(10), { from: owner });
        await oracle.setTotalPerYear(90000, 70000, { from: owner });
      });

      it('should correctly calculate a reward', async () => {
        // 270e21 * 20e18 / 90000 * 100e18 = 0.6
        expect(await oracle.calculateReporterFixedReward(kether(270))).to.be.equal(ether('0.6'));
        // 45e21 * 20e18 / 90000 * 100e18 = 0.1
        expect(await oracle.calculateReporterFixedReward(kether(45))).to.be.equal(ether('0.1'));
      })

      it('should return 0 for 0 count', async () => {
        expect(await oracle.calculateReporterFixedReward(0)).to.be.equal('0');
      })
    });

    describe('calculateGasCompensation', () => {
      beforeEach(async function() {
        await oracle.setGasPriceLimit(gwei(1000), { from: owner });
        await oracle.setGasExpenses(110000, 84000, 117500, { from: owner });
      });

      it('should correctly calculate a reward', async () => {
        // 35 gwei * 110_000 * 320e18 / 5e18 = 0.2464 CVP
        expect(await oracle.calculateGasCompensation(String(320e18), String(5e18), 110000, { gasPrice: gwei(35) })).to.be.equal(ether('0.2464'));
        // 350 gwei * 110_000 * 320e18 / 5e18 = 2.464e17 CVP
        expect(await oracle.calculateGasCompensation(String(320e18), String(5e18), 110000, { gasPrice: gwei(350) })).to.be.equal(ether('2.464'));
      })

      it('should use max gas price if the provided value is greater that the limit', async () => {
        expect(await oracle.calculateGasCompensation(String(320e18), String(5e18), 110000, { gasPrice: gwei(3500) })).to.be.equal(ether('7.04'));
      })

      it('should should revert when ETH price is 0', async () => {
        await expect(oracle.calculateGasCompensation(0, 1, 1)).to.be.revertedWith('ETH_PRICE_IS_NULL');
      })

      it('should should revert when CVP price is 0', async () => {
        await expect(oracle.calculateGasCompensation(1, 0, 1)).to.be.revertedWith('CVP_PRICE_IS_NULL');
      })
    });
  })
});
