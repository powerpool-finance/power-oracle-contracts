// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

import "../PowerOracleStaking.sol";


contract MockStaking is PowerOracleStaking {
  constructor(address cvpToken_) public PowerOracleStaking(cvpToken_) {

  }

  event MockSlash(uint256 userId, uint256 overdueCount);

  function slash(uint256 slasherId_, uint256 overdueCount_) public override(PowerOracleStaking) {
    emit MockSlash(slasherId_, overdueCount_);
  }

  function setReporter(uint256 userId_, uint256 highestDeposit_) external {
    _reporterId = userId_;
    _highestDeposit = highestDeposit_;
  }

  function setUser(uint256 userId_, address adminKey_, address pokerKey_, address financierKey_, uint256 deposit_) external {
    users[userId_].adminKey = adminKey_;
    users[userId_].pokerKey = pokerKey_;
    users[userId_].financierKey = financierKey_;
    users[userId_].deposit = deposit_;
  }

  function setUserFinancier(uint256 userId_, address financierKey_) external {
    users[userId_].financierKey = financierKey_;
  }

  function setUserDeposit(uint256 userId_, uint256 deposit_) external {
    users[userId_].deposit = deposit_;
  }
}
