const { constants, time } = require('@openzeppelin/test-helpers');
const { K, ether } = require('./helpers');

const { solidity } = require('ethereum-waffle');

const chai = require('chai');
const MockCVP = artifacts.require('MockCVP');
const PowerOracleStaking = artifacts.require('PowerOracleStaking');

chai.use(solidity);
const { expect } = chai;

MockCVP.numberFormat = 'String';
PowerOracleStaking.numberFormat = 'String';

describe('PowerOracleStaking', function () {
  let staking;
  let cvpToken;

  let owner, timelockStub, sourceStub1, sourceStub2, powerOracle, alice, bob;

  before(async function() {
    [owner, timelockStub, sourceStub1, sourceStub2, powerOracle, alice, bob] = await web3.eth.getAccounts();
  });

  beforeEach(async function() {
    cvpToken = await MockCVP.new(ether(2000));
    [owner, timelockStub, sourceStub1, sourceStub2, powerOracle, alice, bob] = await web3.eth.getAccounts();
  });

  describe('initialization', () => {
    it('should assign constructor args correctly', async function() {
      staking = await PowerOracleStaking.new(cvpToken.address);
      expect(await staking.cvpToken()).to.be.equal(cvpToken.address);
    });

    it('should initialize correctly', async function() {
      staking = await PowerOracleStaking.new(cvpToken.address);
      await staking.initialize(powerOracle, ether(300), ether(15), ether(20));

      expect(await staking.powerOracle()).to.be.equal(powerOracle);
      expect(await staking.minimalSlashingDeposit()).to.be.equal(ether(300));
      expect(await staking.slasherRewardPct()).to.be.equal(ether(15));
      expect(await staking.reservoirSlashingRewardPct()).to.be.equal(ether(20));
    });
  })

  describe('pokeFromReporter', () => {
    let staking;
    beforeEach(async () => {
      staking = await PowerOracleStaking.new(cvpToken.address);
      await staking.initialize(powerOracle, ether(300), ether(15), ether(20));
    });

    it('should allow a valid reporter calling the method', async function() {

    });
  });
});
