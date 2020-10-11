// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

import "../PowerOracleStaking.sol";


contract MockStaking is PowerOracleStaking {
  constructor(address cvpToken_) public PowerOracleStaking(cvpToken_) {

  }

  function setReporter(uint256 userId_, uint256 highestDeposit_) external {
    _reporterId = userId_;
    _highestDeposit = highestDeposit_;
  }

  function setUser(uint256 userId_, address pokerKey, uint256 deposit_) external {
    users[userId_].pokerKey = pokerKey;
    users[userId_].deposit = deposit_;
  }

  function setUserDeposit(uint256 userId_, uint256 deposit_) external {
    users[userId_].deposit = deposit_;
  }
}
