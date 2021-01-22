// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "../PowerOracle.sol";
import "hardhat/console.sol";


contract MockProxyCall {
  function call(address destination, bytes calldata payload) external {
    (bool ok, bytes memory data) = destination.call(payload);

    if (!ok) {
      assembly {
        let size := returndatasize()
        revert(add(data, 32), size)
      }
    }
  }
}
