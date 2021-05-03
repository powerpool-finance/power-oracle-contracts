const { time, expectEvent } = require('@openzeppelin/test-helpers');
const { address, kether, ether, mwei, gwei, tether, deployProxied, getResTimestamp, keccak256 } = require('./helpers');
const { getTokenConfigs } = require('./localHelpers');

const chai = require('chai');
const MockCVP = artifacts.require('MockCVP');
const MockStaking = artifacts.require('MockStaking');
const StubOracle = artifacts.require('StubOracle');
const MockOracle = artifacts.require('MockOracle');
const PowerPoke = artifacts.require('PowerPoke');
const MockFastGasOracle = artifacts.require('MockFastGasOracle');
const MockProxyCall = artifacts.require('MockProxyCall');

const { expect } = chai;

MockCVP.numberFormat = 'String';
MockStaking.numberFormat = 'String';
StubOracle.numberFormat = 'String';
MockOracle.numberFormat = 'String';
PowerPoke.numberFormat = 'String';

const ETH_SYMBOL_HASH = keccak256('ETH');
const CVP_SYMBOL_HASH = keccak256('CVP');
const USDT_SYMBOL_HASH = keccak256('USDT');
const ANCHOR_PERIOD = '45';
const MIN_REPORT_INTERVAL = '30';
const MIN_REPORT_INTERVAL_INT = 30;
const MAX_REPORT_INTERVAL = '90';
const MAX_REPORT_INTERVAL_INT = 90;
const SLASHER_HEARTBEAT_INTERVAL = 120;
const DEPOSIT_TIMEOUT = '30';
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

function doNotExpectPriceUpdateEvent(config) {
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

describe('PowerOracle', function () {
  let staking;
  let poke;
  let oracle;
  let cvpToken;
  let fastGasOracle;
  let powerPokeOpts;
  let proxyCall;

  let deployer, owner, oracleClientOwner, reservoir, alice, bob, validReporterPoker, validSlasherPoker, sink, uniswapRouter;

  before(async function() {
    [deployer, owner, oracleClientOwner, reservoir, alice, bob, validReporterPoker, validSlasherPoker, sink, uniswapRouter] = await web3.eth.getAccounts();
    fastGasOracle = await MockFastGasOracle.new(gwei(300 * 1000));
    proxyCall = await MockProxyCall.new();

    powerPokeOpts = web3.eth.abi.encodeParameter(
      {
        PowerPokeRewardOpts: {
          to: 'address',
          compensateInETH: 'bool'
        },
      },
      {
        to: alice,
        compensateInETH: false
      },
    );
  });

  beforeEach(async function() {
    cvpToken = await MockCVP.new(ether(100000000));
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
      [cvpToken.address, ANCHOR_PERIOD],
      [owner, poke.address],
      { proxyAdminOwner: owner }
    );

    await oracle.addTokens(await getTokenConfigs(cvpToken.address), { from: owner });
    await poke.setOracle(oracle.address, { from: owner });
    await cvpToken.transfer(reservoir, ether(100000), { from: deployer });
    await cvpToken.transfer(alice, ether(10000000), { from: deployer });
    await cvpToken.approve(oracle.address, ether(100000), { from: reservoir });
  });

  describe('initialization', () => {
    it('should assign constructor and initializer args correctly', async function() {
      expect(await oracle.owner()).to.be.equal(owner);
      expect(await oracle.powerPoke()).to.be.equal(poke.address);
      expect(await oracle.ANCHOR_PERIOD()).to.be.equal(ANCHOR_PERIOD);
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
      await poke.setBonusPlan(oracle.address, 1,  true, 25, 17520000, 100 * 1000, { from: oracleClientOwner });
    });

    it('should allow a valid reporter calling the method', async function() {
      await oracle.pokeFromReporter(1, ['DAI', 'REP'], powerPokeOpts, { from: validReporterPoker });
    });

    it('should deny another user calling an behalf of reporter', async function() {
      await expect(oracle.pokeFromReporter(1, ['DAI', 'REP'], powerPokeOpts, { from: bob }))
        .to.be.revertedWith('INVALID_POKER_KEY');
    });

    it('should deny poking with duplicated symbols', async function() {
      await expect(oracle.pokeFromReporter(1, ['DAI', 'REP', 'BTC', 'DAI'], powerPokeOpts, { from: validReporterPoker }))
        .to.be.revertedWith('TOO_EARLY_UPDATE');
      await expect(oracle.pokeFromReporter(1, ['REP', 'REP'], powerPokeOpts, { from: validReporterPoker }))
        .to.be.revertedWith('TOO_EARLY_UPDATE');
    });

    it('should deny poking with internal symbols', async function() {
      await expect(oracle.pokeFromReporter(1, ['DAI', 'REP', 'ETH', 'DAI'], powerPokeOpts, { from: validReporterPoker }))
        .to.be.revertedWith('TOO_EARLY_UPDATE');
      await expect(oracle.pokeFromReporter(1, ['CVP', 'REP', 'DAI'], powerPokeOpts, { from: validReporterPoker }))
        .to.be.revertedWith('TOO_EARLY_UPDATE');
      await expect(oracle.pokeFromReporter(1, ['CVP'], powerPokeOpts, { from: validReporterPoker }))
        .to.be.revertedWith('TOO_EARLY_UPDATE');
      await expect(oracle.pokeFromReporter(1, ['ETH'], powerPokeOpts, { from: validReporterPoker }))
        .to.be.revertedWith('TOO_EARLY_UPDATE');
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

    it('should deny poking from a contract', async function() {
      await staking.mockSetUser(2, bob, proxyCall.address, ether(400));
      await staking.setHDH(2);
      const data = oracle.contract.methods.pokeFromReporter(2, ['REP'], powerPokeOpts).encodeABI();
      await expect(proxyCall.makeCall(oracle.address, data)).to.be.revertedWith('CONTRACT_CALL');
    });

    describe('rewards', () => {
      beforeEach(async function() {
        oracle = await deployProxied(
          MockOracle,
          [cvpToken.address, ANCHOR_PERIOD],
          [owner, poke.address],
          { proxyAdminOwner: owner }
        );
        await oracle.addTokens(await getTokenConfigs(cvpToken.address), { from: owner });
        await poke.addClient(oracle.address, oracleClientOwner, true, gwei(300), MIN_REPORT_INTERVAL, MAX_REPORT_INTERVAL, { from: owner });
        await poke.setOracle(oracle.address, { from: owner });

        await cvpToken.approve(poke.address, ether(3000000), { from: alice })
        await poke.addCredit(oracle.address, ether(3000000), { from: alice });
        await poke.setBonusPlan(oracle.address, 1,  true, 25, 17520000, 100 * 1000, { from: oracleClientOwner });

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
        });
        await expectEvent.inTransaction(res.tx, poke, 'RewardUser', {
          userId: '1',
          userDeposit: kether(270),
          // bonusCVP: ether('1.155821917808219178')
          // calculatedReward: ether('1.6928')
        });
      });

      it('should revert if there is nothing to update', async function() {
        await oracle.pokeFromReporter(1, ['DAI', 'REP'], powerPokeOpts, { from: validReporterPoker, gasPrice: gwei(35) });
        await time.increase(10);

        await expect(oracle.pokeFromReporter(1, ['DAI', 'REP'], powerPokeOpts, { from: validReporterPoker, gasPrice: gwei(35) }))
          .to.be.revertedWith('TOO_EARLY_UPDATE');
      });

      it('should partially update on partially outdated prices', async function() {
        // 1st poke
        let res = await oracle.pokeFromReporter(1, ['REP', 'DAI', 'BTC'], powerPokeOpts, { from: validReporterPoker, gasPrice: gwei(35) });
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
        });
        await expectEvent.inTransaction(res.tx, poke, 'RewardUser', {
          userId: '1',
          userDeposit: kether(270),
          // bonusCVP: ether('1.541095890410958904')
          // calculatedReward: ether('2.5392')
        });
      });

      it('should fully update on fully outdated prices', async function() {
        // 1st poke
        let res = await oracle.pokeFromReporter(1, ['REP', 'DAI', 'BTC'], powerPokeOpts, { from: validReporterPoker, gasPrice: gwei(35) });
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
        });
        await expectEvent.inTransaction(res.tx, poke, 'RewardUser', {
          client: oracle.address,
          userId: '1',
          compensateInETH: false,
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
        [cvpToken.address, ANCHOR_PERIOD],
        [owner, poke.address],
        { proxyAdminOwner: owner }
      );

      await oracle.addTokens(await getTokenConfigs(cvpToken.address), { from: owner });
      await poke.addClient(oracle.address, oracleClientOwner, true, gwei(300), MIN_REPORT_INTERVAL, MAX_REPORT_INTERVAL, { from: owner });
      await poke.setOracle(oracle.address, { from: owner });

      await cvpToken.approve(poke.address, ether(30000), { from: alice })
      await poke.addCredit(oracle.address, ether(30000), { from: alice });
      await poke.setBonusPlan(oracle.address, 1,  true, 25, 17520000, 100 * 1000, { from: oracleClientOwner });
      await poke.setBonusPlan(oracle.address, 2,  true, 2, 17520000, 10 * 1000, { from: oracleClientOwner });
      await poke.setSlasherHeartbeat(oracle.address, SLASHER_HEARTBEAT_INTERVAL, { from: oracleClientOwner });

      await cvpToken.transfer(alice, ether(400), { from: deployer });
      await cvpToken.approve(staking.address, ether(400), { from: alice });
      let res = await staking.createUser(alice, validReporterPoker, ether(300), { from: alice });
      expectEvent(res, 'CreateUser', { userId: '1' });
      res = await staking.createUser(alice, validSlasherPoker, ether(100), { from: alice });
      expectEvent(res, 'CreateUser', { userId: '2' });

      await time.increase(DEPOSIT_TIMEOUT);

      await staking.executeDeposit(1, { from: alice });
      await staking.executeDeposit(2, { from: alice });

      expect(await staking.getHDHID()).to.be.equal('1');
      await staking.authorizeHDH(1, validReporterPoker);

      await time.increase(MAX_REPORT_INTERVAL_INT + 1);
    });

    it('should allow a valid slasher calling a method when all token prices are outdated', async function() {
      let res = await oracle.pokeFromReporter(1, ['REP', 'DAI', 'BTC'], powerPokeOpts, { from: validReporterPoker });
      const firstTimestamp = await getResTimestamp(res);
      await time.increase(MAX_REPORT_INTERVAL_INT + 5);

      res = await oracle.pokeFromSlasher(2, ['REP', 'DAI', 'BTC'], powerPokeOpts, { from: validSlasherPoker, gasPrice: gwei(35) });
      const secondTimestamp = await getResTimestamp(res);

      expectEvent.notEmitted(res, 'RewardUserSlasherUpdate');
      expectEvent(res, 'PokeFromSlasher', {
        slasherId: '2',
        tokenCount: '3',
      });
      await expectEvent.inTransaction(res.tx, poke, 'RewardUser', {
        client: oracle.address,
        userId: '2',
        bonusPlan: '1',
        compensateInETH: false,
        // gasUsed: '306480',
        gasPrice: gwei(35),
        userDeposit: ether(100),
        // gasCompensationCVP: '686515200000000000',
        ethPrice: '219512195121',
        cvpPrice: '999999999995666787',
      });
      expectPriceUpdateEvent({
        response: res,
        tokenSymbols: ['ETH', 'CVP', 'REP', 'DAI', 'BTC'],
        oldTimestamp: firstTimestamp,
        newTimestamp: secondTimestamp
      })

      await expectEvent.inTransaction(res.tx, MockStaking, 'MockSlash', {
        slasherId: '2',
        times: '3'
      });
    });

    it('should allow a valid slasher calling a method when prices are partially outdated', async function() {
      // 1st poke
      let res = await oracle.pokeFromReporter(1, ['REP', 'DAI', 'BTC'], powerPokeOpts, { from: validReporterPoker });
      await time.increase(MAX_REPORT_INTERVAL_INT + 5);
      const firstTimestamp = await getResTimestamp(res);

      // 2nd poke
      res = await oracle.pokeFromReporter(1, ['REP'], powerPokeOpts, { from: validReporterPoker });
      const secondTimestamp = await getResTimestamp(res);

      expectPriceUpdateEvent({
        response: res,
        tokenSymbols: ['ETH', 'CVP', 'REP'],
        oldTimestamp: firstTimestamp,
        newTimestamp: secondTimestamp
      });

      // 3rd poke
      await expect(oracle.pokeFromSlasher(2, ['REP', 'DAI', 'BTC'], powerPokeOpts, {
        from: validSlasherPoker,
        gasPrice: gwei(35),
      })).to.be.revertedWith('INTERVAL_IS_OK');
      res = await oracle.pokeFromSlasher(2, ['DAI', 'BTC'], powerPokeOpts, {
        from: validSlasherPoker,
        gasPrice: gwei(35),
      });
      const thirdTimestamp = await getResTimestamp(res);

      expectEvent.notEmitted(res, 'RewardUserSlasherUpdate');
      expectEvent(res, 'PokeFromSlasher', {
        slasherId: '2',
        tokenCount: '2',
      });
      expectEvent(res, 'SlasherHeartbeat', {
        slasherId: '2',
      });
      await expectEvent.inTransaction(res.tx, poke, 'RewardUser', {
        client: oracle.address,
        userId: '2',
        bonusPlan: '1',
        compensateInETH: false,
        // gasUsed: '306480',
        gasPrice: gwei(35),
        userDeposit: ether(100),
        // gasCompensationCVP: '686515200000000000',
        ethPrice: '219512195121',
        cvpPrice: '999999999995666787',
      });
      expectPriceUpdateEvent({
        response: res,
        tokenSymbols: ['DAI', 'BTC'],
        oldTimestamp: firstTimestamp,
        newTimestamp: thirdTimestamp
      });

      await expectEvent.inTransaction(res.tx, MockStaking, 'MockSlash', {
        slasherId: '2',
        times: '2'
      });
    });

    it('should revert if there are no prices outdated', async function() {
      await oracle.mockSetAnchorPrice('ETH', mwei('320'));
      await oracle.mockSetAnchorPrice('CVP', mwei('5'));
      // 1st poke
      await oracle.pokeFromReporter(1, ['REP', 'DAI', 'BTC'], powerPokeOpts, { from: validReporterPoker });
      await time.increase(5);

      // 2nd poke
      await expect(
        oracle.pokeFromSlasher(2, ['REP'], powerPokeOpts, { from: validSlasherPoker, gasPrice: gwei(35) }),
      ).to.be.revertedWith('INTERVAL_IS_OK');
      await expect(
        oracle.pokeFromSlasher(2, ['DAI'], powerPokeOpts, { from: validSlasherPoker, gasPrice: gwei(35) }),
      ).to.be.revertedWith('INTERVAL_IS_OK');
      await expect(
        oracle.pokeFromSlasher(2, ['BTC'], powerPokeOpts, { from: validSlasherPoker, gasPrice: gwei(35) }),
      ).to.be.revertedWith('INTERVAL_IS_OK');
    });

    it('slasherHeartbeat should works correctly', async function() {
      // 1st poke
      let res = await oracle.pokeFromReporter(1, ['REP', 'DAI', 'BTC'], powerPokeOpts, { from: validReporterPoker });
      await time.increase(SLASHER_HEARTBEAT_INTERVAL - 5);

      // 2nd poke
      res = await oracle.pokeFromSlasher(2, ['REP', 'DAI', 'BTC'], powerPokeOpts, { from: validSlasherPoker, gasPrice: gwei(35) });
      const secondTimestamp = await getResTimestamp(res);

      expect(await oracle.lastSlasherUpdates(2)).to.be.equal(secondTimestamp);

      await time.increase(SLASHER_HEARTBEAT_INTERVAL - 5);

      await expect(oracle.slasherHeartbeat(2, { from: validSlasherPoker }))
        .to.be.revertedWith('BELOW_HEARTBEAT_INTERVAL');
      await time.increase(6);

      res = await oracle.slasherHeartbeat(2, { from: validSlasherPoker })

      const thirdTimestamp = await getResTimestamp(res);

      expect(await oracle.lastSlasherUpdates(2)).to.be.equal(thirdTimestamp);

      await time.increase(SLASHER_HEARTBEAT_INTERVAL + 5);
      res = await oracle.slasherHeartbeat(2, { from: validSlasherPoker });
      const fourthTimestamp = await getResTimestamp(res);
      expect(await oracle.lastSlasherUpdates(2)).to.be.equal(fourthTimestamp);

      expectEvent.notEmitted(res, 'AnchorPriceUpdated');
    });

    it('should deny another user calling an behalf of slasher', async function() {
      await expect(oracle.pokeFromSlasher(2, ['REP'], powerPokeOpts, { from: alice }))
        .to.be.revertedWith('INVALID_POKER_KEY');
    });

    it('should deny another user calling a slasherUpdate', async function() {
      await expect(oracle.slasherHeartbeat(2, { from: alice }))
        .to.be.revertedWith('INVALID_POKER_KEY');
    });

    it('should deny calling with an empty array', async function() {
      await expect(oracle.pokeFromSlasher(2, [], powerPokeOpts, { from: validSlasherPoker }))
        .to.be.revertedWith('MISSING_SYMBOLS');
    });

    it('should deny poking with unknown token symbols', async function() {
      await expect(oracle.pokeFromSlasher(2, ['FOO'], powerPokeOpts, { from: validSlasherPoker }))
        .to.be.revertedWith('TOKEN_NOT_FOUND');
    });

    it('should deny poking when the contract is paused', async function() {
      await oracle.pause({ from: owner });
      await expect(oracle.pokeFromSlasher(2, ['REP'], powerPokeOpts, { from: validSlasherPoker }))
        .to.be.revertedWith('PAUSED');
    });

    it('should deny slasher updating when the contract is paused', async function() {
      await oracle.pause({ from: owner });
      await expect(oracle.slasherHeartbeat(2, { from: validSlasherPoker }))
        .to.be.revertedWith('PAUSED');
    });

    it('should deny poking from a contract', async function() {
      await staking.mockSetUser(2, bob, proxyCall.address, ether(400));
      const data = oracle.contract.methods.pokeFromSlasher(2, ['REP'], powerPokeOpts).encodeABI();
      await expect(proxyCall.makeCall(oracle.address, data)).to.be.revertedWith('CONTRACT_CALL');
    });

    it('should deny heartbeat from a contract', async function() {
      await staking.mockSetUser(2, bob, proxyCall.address, ether(400));
      const data = oracle.contract.methods.slasherHeartbeat(2).encodeABI();
      await expect(proxyCall.makeCall(oracle.address, data)).to.be.revertedWith('CONTRACT_CALL');
    });
  });

  describe('poke (permissionless)', () => {
    it('should allow anyone calling the poke method', async function() {
      await poke.addClient(oracle.address, oracleClientOwner, true, gwei(300), MIN_REPORT_INTERVAL, MAX_REPORT_INTERVAL, { from: owner });
      await poke.setOracle(oracle.address, { from: owner });

      await cvpToken.approve(poke.address, ether(30000), { from: alice })
      await poke.addCredit(oracle.address, ether(30000), { from: alice });
      await poke.setBonusPlan(oracle.address, 1,  true, 25, 17520000, 100 * 1000, { from: oracleClientOwner });
      await poke.setBonusPlan(oracle.address, 2,  true, 2, 17520000, 10 * 1000, { from: oracleClientOwner });
      await poke.setSlasherHeartbeat(oracle.address, SLASHER_HEARTBEAT_INTERVAL, { from: oracleClientOwner });

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
      doNotExpectPriceUpdateEvent({
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

  describe('owner methods', () => {
    describe('setPowerPoke', () => {
      it('should allow the owner setting a new PowerPoke', async function() {
        await oracle.setPowerPoke(alice, { from: owner });
        expect(await oracle.powerPoke()).to.be.equal(alice);
      });

      it('should deny non-reporter calling the method', async function() {
        await expect(oracle.setPowerPoke(alice, { from: alice }))
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
    const CFG_USDT_ADDRESS = address(444);
    const CFG_ETH_ADDRESS = address(111);

    it('should respond with a correct values for a reported price', async function() {
      await oracle.stubSetPrice(CVP_SYMBOL_HASH, mwei('1.4'));

      expect(await oracle.getPriceByAsset(cvpToken.address)).to.be.equal(mwei('1.4'));
      expect(await oracle.getPriceBySymbolHash(CVP_SYMBOL_HASH)).to.be.equal(mwei('1.4'));
      expect(await oracle.getPriceBySymbol('CVP')).to.be.equal(mwei('1.4'));
      expect(await oracle.assetPrices(cvpToken.address)).to.be.equal(ether('1.4'));
    });

    it('should respond with a correct values for FIXED_USD price', async function() {
      await oracle.stubSetPrice(USDT_SYMBOL_HASH, mwei('1.4'));

      expect(await oracle.getPriceByAsset(CFG_USDT_ADDRESS)).to.be.equal(mwei('1'));
      expect(await oracle.getPriceBySymbolHash(USDT_SYMBOL_HASH)).to.be.equal(mwei('1'));
      expect(await oracle.getPriceBySymbol('USDT')).to.be.equal(mwei('1'));
      expect(await oracle.assetPrices(CFG_USDT_ADDRESS)).to.be.equal(tether('1'));
    });

    it('should respond with a correct values for FIXED_ETH price', async function() {
      await oracle.stubSetPrice(ETH_SYMBOL_HASH, mwei('1.4'));

      expect(await oracle.getPriceByAsset(CFG_ETH_ADDRESS)).to.be.equal(mwei('1.4'));
      expect(await oracle.getPriceBySymbolHash(ETH_SYMBOL_HASH)).to.be.equal(mwei('1.4'));
      expect(await oracle.getPriceBySymbol('ETH')).to.be.equal(mwei('1.4'));
    });
  })
});
