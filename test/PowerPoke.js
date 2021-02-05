const { expectEvent, constants } = require('@openzeppelin/test-helpers');
const { address, ether, mwei, gwei } = require('./helpers');
const { getTokenConfigs } = require('./localHelpers');

const chai = require('chai');
const MockCVP = artifacts.require('MockCVP');
const MockStaking = artifacts.require('MockStaking');
const StubOracle = artifacts.require('StubOracle');
const MockPoke = artifacts.require('MockPoke');
const MockFastGasOracle = artifacts.require('MockFastGasOracle');
const MockUniswapRouter = artifacts.require('MockUniswapRouter');

const { expect } = chai;

MockCVP.numberFormat = 'String';
MockStaking.numberFormat = 'String';
StubOracle.numberFormat = 'String';
StubOracle.numberFormat = 'String';
MockPoke.numberFormat = 'String';
MockFastGasOracle.numberFormat = 'String';

const ANCHOR_PERIOD = '45';
const WETH = address(111);

describe('PowerPoke', function () {
  let oracle;
  let poke;
  let staking;
  let cvpToken;
  let fastGasOracle;
  let powerPokeOptsCVP;
  let powerPokeOptsETH;
  let uniswapRouter;

  let deployer, owner, clientA, clientAOwner, reservoir, alice, alicePoker, bob, bobPoker, charlie, charliePoker, sink;

  before(async function () {
    [
      deployer,
      owner,
      clientA,
      clientAOwner,
      reservoir,
      alice,
      alicePoker,
      bob,
      bobPoker,
      charlie,
      charliePoker,
      sink,
    ] = await web3.eth.getAccounts();
    fastGasOracle = await MockFastGasOracle.new(gwei(500));
    uniswapRouter = await MockUniswapRouter.new(alice, WETH);
    await web3.eth.sendTransaction({ to: uniswapRouter.address, from: owner, value: ether(5000) });

    const powerPokeOptsStruct = {
      PowerPokeRewardOpts: {
        to: 'address',
        rewardsInEth: 'bool',
      },
    };
    powerPokeOptsCVP = web3.eth.abi.encodeParameter(powerPokeOptsStruct, {
      to: constants.ZERO_ADDRESS,
      rewardsInEth: false,
    });
    powerPokeOptsETH = web3.eth.abi.encodeParameter(powerPokeOptsStruct, {
      to: alice,
      rewardsInEth: true,
    });
  });

  beforeEach(async function () {
    cvpToken = await MockCVP.new(ether(1000000));
    staking = await MockStaking.new(cvpToken.address, 30, 30);
    oracle = await StubOracle.new(cvpToken.address, reservoir, ANCHOR_PERIOD, await getTokenConfigs(cvpToken.address));
    poke = await MockPoke.new(cvpToken.address, WETH, fastGasOracle.address, uniswapRouter.address, staking.address);
    await poke.initialize(owner, oracle.address);
    await cvpToken.transfer(reservoir, ether(100000), { from: deployer });
    await cvpToken.transfer(alice, ether(100000), { from: deployer });
    await cvpToken.approve(oracle.address, ether(100000), { from: reservoir });
  });

  describe('initialization', () => {
    it('should assign constructor and initializer args correctly', async function () {
      expect(await poke.owner()).to.be.equal(owner);
      expect(await poke.oracle()).to.be.equal(oracle.address);

      // immutables
      expect(await poke.CVP_TOKEN()).to.be.equal(cvpToken.address);
      expect(await poke.WETH_TOKEN()).to.be.equal(WETH);
      expect(await poke.FAST_GAS_ORACLE()).to.be.equal(fastGasOracle.address);
      expect(await poke.POWER_POKE_STAKING()).to.be.equal(staking.address);
      expect(await poke.UNISWAP_ROUTER()).to.be.equal(uniswapRouter.address);
    });

    it('should deny initializing again', async function () {
      await expect(poke.initialize(owner, sink)).to.be.revertedWith('Contract instance has already been initialized');
    });
  });

  describe('owner interface', () => {
    describe('addClient', () => {
      it('should allow adding a client', async function () {
        const res = await poke.addClient(clientA, clientAOwner, false, gwei(300), 5, 6, { from: owner });
        expectEvent(res, 'AddClient', {
          client: clientA,
          owner: clientAOwner,
          canSlash: false,
          gasPriceLimit: gwei(300),
          minReportInterval: '5',
          maxReportInterval: '6',
          slasherHeartbeat: '115792089237316195423570985008687907853269984665640564039457584007913129639935',
        });

        const client = await poke.clients(clientA);
        expect(client.owner).to.be.equal(clientAOwner);
        expect(client.canSlash).to.be.equal(false);
        expect(client.gasPriceLimit).to.be.equal(gwei(300));
        expect(client.minReportInterval).to.be.equal('5');
        expect(client.maxReportInterval).to.be.equal('6');
        expect(client.slasherHeartbeat).to.be.equal(
          '115792089237316195423570985008687907853269984665640564039457584007913129639935',
        );
      });

      it('should deny non-owner executing the method', async function () {
        await expect(
          poke.addClient(clientA, clientAOwner, false, gwei(300), 5, 6, { from: clientAOwner }),
        ).to.be.revertedWith('NOT_THE_OWNER');
      });

      it('should deny min interval greater to max', async function () {
        await expect(poke.addClient(clientA, clientAOwner, false, gwei(300), 7, 6, { from: owner })).to.be.revertedWith(
          'INVALID_REPORT_INTERVALS',
        );
      });

      it('should deny min interval equal to max', async function () {
        await expect(poke.addClient(clientA, clientAOwner, false, gwei(300), 7, 7, { from: owner })).to.be.revertedWith(
          'INVALID_REPORT_INTERVALS',
        );
      });

      it('should deny 0 min interval', async function () {
        await expect(poke.addClient(clientA, clientAOwner, false, gwei(300), 0, 7, { from: owner })).to.be.revertedWith(
          'INVALID_REPORT_INTERVALS',
        );
      });
    });

    describe('setCanSlashFlag', () => {
      beforeEach(async function () {
        await poke.addClient(clientA, clientAOwner, false, gwei(300), 5, 6, { from: owner });
      });

      it('should allow updating value', async function () {
        const res = await poke.setCanSlashFlag(clientA, true, { from: owner });
        expectEvent(res, 'SetCanSlashFlag', {
          client: clientA,
          canSlash: true,
        });

        const client = await poke.clients(clientA);
        expect(client.canSlash).to.be.equal(false);
      });

      it('should deny non-owner executing the method', async function () {
        await expect(poke.setCanSlashFlag(clientA, true, { from: clientAOwner })).to.be.revertedWith('NOT_THE_OWNER');
      });
    });

    describe('setClientActiveFlag', () => {
      beforeEach(async function () {
        await poke.addClient(clientA, clientAOwner, false, gwei(300), 5, 6, { from: owner });
      });

      it('should allow updating value', async function () {
        let client = await poke.clients(clientA);
        expect(client.active).to.be.equal(true);
        const res = await poke.setClientActiveFlag(clientA, false, { from: owner });
        expectEvent(res, 'SetClientActiveFlag', {
          client: clientA,
          active: false,
        });

        client = await poke.clients(clientA);
        expect(client.active).to.be.equal(false);
      });

      it('should deny non-owner executing the method', async function () {
        await expect(poke.setClientActiveFlag(clientA, true, { from: clientAOwner })).to.be.revertedWith(
          'NOT_THE_OWNER',
        );
      });
    });

    describe('setOracle', () => {
      it('should allow updating the oracle address', async function () {
        const res = await poke.setOracle(alice, { from: owner });
        expectEvent(res, 'SetOracle', {
          oracle: alice,
        });

        expect(await poke.oracle()).to.be.equal(alice);
      });

      it('should deny non-owner executing the method', async function () {
        await expect(poke.setOracle(alice, { from: clientAOwner })).to.be.revertedWith('NOT_THE_OWNER');
      });
    });
  });

  describe('client contract interface', () => {
    beforeEach(async function () {
      await poke.addClient(clientA, clientAOwner, true, gwei(300), 5, 6, { from: owner });
      await staking.mockSetUser(1, alice, alicePoker, ether(250));
      await staking.mockSetUser(2, bob, bobPoker, ether(100));
      await staking.mockSetUser(3, charlie, charliePoker, ether(0));
      await staking.setHDH(1);
    });

    describe('authorizations', () => {
      it('should correctly authorizeReporter', async function () {
        await poke.authorizeReporter(1, alicePoker);
        await expect(poke.authorizeReporter(1, alice)).to.be.revertedWith('INVALID_POKER_KEY');
        await expect(poke.authorizeReporter(2, bobPoker)).to.be.revertedWith('NOT_HDH');
      });

      it('should correctly authorizeNonReporter', async function () {
        await poke.authorizeNonReporter(2, bobPoker);
        await poke.authorizeNonReporter(3, charliePoker);
        await expect(poke.authorizeNonReporter(3, bobPoker)).to.be.revertedWith('INVALID_POKER_KEY');
        await expect(poke.authorizeNonReporter(1, alicePoker)).to.be.revertedWith('IS_HDH');
      });

      it('should correctly authorizeNonReporterWithDeposit with a custom min deposit', async function () {
        await poke.authorizeNonReporterWithDeposit(2, bobPoker, ether(100));
        await poke.authorizeNonReporterWithDeposit(2, bobPoker, ether(0));
        await poke.authorizeNonReporterWithDeposit(3, charliePoker, ether(0));

        await expect(poke.authorizeNonReporterWithDeposit(1, alicePoker, 0)).to.be.revertedWith('IS_HDH');
        await expect(poke.authorizeNonReporterWithDeposit(2, bobPoker, ether(300))).to.be.revertedWith(
          'INSUFFICIENT_DEPOSIT',
        );
        await expect(poke.authorizeNonReporterWithDeposit(3, charlie, ether(0))).to.be.revertedWith(
          'INVALID_POKER_KEY',
        );
        await expect(poke.authorizeNonReporterWithDeposit(3, bobPoker, ether(0))).to.be.revertedWith(
          'INVALID_POKER_KEY',
        );
      });

      it('should correctly authorizePoker', async function () {
        await poke.authorizePoker(1, alicePoker);
        await poke.authorizePoker(2, bobPoker);
        await poke.authorizePoker(3, charliePoker);
        await expect(poke.authorizePoker(3, bobPoker)).to.be.revertedWith('INVALID_POKER_KEY');
      });

      it('should correctly authorizePokerWithDeposit with a custom min deposit', async function () {
        await poke.authorizePokerWithDeposit(1, alicePoker, ether(100));
        await poke.authorizePokerWithDeposit(2, bobPoker, ether(100));
        await poke.authorizePokerWithDeposit(1, alicePoker, ether(0));
        await poke.authorizePokerWithDeposit(2, bobPoker, ether(0));
        await poke.authorizePokerWithDeposit(3, charliePoker, ether(0));

        await expect(poke.authorizePokerWithDeposit(1, alicePoker, ether(300))).to.be.revertedWith(
          'INSUFFICIENT_DEPOSIT',
        );
        await expect(poke.authorizePokerWithDeposit(2, bobPoker, ether(300))).to.be.revertedWith(
          'INSUFFICIENT_DEPOSIT',
        );
        await expect(poke.authorizePokerWithDeposit(2, charliePoker, ether(300))).to.be.revertedWith(
          'INSUFFICIENT_DEPOSIT',
        );
        await expect(poke.authorizePokerWithDeposit(3, charlie, ether(0))).to.be.revertedWith('INVALID_POKER_KEY');
        await expect(poke.authorizePokerWithDeposit(4, bobPoker, ether(0))).to.be.revertedWith('INVALID_POKER_KEY');
      });
    });

    describe('slashReporter', () => {
      const ACTIVE_PLAN_1 = '1';

      beforeEach(async function () {
        await cvpToken.approve(poke.address, ether(5000), { from: alice });
        expect(await poke.ownerOf(clientA)).to.be.equal(clientAOwner);
        await poke.setBonusPlan(clientA, ACTIVE_PLAN_1, true, 25, 17520000, 100 * 1000, { from: clientAOwner });
        await poke.addCredit(clientA, ether(5000), { from: alice });
        await oracle.stubSetPrice(web3.utils.keccak256('ETH'), mwei('1600'));
        await oracle.stubSetPrice(web3.utils.keccak256('CVP'), mwei('3'));
      });

      it('should allow slashing', async function () {
        const res = await poke.slashReporter(2, 4, { from: clientA });
        await expectEvent.inTransaction(res.tx, staking, 'MockSlash', {
          slasherId: '2',
          times: '4',
        });
      });

      it('should ignore slashing if the times is 0', async function () {
        const res = await poke.slashReporter(2, 0, { from: clientA });
        await expectEvent.notEmitted.inTransaction(res.tx, staking, 'Slash');
      });

      it('should deny slashing if the client is not active', async function () {
        await poke.setClientActiveFlag(clientA, false, { from: owner });
        await expect(poke.slashReporter(2, 4, { from: clientA })).to.be.revertedWith('INVALID_CLIENT');
      });

      it('should deny slashing if the client cant slash', async function () {
        await poke.setCanSlashFlag(clientA, false, { from: owner });
        await expect(poke.slashReporter(2, 4, { from: clientA })).to.be.revertedWith('INVALID_CLIENT');
      });
    });

    describe('reward', () => {
      const ACTIVE_PLAN_1 = '1';
      const NON_EXISTING_PLAN_2 = '2';
      const GAS_USED = '370000';
      const USER_ID = '1';

      beforeEach(async function () {
        await cvpToken.approve(poke.address, ether(5000), { from: alice });
        expect(await poke.ownerOf(clientA)).to.be.equal(clientAOwner);
        await poke.setBonusPlan(clientA, ACTIVE_PLAN_1, true, 25, 17520000, 100 * 1000, { from: clientAOwner });
        await poke.addCredit(clientA, ether(5000), { from: alice });
        await oracle.stubSetPrice(web3.utils.keccak256('ETH'), mwei('1600'));
        await oracle.stubSetPrice(web3.utils.keccak256('CVP'), mwei('3'));
        await staking.mockSetUser(1, alice, alicePoker, ether(25 * 1000 * 1000));
        await staking.mockSetUser(2, bob, bobPoker, ether(10 * 1000 * 1000));
        await staking.mockSetUser(3, charlie, charliePoker, ether(0));
      });

      it('should keep bonus part on the contract for CVP bonus option', async function () {
        await poke.reward(USER_ID, GAS_USED, ACTIVE_PLAN_1, powerPokeOptsCVP, { from: clientA, gasPrice: gwei(120) });
        await poke.reward(USER_ID, GAS_USED, ACTIVE_PLAN_1, powerPokeOptsCVP, { from: clientA, gasPrice: gwei(120) });
        const res = await poke.reward(USER_ID, GAS_USED, ACTIVE_PLAN_1, powerPokeOptsCVP, {
          from: clientA,
          gasPrice: gwei(120),
        });
        const EXPECTED_REWARD_PER_370_000 = ether('155.672009132420091324');
        expectEvent(res, 'RewardUser', {
          client: clientA,
          userId: USER_ID,
          bonusPlan: ACTIVE_PLAN_1,
          compensateInETH: false,
          gasUsed: GAS_USED,
          gasPrice: gwei(120),
          userDeposit: ether(25 * 1000 * 1000),
          ethPrice: mwei('1600'),
          cvpPrice: mwei('3'),
          compensationEvaluationCVP: ether('23.680000000000000000'),
          bonusCVP: ether('131.992009132420091324'),
          earnedCVP: EXPECTED_REWARD_PER_370_000,
          earnedETH: '0',
        });

        const expectedReward3 = BigInt(EXPECTED_REWARD_PER_370_000) * 3n;
        const expectedCredit = BigInt(ether(5000)) - expectedReward3;
        expect(await poke.rewards(USER_ID)).to.be.equal(expectedReward3.toString());
        expect(await poke.creditOf(clientA)).to.be.equal(expectedCredit.toString());
      });

      it('should ignore bonus part on the contract for CVP bonus option', async function () {
        expect((await poke.clients(clientA)).defaultMinDeposit).to.be.equal('0');
        const res = await poke.reward(3, GAS_USED, ACTIVE_PLAN_1, powerPokeOptsCVP, {
          from: clientA,
          gasPrice: gwei(120),
        });
        expectEvent(res, 'RewardUser', {
          client: clientA,
          userId: '3',
          bonusPlan: ACTIVE_PLAN_1,
          compensateInETH: false,
          gasUsed: GAS_USED,
          gasPrice: gwei(120),
          userDeposit: ether(0),
          ethPrice: mwei('1600'),
          cvpPrice: mwei('3'),
          compensationEvaluationCVP: ether('23.680000000000000000'),
          bonusCVP: ether('0'),
          earnedCVP: '23680000000000000000',
          earnedETH: '0',
        });

        expect(await poke.rewards('3')).to.be.equal(ether('23.680000000000000000'));
        expect(await poke.creditOf(clientA)).to.be.equal(ether('4976.32'));
      });

      it('should convert bonus part to ETH and transfer to the given address', async function () {
        await poke.reward(USER_ID, GAS_USED, ACTIVE_PLAN_1, powerPokeOptsETH, { from: clientA, gasPrice: gwei(120) });
        await poke.reward(USER_ID, GAS_USED, ACTIVE_PLAN_1, powerPokeOptsETH, { from: clientA, gasPrice: gwei(120) });
        const res = await poke.reward(USER_ID, GAS_USED, ACTIVE_PLAN_1, powerPokeOptsETH, {
          from: clientA,
          gasPrice: gwei(120),
        });
        const EXPECTED_REWARD_PER_370_000 = ether('155.672009132420091324');
        const EXPECTED_BONUS_PER_370_000 = ether('131.992009132420091324');
        expectEvent(res, 'RewardUser', {
          client: clientA,
          userId: USER_ID,
          bonusPlan: ACTIVE_PLAN_1,
          compensateInETH: true,
          gasUsed: GAS_USED,
          gasPrice: gwei(120),
          userDeposit: ether(25 * 1000 * 1000),
          ethPrice: mwei('1600'),
          cvpPrice: mwei('3'),
          compensationEvaluationCVP: ether('23.680000000000000000'),
          bonusCVP: ether('131.992009132420091324'),
          earnedCVP: ether('131.992009132420091324'),
          earnedETH: ether('0.0444'),
        });

        const expectedBonus3 = BigInt(EXPECTED_BONUS_PER_370_000) * 3n;
        const expectedCredit = BigInt(ether(5000)) - BigInt(EXPECTED_REWARD_PER_370_000) * 3n;
        expect(await poke.rewards(USER_ID)).to.be.equal(expectedBonus3.toString());
        expect(await poke.creditOf(clientA)).to.be.equal(expectedCredit.toString());
      });

      it('should revert if there is a lack of credits', async function () {
        await poke.withdrawCredit(clientA, sink, ether(5000), { from: clientAOwner });
        await expect(poke.reward(1, 370000, ACTIVE_PLAN_1, powerPokeOptsCVP, { from: clientA })).to.be.revertedWith(
          'NOT_ENOUGH_CREDITS',
        );
      });

      it('should do nothing for 0 gasUsed', async function () {
        const res = await poke.reward(1, 0, ACTIVE_PLAN_1, powerPokeOptsCVP, { from: clientA });
        expectEvent.notEmitted(res, 'RewardUser');
      });

      it('should revert if there is no such bonus plan', async function () {
        await expect(
          poke.reward(1, 370000, NON_EXISTING_PLAN_2, powerPokeOptsCVP, { from: clientA }),
        ).to.be.revertedWith('INACTIVE_BONUS_PLAN');
      });

      it('should revert if the client is not registered', async function () {
        await expect(poke.reward(1, 370000, ACTIVE_PLAN_1, powerPokeOptsCVP, { from: alice })).to.be.revertedWith(
          'INVALID_CLIENT',
        );
      });

      it('should revert if the client is disabled', async function () {
        await poke.setClientActiveFlag(clientA, false, { from: owner });
        await expect(poke.reward(1, 370000, ACTIVE_PLAN_1, powerPokeOptsCVP, { from: clientA })).to.be.revertedWith('');
      });
    });
  });

  describe('poker interface', () => {
    beforeEach(async function () {
      await poke.addClient(clientA, clientAOwner, true, gwei(300), 5, 6, { from: owner });
      await cvpToken.transfer(poke.address, ether(2000), { from: alice });
      await poke.mockSetReward(2, ether(1000));
      await staking.mockSetUser(1, alice, alicePoker, ether(250));
      await staking.mockSetUser(2, bob, bobPoker, ether(100));
      await staking.mockSetUser(3, charlie, charliePoker, ether(0));
    });

    describe('withdrawRewards', () => {
      it('should allow admin key withdrawing rewards', async function () {
        expect(await poke.rewards(2)).to.be.equal(ether(1000));
        expect(await cvpToken.balanceOf(poke.address)).to.be.equal(ether(2000));
        expect(await cvpToken.balanceOf(sink)).to.be.equal(ether(0));

        const res = await poke.withdrawRewards(2, sink, { from: bob });
        expectEvent(res, 'WithdrawRewards', {
          userId: '2',
          to: sink,
          amount: ether(1000),
        });

        expect(await poke.rewards(2)).to.be.equal(ether(0));
        expect(await cvpToken.balanceOf(poke.address)).to.be.equal(ether(1000));
        expect(await cvpToken.balanceOf(sink)).to.be.equal(ether(1000));
      });

      it('should allow poker key withdrawing rewards if allowed', async function () {
        await poke.setPokerKeyRewardWithdrawAllowance(2, true, { from: bob });
        expect(await poke.rewards(2)).to.be.equal(ether(1000));
        expect(await cvpToken.balanceOf(poke.address)).to.be.equal(ether(2000));
        expect(await cvpToken.balanceOf(sink)).to.be.equal(ether(0));

        const res = await poke.withdrawRewards(2, sink, { from: bobPoker });
        expectEvent(res, 'WithdrawRewards', {
          userId: '2',
          to: sink,
          amount: ether(1000),
        });

        expect(await poke.rewards(2)).to.be.equal(ether(0));
        expect(await cvpToken.balanceOf(poke.address)).to.be.equal(ether(1000));
        expect(await cvpToken.balanceOf(sink)).to.be.equal(ether(1000));
      });

      it('should deny poker key withdrawing rewards if not allowed', async function () {
        await expect(poke.withdrawRewards(2, sink, { from: bobPoker })).to.be.revertedWith('INVALID_AMIN_KEY');
      });

      it('should deny withdrawing rewards to the 0 address', async function () {
        await expect(poke.withdrawRewards(2, constants.ZERO_ADDRESS, { from: bob })).to.be.revertedWith('0_ADDRESS');
      });

      it('should deny withdrawing if there is no reward', async function () {
        await expect(poke.withdrawRewards(1, sink, { from: alice })).to.be.revertedWith('NOTHING_TO_WITHDRAW');
      });
    });

    describe('setPokerKeyRewardWithdrawAllowance', () => {
      it('should allow the admin key setting the flag', async function () {
        expect(await poke.pokerKeyRewardWithdrawAllowance(1)).to.be.equal(false);
        const res = await poke.setPokerKeyRewardWithdrawAllowance(1, true, { from: alice });
        expectEvent(res, 'SetPokerKeyRewardWithdrawAllowance', {
          userId: '1',
          allow: true,
        });
        expect(await poke.pokerKeyRewardWithdrawAllowance(1)).to.be.equal(true);
      });

      it('should deny non-admin key setting the flag', async function () {
        await expect(poke.setPokerKeyRewardWithdrawAllowance(1, true, { from: alicePoker })).to.be.revertedWith(
          'INVALID_AMIN_KEY',
        );
      });
    });
  });

  describe('client owner interface', () => {
    beforeEach(async function () {
      await poke.addClient(clientA, clientAOwner, true, gwei(300), 5, 6, { from: owner });
    });

    describe('addCredit', () => {
      it('should increment balance', async function () {
        expect(await poke.creditOf(clientA)).to.be.equal(ether(0));
        await cvpToken.transfer(clientAOwner, ether(20), { from: alice });

        await cvpToken.approve(poke.address, ether(20), { from: clientAOwner });
        let res = await poke.addCredit(clientA, ether(20), { from: clientAOwner });
        expect(await poke.creditOf(clientA)).to.be.equal(ether(20));
        expectEvent(res, 'AddCredit', {
          client: clientA,
          amount: ether(20),
        });

        await cvpToken.approve(poke.address, ether(30), { from: alice });
        res = await poke.addCredit(clientA, ether(30), { from: alice });
        expectEvent(res, 'AddCredit', {
          client: clientA,
          amount: ether(30),
        });
        expect(await poke.creditOf(clientA)).to.be.equal(ether(50));
      });

      it('should allow non-owner calling the method', async function () {
        await cvpToken.transfer(bob, ether(20), { from: alice });
        await cvpToken.approve(poke.address, ether(20), { from: bob });
        await poke.addCredit(clientA, ether(20), { from: bob });
        expect(await poke.creditOf(clientA)).to.be.equal(ether(20));
      });

      it('should deny calling the method on nonExistant client', async function () {
        await cvpToken.approve(poke.address, ether(20), { from: alice });
        await expect(poke.addCredit(alice, ether(20), { from: alice })).to.be.revertedWith('ONLY_ACTIVE_CLIENT');
      });
    });

    describe('withdrawCredit', () => {
      beforeEach(async function () {
        await cvpToken.approve(poke.address, ether(50), { from: alice });
        await poke.addCredit(clientA, ether(50), { from: alice });
      });

      it('should decrement balance', async function () {
        expect(await poke.creditOf(clientA)).to.be.equal(ether(50));
        expect(await cvpToken.balanceOf(poke.address)).to.be.equal(ether(50));
        expect(await cvpToken.balanceOf(bob)).to.be.equal(ether(0));

        let res = await poke.withdrawCredit(clientA, bob, ether(20), { from: clientAOwner });
        expectEvent(res, 'WithdrawCredit', {
          client: clientA,
          amount: ether(20),
        });
        expect(await poke.creditOf(clientA)).to.be.equal(ether(30));
        expect(await cvpToken.balanceOf(poke.address)).to.be.equal(ether(30));
        expect(await cvpToken.balanceOf(bob)).to.be.equal(ether(20));

        res = await poke.withdrawCredit(clientA, bob, ether(30), { from: clientAOwner });
        expectEvent(res, 'WithdrawCredit', {
          client: clientA,
          amount: ether(30),
        });
        expect(await poke.creditOf(clientA)).to.be.equal(ether(0));
        expect(await cvpToken.balanceOf(clientA)).to.be.equal(ether(0));
        expect(await cvpToken.balanceOf(bob)).to.be.equal(ether(50));
      });

      it('should deny non-owner calling the method', async function () {
        await expect(poke.withdrawCredit(clientA, bob, ether(20), { from: bob })).to.be.revertedWith(
          'ONLY_CLIENT_OWNER',
        );
      });
    });

    describe('setReportIntervals', () => {
      it('should update report intervals', async function () {
        const res = await poke.setReportIntervals(clientA, 42, 43, { from: clientAOwner });
        expectEvent(res, 'SetReportIntervals', {
          client: clientA,
          minReportInterval: '42',
          maxReportInterval: '43',
        });
        const intervals = await poke.getMinMaxReportIntervals(clientA);
        expect(intervals.min).to.be.equal('42');
        expect(intervals.max).to.be.equal('43');
      });

      it('should deny min greater than max', async function () {
        await expect(poke.setReportIntervals(clientA, 43, 42, { from: clientAOwner })).to.be.revertedWith(
          'INVALID_REPORT_INTERVALS',
        );
      });

      it('should deny min equal to max', async function () {
        await expect(poke.setReportIntervals(clientA, 42, 42, { from: clientAOwner })).to.be.revertedWith(
          'INVALID_REPORT_INTERVALS',
        );
      });

      it('should deny 0 min', async function () {
        await expect(poke.setReportIntervals(clientA, 0, 42, { from: clientAOwner })).to.be.revertedWith(
          'INVALID_REPORT_INTERVALS',
        );
      });

      it('should deny non-owner calling the method', async function () {
        await expect(poke.setReportIntervals(clientA, 42, 43, { from: bob })).to.be.revertedWith('ONLY_CLIENT_OWNER');
      });
    });

    describe('setSlasherHeartbeat', () => {
      it('should update slasher heartbeat', async function () {
        const res = await poke.setSlasherHeartbeat(clientA, 42, { from: clientAOwner });
        expectEvent(res, 'SetSlasherHeartbeat', {
          client: clientA,
          slasherHeartbeat: '42',
        });
        const client = await poke.clients(clientA);
        expect(client.slasherHeartbeat).to.be.equal('42');
        expect(await poke.getSlasherHeartbeat(clientA)).to.be.equal('42');
      });

      it('should deny non-client owner executing the method', async function () {
        await expect(poke.setSlasherHeartbeat(clientA, 42, { from: bob })).to.be.revertedWith('ONLY_CLIENT_OWNER');
      });
    });

    describe('setGasPriceLimit', () => {
      it('should update gas price limit', async function () {
        const res = await poke.setGasPriceLimit(clientA, 10000, { from: clientAOwner });
        expectEvent(res, 'SetGasPriceLimit', {
          client: clientA,
          gasPriceLimit: '10000',
        });
        const client = await poke.clients(clientA);
        expect(client.gasPriceLimit).to.be.equal('10000');
      });

      it('should deny non-client owner executing the method', async function () {
        await expect(poke.setGasPriceLimit(clientA, 42, { from: bob })).to.be.revertedWith('ONLY_CLIENT_OWNER');
      });
    });

    describe('setMinimalDeposit', () => {
      it('should update the default min deposit', async function () {
        const res = await poke.setMinimalDeposit(clientA, ether(30), { from: clientAOwner });
        expectEvent(res, 'SetDefaultMinDeposit', {
          client: clientA,
          defaultMinDeposit: ether(30),
        });
        const client = await poke.clients(clientA);
        expect(client.defaultMinDeposit).to.be.equal(ether(30));
      });

      it('should deny non-client owner executing the method', async function () {
        await expect(poke.setMinimalDeposit(clientA, 42, { from: bob })).to.be.revertedWith('ONLY_CLIENT_OWNER');
      });
    });
  });

  describe('getters', () => {
    describe('getPokerBonus', () => {
      const ACTIVE_PLAN_1 = '1';
      const NON_EXISTING_PLAN_2 = '2';

      beforeEach(async function () {
        await poke.addClient(clientA, clientAOwner, true, gwei(300), 5, 6, { from: owner });
        await poke.setBonusPlan(clientA, ACTIVE_PLAN_1, true, 25, 17520000, 100 * 1000, { from: clientAOwner });
      });

      it('should provide the correct calculation', async function () {
        // gasUsed_ * userDeposit_ * plan.bonusNumerator / bonusDenominator / plan.perGas
        // (370 * 1000) * 9000e18 * 25 / 17520000 / (100 * 1000) + 1
        expect(await poke.getPokerBonus(clientA, ACTIVE_PLAN_1, 370 * 1000, ether(9000))).to.be.equal(
          ether('0.047517123287671232'),
        );
      });

      it('should revert for non-active bonus plan', async function () {
        await expect(poke.getPokerBonus(clientA, NON_EXISTING_PLAN_2, 370 * 1000, ether(9000))).to.be.revertedWith(
          'INACTIVE_BONUS_PLAN',
        );
      });
    });

    describe('getGasPriceFor', () => {
      beforeEach(async function () {
        await poke.addClient(clientA, clientAOwner, true, gwei(300), 5, 6, { from: owner });
      });

      it('should return tx.gasPrice if it is less than both the oracle and the client level limits', async function () {
        expect(await fastGasOracle.latestAnswer()).to.be.equal(gwei(500));
        expect(await poke.getGasPriceLimit(clientA)).to.be.equal(gwei(300));
        expect(await poke.getGasPriceFor(clientA, { gasPrice: gwei(35) })).to.be.equal(gwei(35));
      });

      it('should return clients gasLimit', async function () {
        expect(await fastGasOracle.latestAnswer()).to.be.equal(gwei(500));
        expect(await poke.getGasPriceLimit(clientA)).to.be.equal(gwei(300));
        expect(await poke.getGasPriceFor(clientA, { gasPrice: gwei(450) })).to.be.equal(gwei(300));
        expect(await poke.getGasPriceFor(clientA, { gasPrice: gwei(600) })).to.be.equal(gwei(300));
      });

      it('should return fastGas oracle', async function () {
        await fastGasOracle.setLatestAnswer(gwei(100));

        expect(await fastGasOracle.latestAnswer()).to.be.equal(gwei(100));
        expect(await poke.getGasPriceLimit(clientA)).to.be.equal(gwei(300));
        expect(await poke.getGasPriceFor(clientA, { gasPrice: gwei(450) })).to.be.equal(gwei(100));
        expect(await poke.getGasPriceFor(clientA, { gasPrice: gwei(150) })).to.be.equal(gwei(100));
      });
    });
  });
});
