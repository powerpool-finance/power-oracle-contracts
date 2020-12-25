const { constants, expectEvent } = require('@openzeppelin/test-helpers');
const { ether, deployProxied, getResTimestamp } = require('./helpers');
const { getTokenConfigs  } = require('./localHelpers');

const { solidity } = require('ethereum-waffle');

const chai = require('chai');
const MockCVP = artifacts.require('MockCVP');
const MockOracle = artifacts.require('MockOracle');
const StubStaking = artifacts.require('StubStaking');

chai.use(solidity);
const { expect } = chai;

MockCVP.numberFormat = 'String';
StubStaking.numberFormat = 'String';

const MINIMAL_SLASHING_DEPOSIT = ether(50);
const SLASHER_SLASHING_REWARD_PCT = ether(5);
const PROTOCOL_SLASHING_REWARD_PCT = ether('1.5');

const USER_STATUS = {
  UNAUTHORIZED: '0',
  CAN_REPORT: '1',
  CAN_SLASH: '2'
};

describe('PowerOracleStaking', function () {
  let staking;
  let cvpToken;

  let deployer, owner, powerOracle, alice, bob, charlie, alicePoker, bobPoker, charliePoker, sink, reservoir;

  before(async function() {
    [deployer, owner, powerOracle, alice, bob, charlie, alicePoker, bobPoker, charliePoker, sink, reservoir] = await web3.eth.getAccounts();
  });

  beforeEach(async function() {
    cvpToken = await MockCVP.new(ether(1e9));
    staking = await deployProxied(
      StubStaking,
      [cvpToken.address, reservoir],
      [owner, powerOracle, MINIMAL_SLASHING_DEPOSIT, SLASHER_SLASHING_REWARD_PCT, PROTOCOL_SLASHING_REWARD_PCT],
      { proxyAdminOwner: owner }
    );
  });

  describe('initialization', () => {
    it('should initialize correctly', async function() {
      expect(await staking.cvpToken()).to.be.equal(cvpToken.address);
      expect(await staking.owner()).to.be.equal(owner);
      expect(await staking.powerOracle()).to.be.equal(powerOracle);
      expect(await staking.minimalSlashingDeposit()).to.be.equal(MINIMAL_SLASHING_DEPOSIT);
      expect(await staking.slasherSlashingRewardPct()).to.be.equal(SLASHER_SLASHING_REWARD_PCT);
      expect(await staking.protocolSlashingRewardPct()).to.be.equal(PROTOCOL_SLASHING_REWARD_PCT);
    });

    it('should deny initializing again', async function() {
      await expect(staking.initialize(owner, powerOracle, MINIMAL_SLASHING_DEPOSIT, SLASHER_SLASHING_REWARD_PCT, PROTOCOL_SLASHING_REWARD_PCT))
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

      it('should allow to create a user without initial deposit', async function() {
        await cvpToken.transfer(bob, ether(1000), { from: deployer });
        await cvpToken.approve(staking.address, ether(30), { from: bob });

        const res = await staking.createUser(alice, alicePoker, ether(30), { from: bob });
        expectEvent(res, 'CreateUser', {
          userId: '1',
          adminKey: alice,
          pokerKey: alicePoker,
          initialDeposit: ether(30)
        })
        expectEvent(res, 'Deposit', {
          userId: '1',
          depositor: bob,
          amount: ether(30),
          depositAfter: ether(30)
        })

        const user = await staking.users(1);
        expect(user.adminKey).to.equal(alice);
        expect(user.pokerKey).to.equal(alicePoker);
        expect(user.deposit).to.equal(ether(30));
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

      it('should allow creating a user with deposit', async function() {
        await cvpToken.transfer(bob, ether(50), { from: deployer });
        await cvpToken.approve(staking.address, ether(50), { from: bob });
        let res = await staking.createUser(alice, alicePoker, ether(50), { from: bob });
        expect(await getResTimestamp(res)).to.be.eq(await staking.getLastDepositChange('1'));
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
          .to.be.revertedWith('PowerOracleStaking::updateUser: Only admin allowed');
      });
    });

    describe('deposit', () => {
      beforeEach(async () => {
        await staking.createUser(alice, alicePoker, 0, { from: bob });
      });

      it('should allow anyone depositing multiple times for a given user ID', async function() {
        await cvpToken.transfer(bob, ether(50), { from: deployer });
        await cvpToken.transfer(charlie, ether(50), { from: deployer });
        await cvpToken.approve(staking.address, ether(50), { from: bob });
        await cvpToken.approve(staking.address, ether(50), { from: charlie });

        let res = await staking.deposit(1, ether(10), { from: bob });
        expectEvent(res, 'Deposit', {
          userId: '1',
          depositor: bob,
          amount: ether(10),
          depositAfter: ether(10)
        })
        expect(await getResTimestamp(res)).to.be.eq(await staking.getLastDepositChange('1'));

        expect(await staking.totalDeposit()).to.be.equal(ether(10));

        res = await staking.deposit(1, ether(10), { from: charlie });
        expectEvent(res, 'Deposit', {
          userId: '1',
          depositor: charlie,
          amount: ether(10),
          depositAfter: ether(20)
        })

        expect(await staking.totalDeposit()).to.be.equal(ether(20));
      });

      it('should update the reporter and the highest deposit values if needed', async function() {
        await staking.createUser(bob, bobPoker, 0, { from: bob });

        await cvpToken.transfer(bob, ether(150), { from: deployer });
        await cvpToken.approve(staking.address, ether(150), { from: bob });

        expect(await staking.getReporterId()).to.be.equal('0');

        let res = await staking.deposit(1, ether(10), { from: bob });
        expectEvent(res, 'ReporterChange', {
          prevId: '0',
          nextId: '1',
          highestDepositPrev: '0',
          actualDepositPrev: '0',
          actualDepositNext: ether(10),
        })

        res = await staking.deposit(2, ether(15), { from: bob });
        expectEvent(res, 'ReporterChange', {
          prevId: '1',
          nextId: '2',
          highestDepositPrev: ether(10),
          actualDepositPrev: ether(10),
          actualDepositNext: ether(15),
        })

        res = await staking.deposit(1, ether(5), { from: bob });
        expectEvent.notEmitted(res, 'ReporterChange')
      });

      it('should deny depositing 0 ', async function() {
        await expect(staking.deposit(1, 0, { from: bob }))
          .to.be.revertedWith('PowerOracleStaking::deposit: Missing amount');
      });

      it('should deny depositing for a non-existing user', async function() {
        await expect(staking.deposit(3, ether(30), { from: bob }))
          .to.be.revertedWith('PowerOracleStaking::deposit: Admin key can\'t be empty');
      });

      it('should deny creating a user when the contract is paused', async function() {
        await staking.pause({ from: owner });
        await expect(staking.deposit(1, ether(10), { from: bob }))
          .to.be.revertedWith('PAUSED');
      });
    })

    describe('withdraw', () => {
      const USER_ID = 42;

      beforeEach(async () => {
        await staking.stubSetUser(USER_ID, alice, alicePoker, ether(100), { from: bob });
        await staking.stubSetTotalDeposit(ether(100));
        await cvpToken.transfer(staking.address, ether(500), { from: deployer });
      });

      it('should allow the users admin key withdrawing all the deposit', async function() {
        expect(await cvpToken.balanceOf(sink)).to.be.equal('0');
        expect(await staking.totalDeposit()).to.be.equal(ether('100'));

        const res = await staking.withdraw(USER_ID, sink, ether(100), { from: alice });
        expect(await getResTimestamp(res)).to.be.eq(await staking.getLastDepositChange(USER_ID));

        expect(await cvpToken.balanceOf(sink)).to.be.equal(ether('100'));
        expect(await staking.totalDeposit()).to.be.equal(ether('0'));

        expectEvent(res, 'Withdraw', {
          userId: '42',
          to: sink,
          amount: ether(100),
          depositAfter: '0'
        });
      });

      it('should allow the users admin key withdrawing part of the deposit', async function() {
        expect(await cvpToken.balanceOf(sink)).to.be.equal('0');
        expect(await staking.totalDeposit()).to.be.equal(ether('100'));

        const res = await staking.withdraw(USER_ID, sink, ether(30), { from: alice });
        expect(await getResTimestamp(res)).to.be.eq(await staking.getLastDepositChange(USER_ID));

        expect(await cvpToken.balanceOf(sink)).to.be.equal(ether('30'));
        expect(await staking.totalDeposit()).to.be.equal(ether('70'));

        expectEvent(res, 'Withdraw', {
          userId: '42',
          adminKey: alice,
          to: sink,
          amount: ether(30),
          depositAfter: ether(70)
        });
      });

      it('should deny non-admin withdrawing rewards', async function() {
        await expect(staking.withdraw(USER_ID, sink, ether(30), { from: alicePoker }))
          .to.be.revertedWith('PowerOracleStaking::withdraw: Only user\'s admin key allowed');
      });

      it('should deny withdrawing more than the rewards balance', async function() {
        await expect(staking.withdraw(USER_ID, sink, ether(101), { from: alice }))
          .to.be.revertedWith('PowerOracleStaking::withdraw: Amount exceeds deposit');
      });

      it('should deny withdrawing 0 balance', async function() {
        await expect(staking.withdraw(USER_ID, sink, 0, { from: alice }))
          .to.be.revertedWith('PowerOracleStaking::withdraw: Missing amount');
      });

      it('should deny withdrawing to 0 address', async function() {
        await expect(staking.withdraw(USER_ID, constants.ZERO_ADDRESS, ether(30), { from: alice }))
          .to.be.revertedWith('PowerOracleStaking::withdraw: Can\'t transfer to 0 address');
      });
    });
  });

  describe('owner interface', () => {
    describe('withdrawExtraCvp', () => {
      it('should allow the owner withdrawing accidentally sent CVPs from the contract', async function() {
        await staking.stubSetTotalDeposit(ether(100));
        await cvpToken.transfer(staking.address, ether(120), { from: deployer });

        expect(await cvpToken.balanceOf(sink)).to.be.equal('0');
        const res = await staking.withdrawExtraCVP(sink, { from: owner });
        expect(await cvpToken.balanceOf(sink)).to.be.equal(ether('20'));

        expectEvent(res, 'WithdrawExtraCVP', {
          sent: true,
          to: sink,
          diff: ether(20),
          erc20Balance: ether(120),
          accountedTotalDeposits: ether(100)
        });
      });

      it('should not withdraw if there is no diff in accounted tokens', async function() {
        await staking.stubSetTotalDeposit(ether(100));
        await cvpToken.transfer(staking.address, ether(100), { from: deployer });

        expect(await cvpToken.balanceOf(sink)).to.be.equal('0');
        const res = await staking.withdrawExtraCVP(sink, { from: owner });
        expect(await cvpToken.balanceOf(sink)).to.be.equal(ether('0'));

        expectEvent(res, 'WithdrawExtraCVP', {
          sent: false,
          to: sink,
          diff: '0',
          erc20Balance: ether(100),
          accountedTotalDeposits: ether(100)
        });
      });

      it('should deny non-owner calling the method', async function() {
        await expect(staking.withdrawExtraCVP(sink, { from: alice }))
          .to.be.revertedWith('NOT_THE_OWNER');
      });

      it('should deny withdrawing to the 0 address', async function() {
        await expect(staking.withdrawExtraCVP(constants.ZERO_ADDRESS, { from: owner }))
          .to.be.revertedWith('PowerOracleStaking::withdrawExtraCVP: Cant withdraw to 0 address');
      });
    });

    describe('setMinimalSlashingDeposit', () => {
      it('should allow the owner setting the value', async function() {
        await staking.setMinimalSlashingDeposit(42, { from: owner });
        expect(await staking.minimalSlashingDeposit()).to.be.equal('42');
      })

      it('should deny non-owner setting the value', async function() {
        await expect(staking.setMinimalSlashingDeposit(42, { from: alice }))
          .to.be.revertedWith('NOT_THE_OWNER');
      })
    });

    describe('setPowerOracle', () => {
      it('should allow the owner setting the value', async function() {
        await staking.setPowerOracle(charlie, { from: owner });
        expect(await staking.powerOracle()).to.be.equal(charlie);
      })

      it('should deny non-owner setting the value', async function() {
        await expect(staking.setPowerOracle(charlie, { from: alice }))
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
          .to.be.revertedWith('PowerOracleStaking::setSlashingPct: Invalid reward sum');
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
      const powerOracle = await MockOracle.new(cvpToken.address, constants.ZERO_ADDRESS, 1, await getTokenConfigs());
      await staking.setPowerOracle(powerOracle.address, { from: owner });
    });

    it('should allow setting reporter if there is another user with a higher deposit', async function() {
      await staking.stubSetUser(1, alice, alicePoker, ether(100), { from: bob });
      await staking.stubSetUser(2, bob, bobPoker, ether(200), { from: bob });

      await staking.stubSetReporter(1, ether(300));
      expect(await staking.getReporterId()).to.be.equal('1');
      expect(await staking.getHighestDeposit()).to.be.equal(ether(300));

      await staking.setReporter(2);
      expect(await staking.getReporterId()).to.be.equal('2');
      expect(await staking.getHighestDeposit()).to.be.equal(ether(200));
    });

    it('should deny setting reporter with not the highest deposit', async function() {
      await staking.stubSetUser(1, alice, alicePoker, ether(100), { from: bob });
      await staking.stubSetUser(2, bob, bobPoker, ether(100), { from: bob });

      await staking.stubSetReporter(1, ether(300));

      await expect(staking.setReporter(2))
        .to.be.revertedWith('PowerOracleStaking::setReporter: Insufficient candidate deposit');
    });
  });

  describe('slash', () => {
    const SLASHER_ID = '42';
    const REPORTER_ID = '5';

    beforeEach(async function() {
      await cvpToken.transfer(staking.address, ether(10000), { from: deployer });
      // await cvpToken.approve(staking.address, ether(10000), { from: reservoir });

      await staking.stubSetUser(REPORTER_ID, alice, alicePoker, ether(500), { from: bob });
      await staking.stubSetUser(SLASHER_ID, bob, bobPoker, ether(60), { from: bob });
      await staking.stubSetTotalDeposit(ether(560), { from: bob });
      await staking.stubSetReporter(REPORTER_ID, ether(600), { from: bob });
    });

    it('should allow a powerOracle slashing current reporter', async function() {
      expect(await staking.getDepositOf(REPORTER_ID)).to.be.equal(ether(500));
      expect(await staking.getDepositOf(SLASHER_ID)).to.be.equal(ether(60));
      expect(await cvpToken.balanceOf(reservoir)).to.be.equal('0');
      expect(await staking.totalDeposit()).to.be.equal(ether(560));

      const res = await staking.slash(SLASHER_ID, 4, { from: powerOracle });

      expect(await staking.totalDeposit()).to.be.equal(ether(530));
      // 500 - 100 - 30 = 370
      expect(await staking.getDepositOf(REPORTER_ID)).to.be.equal(ether(370));
      // 100 + 100 = 200
      expect(await staking.getDepositOf(SLASHER_ID)).to.be.equal(ether(160));
      expect(await cvpToken.balanceOf(reservoir)).to.be.equal(ether(30));

      expect(await staking.getReporterId()).to.be.equal(REPORTER_ID);

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
      await staking.slash(SLASHER_ID, 4, { from: powerOracle });

      expect(await staking.getDepositOf(REPORTER_ID)).to.be.equal(ether(370));
      expect(await staking.getDepositOf(SLASHER_ID)).to.be.equal(ether(160));

      await staking.slash(SLASHER_ID, 4, { from: powerOracle });
      expect(await staking.getDepositOf(REPORTER_ID)).to.be.equal(ether(273.8));
      expect(await staking.getDepositOf(SLASHER_ID)).to.be.equal(ether(234));

      const res = await staking.slash(SLASHER_ID, 4, { from: powerOracle });
      expect(await staking.getDepositOf(REPORTER_ID)).to.be.equal(ether('202.612'));
      expect(await staking.getDepositOf(SLASHER_ID)).to.be.equal(ether('288.76'));

      expect(await staking.getReporterId()).to.be.equal(SLASHER_ID);

      expectEvent(res, 'ReporterChange', {
        prevId: REPORTER_ID,
        nextId: SLASHER_ID,
        highestDepositPrev: ether(600),
        actualDepositPrev: ether('202.612'),
        actualDepositNext: ether('288.76')
      })
    });

    it('should deny slashing if the slasher deposit is not sufficient', async function() {
      await staking.stubSetUser(SLASHER_ID, bob, bobPoker, ether(40), { from: bob });
      await expect(staking.slash(SLASHER_ID, 4, { from: owner }))
        .to.be.revertedWith('PowerOracleStaking::slash: Insufficient slasher deposit');
    });

    it('should deny non-powerOracle calling the method', async function() {
      await expect(staking.slash(SLASHER_ID, 4, { from: owner }))
        .to.be.revertedWith('PowerOracleStaking::slash: Only PowerOracle allowed');
    });
  })

  describe('viewers', () => {
    beforeEach(async function() {
      await staking.setMinimalSlashingDeposit(ether(50), { from: owner });
      await staking.stubSetReporter(3, ether(50));

      // it's ok to use the same keys for different users
      await staking.stubSetUser(1, alice, alicePoker, ether(30));
      await staking.stubSetUser(2, bob, bobPoker, ether(50));
      await staking.stubSetUser(3, charlie, charliePoker, ether(100));
    });

    describe('getUserStatus', () => {
      it('should respond with UNAUTHORIZED if there is not enough deposit', async function() {
        expect(await staking.getUserStatus(1, alicePoker)).to.be.equal(USER_STATUS.UNAUTHORIZED);
      });

      it('should respond with UNAUTHORIZED if there is no match between a poker key and a user id', async function() {
        expect(await staking.getUserStatus(2, alicePoker)).to.be.equal(USER_STATUS.UNAUTHORIZED);
      });

      it('should respond with CAN_SLASH if there is enough deposit, but not a reporter', async function() {
        expect(await staking.getUserStatus(2, bobPoker)).to.be.equal(USER_STATUS.CAN_SLASH);
      });

      it('should respond with CAN_REPORT if there is enough deposit and is a reporter', async function() {
        expect(await staking.getUserStatus(3, charliePoker)).to.be.equal(USER_STATUS.CAN_REPORT);
      });

      it('should respond with UNAUTHORIZED if there is no match between a reporter and a user id', async function() {
        expect(await staking.getUserStatus(3, alicePoker)).to.be.equal(USER_STATUS.UNAUTHORIZED);
      });
    })

    describe('authorizeReporter', () => {
      it('should authorize a valid reporter', async function() {
        await staking.authorizeReporter(3, charliePoker);
      });

      it('should not authorize an invalid reporter', async function() {
        await expect(staking.authorizeReporter(2, bobPoker))
          .to.be.revertedWith(' PowerOracleStaking::authorizeReporter: Invalid reporter');
      });

      it('should not authorize a valid reporter with an invalid poker key', async function() {
        await expect(staking.authorizeReporter(3, bobPoker))
          .to.be.revertedWith(' PowerOracleStaking::authorizeReporter: Invalid poker key');
      });
    })

    describe('authorizeSlasher', () => {
      it('should authorize a valid slasher', async function() {
        await staking.authorizeSlasher(2, bobPoker);
      });

      it('should not authorize an insufficient deposit', async function() {
        await expect(staking.authorizeSlasher(1, alicePoker))
          .to.be.revertedWith(' PowerOracleStaking::authorizeSlasher: Insufficient deposit');
      });

      it('should not authorize a valid slasher with an invalid poker key', async function() {
        await expect(staking.authorizeSlasher(2, alicePoker))
          .to.be.revertedWith(' PowerOracleStaking::authorizeSlasher: Invalid poker key');
      });
    })
  });
});
