const { constants, expectEvent, time } = require('@openzeppelin/test-helpers');
const { ether, strSum, deployProxied, getResTimestamp } = require('./helpers');
const { getTokenConfigs  } = require('./localHelpers');

const chai = require('chai');
const MockCVP = artifacts.require('MockCVP');
const MockOracle = artifacts.require('MockOracle');
const StubStaking = artifacts.require('StubStaking');

const { expect } = chai;

MockCVP.numberFormat = 'String';
StubStaking.numberFormat = 'String';

const MINIMAL_SLASHING_DEPOSIT = ether(50);
const SLASHER_SLASHING_REWARD_PCT = ether(5);
const PROTOCOL_SLASHING_REWARD_PCT = ether('1.5');
const DEPOSIT_TIMEOUT = '30';
const WITHDRAWAL_TIMEOUT = '180';

const USER_STATUS = {
  UNAUTHORIZED: '0',
  MEMBER: '1',
  HDH: '2'
};

describe('PowerPokeStaking', function () {
  let staking;
  let cvpToken;

  let deployer, owner, powerOracle, powerPoke, alice, bob, charlie, alicePoker, bobPoker, charliePoker, sink, reservoir;

  before(async function() {
    [deployer, owner, powerOracle, powerPoke, alice, bob, charlie, alicePoker, bobPoker, charliePoker, sink, reservoir] = await web3.eth.getAccounts();
  });

  beforeEach(async function() {
    cvpToken = await MockCVP.new(ether(1e9));
    staking = await deployProxied(
      StubStaking,
      [cvpToken.address],
      [owner, reservoir, powerOracle, SLASHER_SLASHING_REWARD_PCT, PROTOCOL_SLASHING_REWARD_PCT, DEPOSIT_TIMEOUT, WITHDRAWAL_TIMEOUT],
      { proxyAdminOwner: owner }
    );
  });

  describe('initialization', () => {
    it('should initialize correctly', async function() {
      expect(await staking.CVP_TOKEN()).to.be.equal(cvpToken.address);
      expect(await staking.owner()).to.be.equal(owner);
      expect(await staking.reservoir()).to.be.equal(reservoir);
      expect(await staking.slasher()).to.be.equal(powerOracle);
      expect(await staking.depositTimeout()).to.be.equal(DEPOSIT_TIMEOUT);
      expect(await staking.withdrawalTimeout()).to.be.equal(WITHDRAWAL_TIMEOUT);
      expect(await staking.slasherSlashingRewardPct()).to.be.equal(SLASHER_SLASHING_REWARD_PCT);
      expect(await staking.protocolSlashingRewardPct()).to.be.equal(PROTOCOL_SLASHING_REWARD_PCT);
    });

    it('should deny initializing again', async function() {
      await expect(staking.initialize(owner, reservoir, powerOracle, SLASHER_SLASHING_REWARD_PCT, PROTOCOL_SLASHING_REWARD_PCT, DEPOSIT_TIMEOUT, WITHDRAWAL_TIMEOUT))
        .to.be.revertedWith('Contract instance has already been initialized')
    });
  })

  describe('user interface', () => {
    describe('createUser', () => {
      it('should allow to create a user without initial deposit', async function() {
        const res = await staking.createUser(alice, alicePoker, 0, { from: bob });
        expectEvent(res, 'CreateUser', {
          userId: '1',
          adminKey: alice,
          pokerKey: alicePoker,
          initialDeposit: '0'
        })
        const user = await staking.users(1);
        expect(user.adminKey).to.equal(alice);
        expect(user.pokerKey).to.equal(alicePoker);
        expect(user.deposit).to.equal('0');
      });

      it('should allow to create a user with initial deposit', async function() {
        await cvpToken.transfer(bob, ether(1000), { from: deployer });
        await cvpToken.approve(staking.address, ether(30), { from: bob });

        const res = await staking.createUser(alice, alicePoker, ether(30), { from: bob });
        const txAt = await getResTimestamp(res);
        expectEvent(res, 'CreateUser', {
          userId: '1',
          adminKey: alice,
          pokerKey: alicePoker,
          initialDeposit: ether(30)
        })
        expectEvent(res, 'CreateDeposit', {
          userId: '1',
          depositor: bob,
          amount: ether(30),
          pendingDepositAfter: ether(30)
        })

        const user = await staking.users(1);
        expect(user.adminKey).to.equal(alice);
        expect(user.pokerKey).to.equal(alicePoker);
        expect(user.deposit).to.equal('0');
        expect(user.pendingDeposit).to.equal(ether(30));

        const pendingDeposit = await staking.getPendingDepositOf(1);
        expect(pendingDeposit.balance).to.be.equal(ether(30));
        expect(pendingDeposit.timeout).to.be.equal(strSum(txAt, DEPOSIT_TIMEOUT));
      });

      it('should correctly update id counter', async function() {
        let res = await staking.createUser(alice, alicePoker, 0, { from: bob });
        expectEvent(res, 'CreateUser', { userId: '1' });
        res = await staking.createUser(alice, alicePoker, 0, { from: bob });
        expectEvent(res, 'CreateUser', { userId: '2' });
        res = await staking.createUser(alice, alicePoker, 0, { from: bob });
        expectEvent(res, 'CreateUser', { userId: '3' });

        expect('0').to.be.eq(await staking.getLastDepositChange('1'));
      });

      it('should deny creating a user when the contract is paused', async function() {
        await staking.pause({ from: owner });
        await expect(staking.createUser(alice, alicePoker, 0, { from: bob }))
          .to.be.revertedWith('PAUSED');
      });
    });

    describe('updateUser', () => {
      beforeEach(async () => {
        await staking.createUser(alice, alicePoker, 0, { from: bob });
      });

      it('should allow the current admin updating their keys', async function() {
        const res = await staking.updateUser(1, bob, bobPoker, { from: alice });
        expectEvent(res, 'UpdateUser', {
          userId: '1',
          adminKey: bob,
          pokerKey: bobPoker,
        });
        const user = await staking.users(1);
        expect(user.adminKey).to.equal(bob);
        expect(user.pokerKey).to.equal(bobPoker);
      });

      it('should deny non-admin updating their keys', async function() {
        await expect(staking.updateUser(1, bob, bobPoker, { from: alicePoker }))
          .to.be.revertedWith('ONLY_ADMIN_ALLOWED');
      });
    });

    describe('createDeposit', () => {
      beforeEach(async () => {
        await staking.createUser(alice, alicePoker, 0, { from: bob });
      });

      it('should allow anyone depositing multiple times for a given user ID', async function() {
        await cvpToken.transfer(bob, ether(50), { from: deployer });
        await cvpToken.transfer(charlie, ether(50), { from: deployer });
        await cvpToken.approve(staking.address, ether(50), { from: bob });
        await cvpToken.approve(staking.address, ether(50), { from: charlie });

        let res = await staking.createDeposit(1, ether(10), { from: bob });
        let depositedAt = await getResTimestamp(res);
        expectEvent(res, 'CreateDeposit', {
          userId: '1',
          depositor: bob,
          pendingTimeout: strSum(depositedAt, DEPOSIT_TIMEOUT),
          amount: ether(10),
          pendingDepositAfter: ether(10)
        })

        let user = await staking.users(1);
        expect(await user.pendingDeposit).to.be.equal(ether(10));

        await time.increase(10);
        res = await staking.createDeposit(1, ether(20), { from: charlie });
        depositedAt = await getResTimestamp(res);
        expectEvent(res, 'CreateDeposit', {
          userId: '1',
          depositor: charlie,
          pendingTimeout: strSum(depositedAt, DEPOSIT_TIMEOUT),
          amount: ether(20),
          pendingDepositAfter: ether(30)
        })

        user = await staking.users(1);
        expect(await user.pendingDeposit).to.be.equal(ether(30));
      });

      it('should deny depositing 0 ', async function() {
        await expect(staking.createDeposit(1, 0, { from: bob }))
          .to.be.revertedWith('MISSING_AMOUNT');
      });

      it('should deny depositing for a non-existing user', async function() {
        await expect(staking.createDeposit(3, ether(30), { from: bob }))
          .to.be.revertedWith('INVALID_USER');
      });

      it('should deny creating a user when the contract is paused', async function() {
        await staking.pause({ from: owner });
        await expect(staking.createDeposit(1, ether(10), { from: bob }))
          .to.be.revertedWith('PAUSED');
      });
    })

    describe('executeDeposit', () => {
      let depositedAt;
      beforeEach(async () => {
        await staking.createUser(alice, alicePoker, 0, { from: bob });
        await cvpToken.transfer(bob, ether(50), { from: deployer });
        await cvpToken.transfer(charlie, ether(50), { from: deployer });
        await cvpToken.approve(staking.address, ether(50), { from: bob });
        await cvpToken.approve(staking.address, ether(50), { from: charlie });
      });

      it('should allow the adminKey executing deposit after the given timeout', async function() {
        let res = await staking.createDeposit(1, ether(10), { from: bob });
        depositedAt = await getResTimestamp(res);
        await time.increase(DEPOSIT_TIMEOUT);
        res = await staking.executeDeposit(1, { from: alice });
        expectEvent(res, 'ExecuteDeposit', {
          userId: '1',
          pendingTimeout: strSum(depositedAt, DEPOSIT_TIMEOUT),
          amount: ether(10),
          depositAfter: ether(10)
        })
        let user = await staking.users(1);
        expect(user.deposit).to.equal(ether(10));
        expect(user.pendingDeposit).to.equal(ether(0));
        expect(await getResTimestamp(res)).to.be.eq(await staking.getLastDepositChange('1'));

        expect(await staking.totalDeposit()).to.be.equal(ether(10));

        res = await staking.createDeposit(1, ether(20), { from: charlie });
        depositedAt = await getResTimestamp(res);
        await time.increase(DEPOSIT_TIMEOUT);
        res = await staking.executeDeposit(1, { from: alice });
        expectEvent(res, 'ExecuteDeposit', {
          userId: '1',
          pendingTimeout: strSum(depositedAt, DEPOSIT_TIMEOUT),
          amount: ether(20),
          depositAfter: ether(30)
        })

        user = await staking.users(1);
        expect(user.deposit).to.equal(ether(30));
        expect(user.pendingDeposit).to.equal(ether(0));

        expect(await staking.totalDeposit()).to.be.equal(ether(30));
      });

      it('should update the reporter and the highest deposit values if needed', async function() {
        await staking.createUser(bob, bobPoker, 0, { from: bob });

        await cvpToken.transfer(bob, ether(150), { from: deployer });
        await cvpToken.approve(staking.address, ether(150), { from: bob });

        expect(await staking.getHDHID()).to.be.equal('0');

        await staking.createDeposit(1, ether(10), { from: bob });
        await time.increase(DEPOSIT_TIMEOUT);
        let res = await staking.executeDeposit(1, { from: alice });
        expectEvent(res, 'ReporterChange', {
          prevId: '0',
          nextId: '1',
          highestDepositPrev: '0',
          actualDepositPrev: '0',
          actualDepositNext: ether(10),
        })

        await staking.createDeposit(2, ether(15), { from: bob });
        await time.increase(DEPOSIT_TIMEOUT);
        res = await staking.executeDeposit(2, { from: bob });
        expectEvent(res, 'ReporterChange', {
          prevId: '1',
          nextId: '2',
          highestDepositPrev: ether(10),
          actualDepositPrev: ether(10),
          actualDepositNext: ether(15),
        })

        await staking.createDeposit(1, ether(5), { from: bob });
        await time.increase(DEPOSIT_TIMEOUT);
        res = await staking.executeDeposit(1, { from: alice });
        expectEvent.notEmitted(res, 'ReporterChange')
      });

      it('should deny executing earlier than timeout', async function() {
        await staking.createDeposit(1, ether(5), { from: bob });
        await time.increase(DEPOSIT_TIMEOUT - 10);
        await expect(staking.executeDeposit(1, { from: alice }))
          .to.be.revertedWith('TIMEOUT_NOT_PASSED');
      });

      it('should deny executing with 0 pending deposit', async function() {
        await expect(staking.executeDeposit(1, { from: alice }))
          .to.be.revertedWith('NO_PENDING_DEPOSIT');
      });

      it('should deny executing for a non-existing user', async function() {
        await expect(staking.executeDeposit(3, { from: bob }))
          .to.be.revertedWith('ONLY_ADMIN_ALLOWED');
      });
    })

    describe('createWithdrawal', () => {
      const USER_ID = 42;

      beforeEach(async () => {
        await staking.stubSetUser(USER_ID, alice, alicePoker, ether(100), { from: bob });
        await staking.stubSetTotalDeposit(ether(100));
        await cvpToken.transfer(staking.address, ether(500), { from: deployer });
      });

      it('should allow the users admin key creating withdrawal all the deposit', async function() {
        expect(await cvpToken.balanceOf(sink)).to.be.equal('0');
        expect(await staking.totalDeposit()).to.be.equal(ether('100'));

        const res = await staking.createWithdrawal(USER_ID, ether(100), { from: alice });
        let createdAt = await getResTimestamp(res);

        expect(await getResTimestamp(res)).to.be.eq(await staking.getLastDepositChange(USER_ID));

        expect(await staking.totalDeposit()).to.be.equal(ether('0'));

        expectEvent(res, 'CreateWithdrawal', {
          userId: '42',
          pendingTimeout: strSum(createdAt, WITHDRAWAL_TIMEOUT),
          amount: ether(100),
          pendingWithdrawalAfter: ether(100),
          depositAfter: ether(0)
        });

        let user = await staking.users(USER_ID);
        expect(user.deposit).to.be.equal(ether(0));
        expect(user.pendingWithdrawal).to.be.equal(ether(100));
      });

      it('should allow the users admin key withdrawing part of the deposit', async function() {
        expect(await cvpToken.balanceOf(sink)).to.be.equal('0');
        expect(await staking.totalDeposit()).to.be.equal(ether('100'));

        const res = await staking.createWithdrawal(USER_ID, ether(80), { from: alice });
        let createdAt = await getResTimestamp(res);

        expect(await staking.totalDeposit()).to.be.equal(ether('20'));

        expectEvent(res, 'CreateWithdrawal', {
          userId: '42',
          pendingTimeout: strSum(createdAt, WITHDRAWAL_TIMEOUT),
          amount: ether(80),
          pendingWithdrawalAfter: ether(80),
          depositAfter: ether(20)
        });

        let user = await staking.users(USER_ID);
        expect(user.deposit).to.be.equal(ether(20));
        expect(user.pendingWithdrawal).to.be.equal(ether(80));
      });

      it('should deny non-admin withdrawing rewards', async function() {
        await expect(staking.createWithdrawal(USER_ID, ether(30), { from: alicePoker }))
          .to.be.revertedWith('ONLY_ADMIN_ALLOWED');
      });

      it('should deny withdrawing more than the rewards balance', async function() {
        await expect(staking.createWithdrawal(USER_ID, ether(101), { from: alice }))
          .to.be.revertedWith('AMOUNT_EXCEEDS_DEPOSIT');
      });

      it('should deny withdrawing 0 balance', async function() {
        await expect(staking.createWithdrawal(USER_ID, 0, { from: alice }))
          .to.be.revertedWith('MISSING_AMOUNT');
      });
    });

    describe('executeWithdrawal', () => {
      const USER_ID = 42;
      let createdAt;

      beforeEach(async () => {
        await staking.stubSetUser(USER_ID, alice, alicePoker, ether(100), { from: bob });
        await staking.stubSetTotalDeposit(ether(100));
        await cvpToken.transfer(staking.address, ether(500), { from: deployer });
        const res = await staking.createWithdrawal(USER_ID, ether(30), { from: alice });
        createdAt = await getResTimestamp(res);
      });

      it('should allow the users admin key withdrawing all the pending deposit', async function() {
        expect(await cvpToken.balanceOf(sink)).to.be.equal('0');
        expect(await staking.totalDeposit()).to.be.equal(ether('70'));

        let user = await staking.users(USER_ID);
        expect(user.deposit).to.be.equal(ether(70));
        expect(user.pendingWithdrawal).to.be.equal(ether(30));
        expect(user.pendingWithdrawalTimeout).to.be.equal(strSum(createdAt, WITHDRAWAL_TIMEOUT));

        await time.increase(10);

        let res = await staking.createWithdrawal(USER_ID, ether(70), { from: alice });
        createdAt = await getResTimestamp(res);

        user = await staking.users(USER_ID);
        expect(user.deposit).to.be.equal(ether(0));
        expect(user.pendingWithdrawal).to.be.equal(ether(100));
        expect(user.pendingWithdrawalTimeout).to.be.equal(strSum(createdAt, WITHDRAWAL_TIMEOUT));

        await time.increase(WITHDRAWAL_TIMEOUT);
        res = await staking.executeWithdrawal(USER_ID, sink, { from: alice });

        expect(await cvpToken.balanceOf(sink)).to.be.equal(ether('100'));
        expect(await staking.totalDeposit()).to.be.equal(ether('0'));

        expectEvent(res, 'ExecuteWithdrawal', {
          userId: '42',
          to: sink,
          pendingTimeout: strSum(createdAt, WITHDRAWAL_TIMEOUT),
          amount: ether(100),
        });
        user = await staking.users(USER_ID);
        expect(user.deposit).to.be.equal(ether(0));
        expect(user.pendingWithdrawal).to.be.equal(ether(0));
        expect(user.pendingWithdrawalTimeout).to.be.equal(ether(0));
      });

      it('should deny non-admin withdrawing rewards', async function() {
        await expect(staking.executeWithdrawal(USER_ID, sink, { from: alicePoker }))
          .to.be.revertedWith('ONLY_ADMIN_ALLOWED');
      });

      it('should deny withdrawing 0 balance', async function() {
        await time.increase(WITHDRAWAL_TIMEOUT);
        await staking.executeWithdrawal(USER_ID, sink, { from: alice });
        await expect(staking.executeWithdrawal(USER_ID, sink, { from: alice }))
          .to.be.revertedWith('NO_PENDING_WITHDRAWAL');
      });

      it('should deny withdrawing to 0 address', async function() {
        await expect(staking.executeWithdrawal(USER_ID, constants.ZERO_ADDRESS, { from: alice }))
          .to.be.revertedWith('CANT_WITHDRAW_TO_0');
      });
    });
  });

  describe('owner interface', () => {
    describe('setSlasher', () => {
      it('should allow the owner setting the value', async function() {
        await staking.setSlasher(charlie, { from: owner });
        expect(await staking.slasher()).to.be.equal(charlie);
      })

      it('should deny non-owner setting the value', async function() {
        await expect(staking.setSlasher(charlie, { from: alice }))
          .to.be.revertedWith('NOT_THE_OWNER');
      })
    })

    describe('setSlashingPct', () => {
      it('should allow the owner setting the value', async function() {
        await staking.setSlashingPct(ether(40), ether(30), { from: owner });
        expect(await staking.slasherSlashingRewardPct()).to.be.equal(ether(40));
        expect(await staking.protocolSlashingRewardPct()).to.be.equal(ether(30));
      })

      it('should deny a slasher and the protocol reward more than 100%', async function() {
        await expect(staking.setSlashingPct(ether(50), ether(51), { from: owner }))
          .to.be.revertedWith('INVALID_SUM');
      })

      it('should deny non-owner setting the value', async function() {
        await expect(staking.setSlashingPct(ether(40), ether(30), { from: alice }))
          .to.be.revertedWith('NOT_THE_OWNER');
      })
    });

    describe('pause', () => {
      it('should allow the owner pausing the contract', async function() {
        expect(await staking.paused()).to.be.false;
        await staking.pause({ from: owner });
        expect(await staking.paused()).to.be.true;
      });

      it('should deny non-owner pausing the contract', async function() {
        await expect(staking.pause({ from: alice }))
          .to.be.revertedWith('NOT_THE_OWNER');
      });
    })

    describe('unpause', () => {
      beforeEach(async function() {
        await staking.pause({ from: owner });
      });

      it('should allow the owner unpausing the contract', async function() {
        expect(await staking.paused()).to.be.true;
        await staking.unpause({ from: owner });
        expect(await staking.paused()).to.be.false;
      });

      it('should deny non-owner unpausing the contract', async function() {
        await expect(staking.unpause({ from: alice }))
          .to.be.revertedWith('NOT_THE_OWNER');
      });
    })
  });

  describe('setReporter', () => {
    beforeEach(async function() {
      const powerOracle = await MockOracle.new(cvpToken.address, constants.ZERO_ADDRESS, 1, await getTokenConfigs(cvpToken.address));
      await staking.setSlasher(powerOracle.address, { from: owner });
    });

    it('should allow setting reporter if there is another user with a higher deposit', async function() {
      await staking.stubSetUser(1, alice, alicePoker, ether(100), { from: bob });
      await staking.stubSetUser(2, bob, bobPoker, ether(200), { from: bob });

      await staking.stubSetReporter(1, ether(300));
      expect(await staking.getHDHID()).to.be.equal('1');
      expect(await staking.getHighestDeposit()).to.be.equal(ether(300));

      await staking.setHDH(2);
      expect(await staking.getHDHID()).to.be.equal('2');
      expect(await staking.getHighestDeposit()).to.be.equal(ether(200));
    });

    it('should deny setting reporter with not the highest deposit', async function() {
      await staking.stubSetUser(1, alice, alicePoker, ether(100), { from: bob });
      await staking.stubSetUser(2, bob, bobPoker, ether(100), { from: bob });

      await staking.stubSetReporter(1, ether(300));

      await expect(staking.setHDH(2))
        .to.be.revertedWith('INSUFFICIENT_CANDIDATE_DEPOSIT');
    });
  });

  describe('slash', () => {
    const SLASHER_ID = '42';
    const REPORTER_ID = '5';

    beforeEach(async function() {
      await cvpToken.transfer(staking.address, ether(10000), { from: deployer });

      await staking.stubSetUser(REPORTER_ID, alice, alicePoker, ether(500), { from: bob });
      await staking.stubSetUser(SLASHER_ID, bob, bobPoker, ether(60), { from: bob });
      await staking.stubSetTotalDeposit(ether(560), { from: bob });
      await staking.stubSetReporter(REPORTER_ID, ether(600), { from: bob });
      await staking.setSlasher(powerPoke, { from: owner });
    });

    it('should allow slashing current reporter', async function() {
      expect(await staking.getDepositOf(REPORTER_ID)).to.be.equal(ether(500));
      expect(await staking.getDepositOf(SLASHER_ID)).to.be.equal(ether(60));
      expect(await cvpToken.balanceOf(reservoir)).to.be.equal('0');
      expect(await staking.totalDeposit()).to.be.equal(ether(560));
      expect(await staking.slasherSlashingRewardPct()).to.be.equal(ether(5));
      expect(await staking.protocolSlashingRewardPct()).to.be.equal(ether('1.5'));

      const res = await staking.slashHDH(SLASHER_ID, 4, { from: powerPoke });
      expectEvent(res, 'Slash', {
        slasherId: SLASHER_ID,
        reporterId: REPORTER_ID,
        // 4 * 500 * 0.05 = 100
        slasherReward: ether(100),
        // 4 * 500 * 0.015 = 100
        reservoirReward: ether(30)
      })

      expect(await staking.totalDeposit()).to.be.equal(ether(530));
      // 500 - 100 - 30 = 370
      expect(await staking.getDepositOf(REPORTER_ID)).to.be.equal(ether(370));
      // 100 + 100 = 200
      expect(await staking.getDepositOf(SLASHER_ID)).to.be.equal(ether(160));
      expect(await cvpToken.balanceOf(reservoir)).to.be.equal(ether(30));

      expect(await staking.getHDHID()).to.be.equal(REPORTER_ID);

      expectEvent(res, 'Slash', {
        slasherId: '42',
        reporterId: '5',
        // 500 * 5% * 4 = 25 * 4 = 100
        slasherReward: ether(100),
        // 500 * 1.5% * 4 = 7.5 * 4 = 30
        reservoirReward: ether(30)
      })
    });

    it('should change the reporterId to the slasher the reporters deposit becomes lesser', async function() {
      await staking.slashHDH(SLASHER_ID, 4, { from: powerPoke });

      expect(await staking.getDepositOf(REPORTER_ID)).to.be.equal(ether(370));
      expect(await staking.getDepositOf(SLASHER_ID)).to.be.equal(ether(160));

      await staking.slashHDH(SLASHER_ID, 4, { from: powerPoke });
      expect(await staking.getDepositOf(REPORTER_ID)).to.be.equal(ether(273.8));
      expect(await staking.getDepositOf(SLASHER_ID)).to.be.equal(ether(234));

      const res = await staking.slashHDH(SLASHER_ID, 4, { from: powerPoke });
      expect(await staking.getDepositOf(REPORTER_ID)).to.be.equal(ether('202.612'));
      expect(await staking.getDepositOf(SLASHER_ID)).to.be.equal(ether('288.76'));

      expect(await staking.getHDHID()).to.be.equal(SLASHER_ID);

      expectEvent(res, 'ReporterChange', {
        prevId: REPORTER_ID,
        nextId: SLASHER_ID,
        highestDepositPrev: ether(600),
        actualDepositPrev: ether('202.612'),
        actualDepositNext: ether('288.76')
      })
    });

    it('should work correctly with 0 slasher/reservoir rewardPct values', async function() {
      await staking.setSlashingPct(ether(0), ether(0), { from: owner });
      expect(await staking.slasherSlashingRewardPct()).to.be.equal(ether(0));
      expect(await staking.protocolSlashingRewardPct()).to.be.equal(ether(0));

      expect(await staking.getDepositOf(REPORTER_ID)).to.be.equal(ether(500));
      expect(await staking.getDepositOf(SLASHER_ID)).to.be.equal(ether(60));
      expect(await cvpToken.balanceOf(reservoir)).to.be.equal('0');
      expect(await staking.totalDeposit()).to.be.equal(ether(560));
      expect(await staking.slasherSlashingRewardPct()).to.be.equal(ether(0));
      expect(await staking.protocolSlashingRewardPct()).to.be.equal(ether(0));

      const res = await staking.slashHDH(SLASHER_ID, 4, { from: powerPoke });
      expectEvent(res, 'Slash', {
        slasherId: SLASHER_ID,
        reporterId: REPORTER_ID,
        slasherReward: ether(0),
        reservoirReward: ether(0)
      })

      expect(await staking.totalDeposit()).to.be.equal(ether(560));
      expect(await staking.getDepositOf(REPORTER_ID)).to.be.equal(ether(500));
      expect(await staking.getDepositOf(SLASHER_ID)).to.be.equal(ether(60));
      expect(await cvpToken.balanceOf(reservoir)).to.be.equal(ether(0));
      expect(await staking.getHDHID()).to.be.equal(REPORTER_ID);
    });

    it('should deny slashing if the slasher deposit is not sufficient', async function() {
      await staking.stubSetUser(SLASHER_ID, bob, bobPoker, ether(40), { from: bob });
      await expect(staking.slashHDH(SLASHER_ID, 100, { from: powerPoke }))
        .to.be.revertedWith('INSUFFICIENT_HDH_DEPOSIT');
    });

    it('should deny non-powerPoke calling the method', async function() {
      await expect(staking.slashHDH(SLASHER_ID, 4, { from: owner }))
        .to.be.revertedWith('ONLY_SLASHER_ALLOWED');
    });
  })

  describe('viewers', () => {
    beforeEach(async function() {
      await staking.stubSetReporter(3, ether(50));

      // it's ok to use the same keys for different users
      await staking.stubSetUser(1, alice, alicePoker, ether(30));
      await staking.stubSetUser(2, bob, bobPoker, ether(50));
      await staking.stubSetUser(3, charlie, charliePoker, ether(100));
    });

    describe('getUserStatus', () => {
      it('should respond with UNAUTHORIZED if there is not enough deposit', async function() {
        expect(await staking.getUserStatus(1, alicePoker, MINIMAL_SLASHING_DEPOSIT)).to.be.equal(USER_STATUS.UNAUTHORIZED);
      });

      it('should respond with UNAUTHORIZED if there is no match between a poker key and a user id', async function() {
        expect(await staking.getUserStatus(2, alicePoker, MINIMAL_SLASHING_DEPOSIT)).to.be.equal(USER_STATUS.UNAUTHORIZED);
      });

      it('should respond with HDH if there is enough deposit, but not a reporter', async function() {
        expect(await staking.getUserStatus(2, bobPoker, MINIMAL_SLASHING_DEPOSIT)).to.be.equal(USER_STATUS.HDH);
      });

      it('should respond with MEMBER if there is enough deposit and is a reporter', async function() {
        expect(await staking.getUserStatus(3, charliePoker, MINIMAL_SLASHING_DEPOSIT)).to.be.equal(USER_STATUS.MEMBER);
      });

      it('should respond with UNAUTHORIZED if there is no match between a reporter and a user id', async function() {
        expect(await staking.getUserStatus(3, alicePoker, MINIMAL_SLASHING_DEPOSIT)).to.be.equal(USER_STATUS.UNAUTHORIZED);
      });
    })

    describe('authorizeHDH', () => {
      it('should authorize a valid reporter', async function() {
        await staking.authorizeHDH(3, charliePoker);
      });

      it('should not authorize an invalid reporter', async function() {
        await expect(staking.authorizeHDH(2, bobPoker))
          .to.be.revertedWith('NOT_HDH');
      });

      it('should not authorize a valid reporter with an invalid poker key', async function() {
        await expect(staking.authorizeHDH(3, bobPoker))
          .to.be.revertedWith('INVALID_POKER_KEY');
      });
    })

    describe('authorizeNonHDH', () => {
      it('should authorize a valid non-HDH member', async function() {
        await staking.authorizeNonHDH(2, bobPoker, MINIMAL_SLASHING_DEPOSIT);
      });

      it('should not authorize the HDH member', async function() {
        await expect(staking.authorizeNonHDH(3, charliePoker, MINIMAL_SLASHING_DEPOSIT))
          .to.be.revertedWith('IS_HDH');
      });

      it('should not authorize a valid non-HDH member with an invalid poker key', async function() {
        await expect(staking.authorizeNonHDH(1, bobPoker, 0))
          .to.be.revertedWith('INVALID_POKER_KEY');
      });
    })

    describe('authorizeMember', () => {
      it('should authorize a valid slasher', async function() {
        await staking.authorizeMember(2, bobPoker, MINIMAL_SLASHING_DEPOSIT);
      });

      it('should not authorize an insufficient deposit', async function() {
        await expect(staking.authorizeMember(1, alicePoker, MINIMAL_SLASHING_DEPOSIT))
          .to.be.revertedWith('INSUFFICIENT_DEPOSIT');
      });

      it('should not authorize a valid slasher with an invalid poker key', async function() {
        await expect(staking.authorizeMember(2, alicePoker, MINIMAL_SLASHING_DEPOSIT))
          .to.be.revertedWith('INVALID_POKER_KEY');
      });
    })
  });
});
