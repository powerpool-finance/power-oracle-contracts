const { constants, time, expectEvent } = require('@openzeppelin/test-helpers');
const { K, ether, deployProxied, getResTimestamp, keccak256, fetchLogs } = require('./helpers');
const { getTokenConfigs  } = require('./localHelpers');

const { solidity } = require('ethereum-waffle');

const chai = require('chai');
const MockCVP = artifacts.require('MockCVP');
const MockStaking = artifacts.require('MockStaking');
const PowerOracle = artifacts.require('PowerOracle');

chai.use(solidity);
const { expect } = chai;

MockCVP.numberFormat = 'String';
MockStaking.numberFormat = 'String';
PowerOracle.numberFormat = 'String';

const DAI_SYMBOL_HASH = keccak256('DAI');
const ETH_SYMBOL_HASH = keccak256('ETH');
const CVP_SYMBOL_HASH = keccak256('CVP');
const REPORT_REWARD_IN_ETH = ether('0.05');
const MAX_CVP_REWARD = ether(15);
const ANCHOR_PERIOD = '45';
const ANCHOR_PERIOD_INT = 45;
const MIN_REPORT_INTERVAL = '30';
const MIN_REPORT_INTERVAL_INT = 30;
const MAX_REPORT_INTERVAL = '90';
const MAX_REPORT_INTERVAL_INT = 90;
const MIN_SLASHING_DEPOSIT = ether(40);
const SLASHER_REWARD_PCT = ether(15);
const RESERVOIR_REWARD_PCT = ether(5);

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

describe('PowerOracle', function () {
  let staking;
  let oracle;
  let cvpToken;

  let owner, timelockStub, sourceStub1, reservoir, powerOracle, alice, bob, validReporter, validSlasher;

  before(async function() {
    [owner, timelockStub, sourceStub1, reservoir, powerOracle, alice, bob, validReporter, validSlasher] = await web3.eth.getAccounts();
  });

  beforeEach(async function() {
    cvpToken = await MockCVP.new(ether(2000));
    staking = await MockStaking.new(cvpToken.address);
  });

  describe('initialization', () => {
    it('should assign constructor and initializer args correctly', async function() {
      oracle = await deployProxied(
        PowerOracle,
        [cvpToken.address, reservoir, ANCHOR_PERIOD, await getTokenConfigs()],
        [staking.address, REPORT_REWARD_IN_ETH, MAX_CVP_REWARD, MIN_REPORT_INTERVAL, MAX_REPORT_INTERVAL],
        { proxyAdminOwner: owner }
      );
      expect(await oracle.cvpToken()).to.be.equal(cvpToken.address);
      expect(await oracle.reservoir()).to.be.equal(reservoir);
      expect(await oracle.anchorPeriod()).to.be.equal(ANCHOR_PERIOD);
      expect(await oracle.reportReward()).to.be.equal(REPORT_REWARD_IN_ETH);
      expect(await oracle.maxCvpReward()).to.be.equal(MAX_CVP_REWARD);
      expect(await oracle.minReportInterval()).to.be.equal(MIN_REPORT_INTERVAL);
      expect(await oracle.maxReportInterval()).to.be.equal(MAX_REPORT_INTERVAL);
    });
  })

  describe('pokeFromReporter', () => {
    beforeEach(async () => {
      oracle = await deployProxied(
        PowerOracle,
        [cvpToken.address, reservoir, ANCHOR_PERIOD, await getTokenConfigs()],
        [staking.address, REPORT_REWARD_IN_ETH, MAX_CVP_REWARD, MIN_REPORT_INTERVAL, MAX_REPORT_INTERVAL],
        { proxyAdminOwner: owner }
      );
      await staking.setUser(1, validReporter, ether(300));
      await staking.setReporter(1, ether(300));
    });

    it('should allow a valid reporter calling the method', async function() {
      await oracle.pokeFromReporter(1, ['CVP', 'REP'], { from: validReporter });
    });

    it('should deny another user calling an behalf of reporter', async function() {
      await expect(oracle.pokeFromReporter(1, ['CVP', 'REP'], { from: bob }))
        .to.be.revertedWith('PowerOracleStaking::authorizeReporter: Invalid poker key');
    });

    it('should deny calling with an empty array', async function() {
      await expect(oracle.pokeFromReporter(1, [], { from: validReporter }))
        .to.be.revertedWith('PowerOracle::pokeFromReporter: Missing token symbols');
    });

    it('should deny poking with unknown token symbols', async function() {
      await expect(oracle.pokeFromReporter(1, ['FOO'], { from: validReporter }))
        .to.be.revertedWith('UniswapConfig::getTokenConfigBySymbolHash: Token cfg not found');
    });

    it('should deny poking with unknown token symbols', async function() {
      await expect(oracle.pokeFromReporter(1, ['FOO'], { from: validReporter }))
        .to.be.revertedWith('UniswapConfig::getTokenConfigBySymbolHash: Token cfg not found');
    });

    describe('rewards', () => {
      it('should not reward a reporter for reporting CVP and ETH', async function() {
        const res = await oracle.pokeFromReporter(1, ['CVP', 'ETH'], { from: validReporter });
        const resTimestamp = await getResTimestamp(res);

        expectPriceUpdateEvent({
          response: res,
          tokenSymbols: ['ETH', 'CVP'],
          oldTimestamp: '0',
          newTimestamp: resTimestamp
        });

        expectEvent(res, 'PokeFromReporter', {
          reporterId: '1',
          tokenCount: '2',
          rewardCount: '0'
        });
        expectEvent(res, 'NothingToReward', {
          userId: '1',
        });
      });

      it('should update CVP/ETH along with', async function() {
        const res = await oracle.pokeFromReporter(1, ['REP', 'DAI'], { from: validReporter });
        const resTimestamp = await getResTimestamp(res);

        expectPriceUpdateEvent({
          response: res,
          tokenSymbols: ['ETH', 'CVP', 'REP', 'DAI'],
          oldTimestamp: '0',
          newTimestamp: resTimestamp
        });

        expectEvent(res, 'PokeFromReporter', {
          reporterId: '1',
          tokenCount: '2',
          rewardCount: '2'
        });
        expectEvent(res, 'RewardUser', {
          userId: '1',
          count: '2',
          calculatedReward: '2'
        });
      });

      it('should update but not reward a reporter if there is not enough time passed from the last report', async function() {
        await oracle.pokeFromReporter(1, ['CVP', 'REP'], { from: validReporter });
        await time.increase(10);
        const res = await oracle.pokeFromReporter(1, ['CVP', 'REP'], { from: validReporter });
        const resTimestamp = await getResTimestamp(res);

        expect(await oracle.rewards(1)).to.be.equal('1');

        expectPriceUpdateEvent({
          response: res,
          tokenSymbols: ['ETH', 'CVP', 'REP'],
          oldTimestamp: '0',
          newTimestamp: resTimestamp
        })

        expectEvent(res, 'PokeFromReporter', {
          reporterId: '1',
          tokenCount: '2',
          rewardCount: '0'
        });
        expectEvent(res, 'NothingToReward', {
          userId: '1',
        });
        expect(await oracle.rewards(1)).to.be.equal('1');
      });

      it('should partially update on partially outdated prices', async function() {
        // 1st poke
        let res = await oracle.pokeFromReporter(1, ['CVP', 'REP', 'DAI', 'BTC'], { from: validReporter });
        const firstTimestamp = await getResTimestamp(res);
        expect(await oracle.rewards(1)).to.be.equal('3');

        await time.increase(MIN_REPORT_INTERVAL_INT - 5);

        // 2nd poke
        res = await oracle.pokeFromReporter(1, ['BTC'], { from: validReporter });
        expect(await oracle.rewards(1)).to.be.equal('3');
        await time.increase(20);

        // 3rd poke
        res = await oracle.pokeFromReporter(1, ['REP', 'DAI', 'BTC'], { from: validReporter });
        const thirdTimestamp = await getResTimestamp(res);

        expect((await oracle.prices(ETH_SYMBOL_HASH)).timestamp).to.be.equal(thirdTimestamp);

        expectPriceUpdateEvent({
          response: res,
          tokenSymbols: ['CVP', 'REP', 'DAI', 'BTC'],
          oldTimestamp: firstTimestamp,
          newTimestamp: thirdTimestamp
        })

        expectEvent(res, 'PokeFromReporter', {
          reporterId: '1',
          tokenCount: '3',
          rewardCount: '2'
        });
        expectEvent(res, 'RewardUser', {
          userId: '1',
          count: '2',
          calculatedReward: '4818'
        });
      });

      it('should fully update on fully outdated prices', async function() {
        // 1st poke
        let res = await oracle.pokeFromReporter(1, ['CVP', 'REP', 'DAI', 'BTC'], { from: validReporter });
        const firstTimestamp = await getResTimestamp(res);
        expect(await oracle.rewards(1)).to.be.equal('3');

        await time.increase(MIN_REPORT_INTERVAL_INT - 5);

        // 2nd poke
        res = await oracle.pokeFromReporter(1, ['BTC'], { from: validReporter });
        expect(await oracle.rewards(1)).to.be.equal('3');
        // NOTICE: the only difference with the example above
        await time.increase(120);

        // 3rd poke
        res = await oracle.pokeFromReporter(1, ['REP', 'DAI', 'BTC'], { from: validReporter });
        const thirdTimestamp = await getResTimestamp(res);

        expect((await oracle.prices(ETH_SYMBOL_HASH)).timestamp).to.be.equal(thirdTimestamp);

        expectPriceUpdateEvent({
          response: res,
          tokenSymbols: ['CVP', 'REP', 'DAI', 'BTC'],
          oldTimestamp: firstTimestamp,
          newTimestamp: thirdTimestamp
        })

        expectEvent(res, 'PokeFromReporter', {
          reporterId: '1',
          tokenCount: '3',
          rewardCount: '3'
        });
        expectEvent(res, 'RewardUser', {
          userId: '1',
          count: '3',
          calculatedReward: '7227'
        });
      });
    });
  });

  describe('pokeFromSlasher', () => {
    beforeEach(async () => {
      oracle = await deployProxied(
        PowerOracle,
        [cvpToken.address, reservoir, ANCHOR_PERIOD, await getTokenConfigs()],
        [staking.address, REPORT_REWARD_IN_ETH, MAX_CVP_REWARD, MIN_REPORT_INTERVAL, MAX_REPORT_INTERVAL],
        { proxyAdminOwner: owner }
      );
      await staking.setUser(1, validReporter, ether(300));
      await staking.setReporter(1, ether(300));
      await staking.setUser(2, validSlasher, ether(100));
    });

    it('should allow a valid slasher calling a method when all token prices are outdated', async function() {
      let res = await oracle.pokeFromReporter(1, ['REP', 'DAI', 'BTC'], { from: validReporter });
      const firstTimestamp = await getResTimestamp(res);
      await time.increase(MAX_REPORT_INTERVAL_INT + 5);
      res = await oracle.pokeFromSlasher(2, ['CVP', 'REP', 'DAI', 'BTC'], { from: validSlasher });
      const secondTimestamp = await getResTimestamp(res);

      expectEvent(res, 'PokeFromSlasher', {
        slasherId: '2',
        tokenCount: '4',
        overdueCount: '4'
      });
      expectPriceUpdateEvent({
        response: res,
        tokenSymbols: ['ETH', 'CVP', 'REP', 'DAI', 'BTC'],
        oldTimestamp: firstTimestamp,
        newTimestamp: secondTimestamp
      })

      const logs = await fetchLogs(MockStaking, res);
      expectEvent({ logs }, 'MockSlash', {
        userId: '2',
        overdueCount: '4'
      });
    });

    it('should allow a valid slasher calling a method when prices are partially outdated', async function() {
      // 1st poke
      let res = await oracle.pokeFromReporter(1, ['REP', 'DAI', 'BTC'], { from: validReporter });
      await time.increase(MAX_REPORT_INTERVAL_INT + 5);
      const firstTimestamp = await getResTimestamp(res);

      // 2nd poke
      await oracle.pokeFromReporter(1, ['REP'], { from: validReporter });

      // 3rd poke
      res = await oracle.pokeFromSlasher(2, ['CVP', 'REP', 'DAI', 'BTC'], { from: validSlasher });
      const secondTimestamp = await getResTimestamp(res);

      expectEvent(res, 'PokeFromSlasher', {
        slasherId: '2',
        tokenCount: '4',
        overdueCount: '2'
      });
      expectPriceUpdateEvent({
        response: res,
        tokenSymbols: ['ETH', 'CVP', 'REP', 'DAI', 'BTC'],
        oldTimestamp: firstTimestamp,
        newTimestamp: secondTimestamp
      })

      const logs = await fetchLogs(MockStaking, res);
      expectEvent({ logs }, 'MockSlash', {
        userId: '2',
        overdueCount: '2'
      });
    });

    it('should not call PowerOracleStaking.slash() method if there are no prices outdated', async function() {
      // 1st poke
      let res = await oracle.pokeFromReporter(1, ['REP', 'DAI', 'BTC'], { from: validReporter });
      await time.increase(5);

      // 2nd poke
      res = await oracle.pokeFromSlasher(2, ['CVP', 'REP', 'DAI', 'BTC'], { from: validSlasher });
      const secondTimestamp = await getResTimestamp(res);

      expectEvent(res, 'PokeFromSlasher', {
        slasherId: '2',
        tokenCount: '4',
        overdueCount: '0'
      });
      expectPriceUpdateEvent({
        response: res,
        tokenSymbols: ['ETH', 'CVP', 'REP', 'DAI', 'BTC'],
        oldTimestamp: '0',
        newTimestamp: secondTimestamp
      })

      const logs = await fetchLogs(MockStaking, res);
      expect(logs.length).to.be.equal(0);
    });

    it('should deny another user calling an behalf of reporter', async function() {
      await expect(oracle.pokeFromSlasher(2, ['CVP', 'REP'], { from: alice }))
        .to.be.revertedWith('PowerOracleStaking::authorizeSlasher: Invalid poker key');
    });

    it('should deny calling with an empty array', async function() {
      await expect(oracle.pokeFromSlasher(2, [], { from: validSlasher }))
        .to.be.revertedWith('PowerOracle::pokeFromSlasher: Missing token symbols');
    });

    it('should deny poking with unknown token symbols', async function() {
      await expect(oracle.pokeFromSlasher(2, ['FOO'], { from: validSlasher }))
        .to.be.revertedWith('UniswapConfig::getTokenConfigBySymbolHash: Token cfg not found');
    });

    it('should deny poking with unknown token symbols', async function() {
      await expect(oracle.pokeFromSlasher(2, ['FOO'], { from: validSlasher }))
        .to.be.revertedWith('UniswapConfig::getTokenConfigBySymbolHash: Token cfg not found');
    });
  });
});
