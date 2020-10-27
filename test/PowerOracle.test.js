const { constants, time, expectEvent } = require('@openzeppelin/test-helpers');
const { address, kether, ether, mwei, gwei, tether, deployProxied, getResTimestamp, keccak256, fetchLogs } = require('./helpers');
const { getTokenConfigs  } = require('./localHelpers');

const { solidity } = require('ethereum-waffle');

const chai = require('chai');
const MockCVP = artifacts.require('MockCVP');
const MockStaking = artifacts.require('MockStaking');
const StubOracle = artifacts.require('StubOracle');
const MockOracle = artifacts.require('MockOracle');

chai.use(solidity);
const { expect } = chai;

MockCVP.numberFormat = 'String';
MockStaking.numberFormat = 'String';
StubOracle.numberFormat = 'String';
MockOracle.numberFormat = 'String';

const ETH_SYMBOL_HASH = keccak256('ETH');
const CVP_SYMBOL_HASH = keccak256('CVP');
const USDT_SYMBOL_HASH = keccak256('USDT');
const CVP_REPORT_APY = ether(20);
const CVP_SLASHER_UPDATE_APY = ether(10);
const TOTAL_REPORTS_PER_YEAR = '90000';
const TOTAL_SLASHER_UPDATES_PER_YEAR = '50000';
const GAS_EXPENSES_PER_ASSET_REPORT = '110000';
const GAS_EXPENSES_FOR_SLASHER_UPDATE = '10000';
const GAS_PRICE_LIMIT = gwei(1000);
const ANCHOR_PERIOD = '45';
const MIN_REPORT_INTERVAL = '30';
const MIN_REPORT_INTERVAL_INT = 30;
const MAX_REPORT_INTERVAL = '90';
const MAX_REPORT_INTERVAL_INT = 90;

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
  let oracle;
  let cvpToken;

  let deployer, owner, reservoir, alice, bob, validReporterPoker, validSlasherPoker, sink;

  before(async function() {
    [deployer, owner, reservoir, alice, bob, validReporterPoker, validSlasherPoker, sink] = await web3.eth.getAccounts();
  });

  beforeEach(async function() {
    cvpToken = await MockCVP.new(ether(100000));
    staking = await MockStaking.new(cvpToken.address, reservoir);
    oracle = await deployProxied(
      StubOracle,
      [cvpToken.address, reservoir, ANCHOR_PERIOD, await getTokenConfigs()],
      [owner, staking.address, CVP_REPORT_APY, CVP_SLASHER_UPDATE_APY, TOTAL_REPORTS_PER_YEAR, TOTAL_SLASHER_UPDATES_PER_YEAR, GAS_EXPENSES_PER_ASSET_REPORT, GAS_EXPENSES_FOR_SLASHER_UPDATE, GAS_PRICE_LIMIT, MIN_REPORT_INTERVAL, MAX_REPORT_INTERVAL],
      { proxyAdminOwner: owner }
    );

    await cvpToken.transfer(reservoir, ether(100000), { from: deployer });
    await cvpToken.approve(oracle.address, ether(100000), { from: reservoir });
  });

  describe('initialization', () => {
    it('should assign constructor and initializer args correctly', async function() {
      expect(await oracle.owner()).to.be.equal(owner);
      expect(await oracle.cvpToken()).to.be.equal(cvpToken.address);
      expect(await oracle.reservoir()).to.be.equal(reservoir);
      expect(await oracle.anchorPeriod()).to.be.equal(ANCHOR_PERIOD);
      expect(await oracle.cvpReportAPY()).to.be.equal(CVP_REPORT_APY);
      expect(await oracle.cvpSlasherUpdateAPY()).to.be.equal(CVP_SLASHER_UPDATE_APY);
      expect(await oracle.totalReportsPerYear()).to.be.equal(TOTAL_REPORTS_PER_YEAR);
      expect(await oracle.totalSlasherUpdatesPerYear()).to.be.equal(TOTAL_SLASHER_UPDATES_PER_YEAR);
      expect(await oracle.gasExpensesPerAssetReport()).to.be.equal(GAS_EXPENSES_PER_ASSET_REPORT);
      expect(await oracle.gasExpensesForSlasherStatusUpdate()).to.be.equal(GAS_EXPENSES_FOR_SLASHER_UPDATE);
      expect(await oracle.gasPriceLimit()).to.be.equal(GAS_PRICE_LIMIT);
      expect(await oracle.minReportInterval()).to.be.equal(MIN_REPORT_INTERVAL);
      expect(await oracle.maxReportInterval()).to.be.equal(MAX_REPORT_INTERVAL);
    });

    it('should deny initializing again', async function() {
      await expect(oracle.initialize(owner, staking.address, CVP_REPORT_APY, CVP_SLASHER_UPDATE_APY, TOTAL_REPORTS_PER_YEAR, TOTAL_SLASHER_UPDATES_PER_YEAR, GAS_EXPENSES_PER_ASSET_REPORT, GAS_EXPENSES_FOR_SLASHER_UPDATE, GAS_PRICE_LIMIT, MIN_REPORT_INTERVAL, MAX_REPORT_INTERVAL))
        .to.be.revertedWith('Contract instance has already been initialized')
    });
  })

  describe('pokeFromReporter', () => {
    beforeEach(async () => {
      await staking.mockSetUser(1, alice, validReporterPoker, ether(300));
      await staking.mockSetReporter(1, ether(300));
    });

    it('should allow a valid reporter calling the method', async function() {
      await oracle.pokeFromReporter(1, ['CVP', 'REP'], { from: validReporterPoker });
    });

    it('should deny another user calling an behalf of reporter', async function() {
      await expect(oracle.pokeFromReporter(1, ['CVP', 'REP'], { from: bob }))
        .to.be.revertedWith('PowerOracleStaking::authorizeReporter: Invalid poker key');
    });

    it('should deny calling with an empty array', async function() {
      await expect(oracle.pokeFromReporter(1, [], { from: validReporterPoker }))
        .to.be.revertedWith('PowerOracle::pokeFromReporter: Missing token symbols');
    });

    it('should deny poking with unknown token symbols', async function() {
      await expect(oracle.pokeFromReporter(1, ['FOO'], { from: validReporterPoker }))
        .to.be.revertedWith('UniswapConfig::getTokenConfigBySymbolHash: Token cfg not found');
    });

    it('should deny poking with unknown token symbols', async function() {
      await expect(oracle.pokeFromReporter(1, ['FOO'], { from: validReporterPoker }))
        .to.be.revertedWith('UniswapConfig::getTokenConfigBySymbolHash: Token cfg not found');
    });

    it('should deny poking when the contract is paused', async function() {
      await oracle.pause({ from: owner });
      await expect(oracle.pokeFromReporter(1, ['REP'], { from: validReporterPoker }))
        .to.be.revertedWith('Pausable: paused');
    });

    describe('rewards', () => {
      beforeEach(async function() {
        oracle = await deployProxied(
          MockOracle,
          [cvpToken.address, reservoir, ANCHOR_PERIOD, await getTokenConfigs()],
          [owner, staking.address, CVP_REPORT_APY, CVP_SLASHER_UPDATE_APY, TOTAL_REPORTS_PER_YEAR, TOTAL_SLASHER_UPDATES_PER_YEAR, GAS_EXPENSES_PER_ASSET_REPORT, GAS_EXPENSES_FOR_SLASHER_UPDATE, GAS_PRICE_LIMIT, MIN_REPORT_INTERVAL, MAX_REPORT_INTERVAL],
          { proxyAdminOwner: owner }
        );
        await staking.setPowerOracle(oracle.address, { from: deployer });
        await oracle.mockSetAnchorPrice('ETH', mwei('320'));
        await oracle.mockSetAnchorPrice('CVP', mwei('5'));
        await staking.mockSetUser(1, alice, validReporterPoker, kether(270));
        // NOTICE: so the 1 token reward with 35 gwei gas price is
        // `1 (count) * 0.6 + 0.2464 = 0.8464 CVP`
      })

      it('should assign ETH/CVP prices correctly', async function() {
        await oracle.pokeFromReporter(1, ['REP'], { from: validReporterPoker });
        expect(await oracle.getPriceBySymbol('ETH')).to.be.equal(mwei('320'))
        expect(await oracle.getPriceBySymbol('CVP')).to.be.equal(mwei('5'))
      });

      it('should not reward a reporter for reporting CVP and ETH', async function() {
        const res = await oracle.pokeFromReporter(1, ['CVP', 'ETH'], { from: validReporterPoker });

        expectMockedPriceUpdateEvent({
          response: res,
          tokenSymbols: ['ETH', 'CVP'],
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
        const res = await oracle.pokeFromReporter(1, ['REP', 'DAI'], { from: validReporterPoker, gasPrice: gwei(35) });
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
        expectEvent(res, 'RewardUserReport', {
          userId: '1',
          count: '2',
          calculatedReward: ether('1.6928')
        });
      });

      it('should update but not reward a reporter if there is not enough time passed from the last report', async function() {
        await oracle.pokeFromReporter(1, ['CVP', 'REP'], { from: validReporterPoker, gasPrice: gwei(35) });
        await time.increase(10);
        expect(await oracle.rewards(1)).to.be.equal(ether('0.8464'));

        const res = await oracle.pokeFromReporter(1, ['CVP', 'REP'], { from: validReporterPoker, gasPrice: gwei(35) });
        const resTimestamp = await getResTimestamp(res);

        expect(await oracle.rewards(1)).to.be.equal(ether('0.8464'));

        expectMockedPriceToNotUpdateEvent({
          response: res,
          tokenSymbols: ['ETH', 'CVP'],
        });
        expectPriceToNotUpdateEvent({
          response: res,
          tokenSymbols: ['REP'],
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
        expect(await oracle.rewards(1)).to.be.equal(ether('0.8464'));
      });

      it('should partially update on partially outdated prices', async function() {
        // 1st poke
        let res = await oracle.pokeFromReporter(1, ['CVP', 'REP', 'DAI', 'BTC'], { from: validReporterPoker, gasPrice: gwei(35) });
        const firstTimestamp = await getResTimestamp(res);
        expect(await oracle.rewards(1)).to.be.equal(ether('2.5392'));

        await time.increase(MIN_REPORT_INTERVAL_INT - 5);

        // 2nd poke
        res = await oracle.pokeFromReporter(1, ['BTC'], { from: validReporterPoker, gasPrice: gwei(35) });
        expect(await oracle.rewards(1)).to.be.equal(ether('2.5392'));
        expectEvent.notEmitted(res, 'RewardUserReport');
        expectEvent.notEmitted(res, 'AnchorPriceUpdated');

        await time.increase(20);

        // 3rd poke
        res = await oracle.pokeFromReporter(1, ['REP', 'DAI', 'BTC'], { from: validReporterPoker, gasPrice: gwei(35) });
        const thirdTimestamp = await getResTimestamp(res);

        expect((await oracle.prices(ETH_SYMBOL_HASH)).timestamp).to.be.equal(thirdTimestamp);
        // 19.2 + 12.8
        expect(await oracle.rewards(1)).to.be.equal(ether('5.0784'));

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
        expectEvent(res, 'RewardUserReport', {
          userId: '1',
          count: '3',
          calculatedReward: ether('2.5392')
        });
      });

      it('should fully update on fully outdated prices', async function() {
        // 1st poke
        let res = await oracle.pokeFromReporter(1, ['CVP', 'REP', 'DAI', 'BTC'], { from: validReporterPoker, gasPrice: gwei(35) });
        const firstTimestamp = await getResTimestamp(res);
        expect(await oracle.rewards(1)).to.be.equal(ether('2.5392'));

        await time.increase(MIN_REPORT_INTERVAL_INT - 5);

        // 2nd poke
        res = await oracle.pokeFromReporter(1, ['BTC'], { from: validReporterPoker, gasPrice: gwei(35) });
        expect(await oracle.rewards(1)).to.be.equal(ether('2.5392'));
        // NOTICE: the only difference with the example above
        await time.increase(120);

        // 3rd poke
        res = await oracle.pokeFromReporter(1, ['REP', 'DAI', 'BTC'], { from: validReporterPoker, gasPrice: gwei(35) });
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
        expectEvent(res, 'RewardUserReport', {
          userId: '1',
          count: '3',
          calculatedReward: ether('2.5392')
        });
      });
    });
  });

  describe('pokeFromSlasher', () => {
    beforeEach(async () => {
      await staking.mockSetUser(1, alice, validReporterPoker, ether(300));
      await staking.mockSetReporter(1, ether(300));
      await staking.mockSetUser(2, alice, validSlasherPoker, ether(100));
    });

    it('should allow a valid slasher calling a method when all token prices are outdated', async function() {
      let res = await oracle.pokeFromReporter(1, ['REP', 'DAI', 'BTC'], { from: validReporterPoker });
      const firstTimestamp = await getResTimestamp(res);
      await time.increase(MAX_REPORT_INTERVAL_INT + 5);
      res = await oracle.pokeFromSlasher(2, ['REP', 'DAI', 'BTC'], { from: validSlasherPoker });
      const secondTimestamp = await getResTimestamp(res);

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
      await oracle.pokeFromReporter(1, ['REP'], { from: validReporterPoker });

      // 3rd poke
      res = await oracle.pokeFromSlasher(2, ['CVP', 'REP', 'DAI', 'BTC'], { from: validSlasherPoker });
      const secondTimestamp = await getResTimestamp(res);

      expectEvent(res, 'PokeFromSlasher', {
        slasherId: '2',
        tokenCount: '4',
        overdueCount: '2'
      });
      expectEvent(res, 'RewardUserReport', {
        userId: '2',
        count: '2'
      });
      expectPriceUpdateEvent({
        response: res,
        tokenSymbols: ['DAI', 'BTC'],
        oldTimestamp: firstTimestamp,
        newTimestamp: secondTimestamp
      });

      expectEvent.inTransaction(res.tx, MockStaking, 'MockSlash', {
        userId: '2',
        overdueCount: '2'
      });
    });

    it('should not call PowerOracleStaking.slash() method if there are no prices outdated', async function() {
      // 1st poke
      let res = await oracle.pokeFromReporter(1, ['REP', 'DAI', 'BTC'], { from: validReporterPoker });
      await time.increase(5);

      // 2nd poke
      res = await oracle.pokeFromSlasher(2, ['CVP', 'REP', 'DAI', 'BTC'], { from: validSlasherPoker });
      const secondTimestamp = await getResTimestamp(res);

      expectEvent(res, 'PokeFromSlasher', {
        slasherId: '2',
        tokenCount: '4',
        overdueCount: '0'
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

    it('should deny another user calling an behalf of reporter', async function() {
      await expect(oracle.pokeFromSlasher(2, ['REP'], { from: alice }))
        .to.be.revertedWith('PowerOracleStaking::authorizeSlasher: Invalid poker key');
    });

    it('should deny calling with an empty array', async function() {
      await expect(oracle.pokeFromSlasher(2, [], { from: validSlasherPoker }))
        .to.be.revertedWith('PowerOracle::pokeFromSlasher: Missing token symbols');
    });

    it('should deny poking with unknown token symbols', async function() {
      await expect(oracle.pokeFromSlasher(2, ['FOO'], { from: validSlasherPoker }))
        .to.be.revertedWith('UniswapConfig::getTokenConfigBySymbolHash: Token cfg not found');
    });

    it('should deny poking when the contract is paused', async function() {
      await oracle.pause({ from: owner });
      await expect(oracle.pokeFromReporter(2, ['REP'], { from: validSlasherPoker }))
        .to.be.revertedWith('Pausable: paused');
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
        .to.be.revertedWith('PowerOracle::poke: Missing token symbols');
    });

    it('should deny poking with unknown token symbols', async function() {
      await expect(oracle.poke(['FOO'], { from: bob }))
        .to.be.revertedWith('UniswapConfig::getTokenConfigBySymbolHash: Token cfg not found');
    });

    it('should deny poking when the contract is paused', async function() {
      await oracle.pause({ from: owner });
      await expect(oracle.poke(['REP'], { from: bob }))
        .to.be.revertedWith('Pausable: paused');
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
        .to.be.revertedWith('PowerOracleStaking::requireValidAdminKey: Invalid admin key');
    });

    it('should deny withdrawing to 0 address', async function() {
      await expect(oracle.withdrawRewards(USER_ID, constants.ZERO_ADDRESS, { from: alice }))
        .to.be.revertedWith("PowerOracle::withdrawRewards: Can't withdraw to 0 address");
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
          .to.be.revertedWith('Ownable: caller is not the owner');
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
          .to.be.revertedWith('Ownable: caller is not the owner');
      });
    });

    describe('setGasExpenses', () => {
      it('should allow the owner setting a new value', async function() {
        await oracle.setGasExpenses(42, 22, { from: owner });
        expect(await oracle.gasExpensesPerAssetReport()).to.be.equal('42');
        expect(await oracle.gasExpensesForSlasherStatusUpdate()).to.be.equal('22');
      });

      it('should deny non-reporter calling the method', async function() {
        await expect(oracle.setGasExpenses(42, 22, { from: alice }))
          .to.be.revertedWith('Ownable: caller is not the owner');
      });
    });

    describe('setGasPriceLimit', () => {
      it('should allow the owner setting value', async function() {
        await oracle.setGasPriceLimit(42, { from: owner });
        expect(await oracle.gasPriceLimit()).to.be.equal('42');
      });

      it('should deny non-reporter calling the method', async function() {
        await expect(oracle.setGasPriceLimit(42, { from: alice }))
          .to.be.revertedWith('Ownable: caller is not the owner');
      });
    });

    describe('setGasPriceLimit', () => {
      it('should allow the owner setting a new report reward', async function() {
        await oracle.setPowerOracleStaking(sink, { from: owner });
        expect(await oracle.powerOracleStaking()).to.be.equal(sink);
      });

      it('should deny non-reporter calling the method', async function() {
        await expect(oracle.setPowerOracleStaking(sink, { from: alice }))
          .to.be.revertedWith('Ownable: caller is not the owner');
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
          .to.be.revertedWith('Ownable: caller is not the owner');
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
          .to.be.revertedWith('Ownable: caller is not the owner');
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
          .to.be.revertedWith('Ownable: caller is not the owner');
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
        await oracle.setGasExpenses(110000, 90000, { from: owner });
      });

      it('should correctly calculate a reward', async () => {
        // 3 * (0.6 + 0.2464) = 3 * 0.8464 = 2.5392
        expect(await oracle.calculateReportReward(3, kether(270), String(320e18), String(5e18), { gasPrice: gwei(35) })).to.be.equal(ether('2.5392'));
      })

      it('should return 0 for 0 count', async () => {
        expect(await oracle.calculateReportReward(0, kether(45), 2, 2)).to.be.equal('0');
      })

      it('should should revert when ETH price is 0', async () => {
        await expect(oracle.calculateReportReward(1, 1, 0, 3)).to.be.revertedWith('PowerOracle::calculateGasCompensation: ETH price is 0');
      })

      it('should should revert when CVP price is 0', async () => {
        await expect(oracle.calculateReportReward(1, 1, 1, 0)).to.be.revertedWith('PowerOracle::calculateGasCompensation: CVP price is 0');
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
        await oracle.setGasExpenses(110000, 90000, { from: owner });
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
        await expect(oracle.calculateGasCompensation(0, 1, 1)).to.be.revertedWith('PowerOracle::calculateGasCompensation: ETH price is 0');
      })

      it('should should revert when CVP price is 0', async () => {
        await expect(oracle.calculateGasCompensation(1, 0, 1)).to.be.revertedWith('PowerOracle::calculateGasCompensation: CVP price is 0');
      })
    });
  })
});
