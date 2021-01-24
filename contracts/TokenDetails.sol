// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./Uniswap/UniswapConfig.sol";
import "./Uniswap/UniswapLib.sol";
import "./PowerOracleStorageV1.sol";


contract TokenDetails is PowerOracleStorageV1 {
  using FixedPoint for *;
  using SafeMath for uint256;

  address public immutable UNISWAP_FACTORY;

  constructor(address uniswapFactory_) public {
    UNISWAP_FACTORY = uniswapFactory_;
  }

  function addTokens(TokenConfig[] memory tokenConfigs_, TradingPair[] memory pairs_) external {
    uint256 len = tokenConfigs_.length;

    for (uint256 i = 0; i < len; i++) {
      TokenConfig memory tc = tokenConfigs_[i];
      require(tc.symbolHash == keccak256(abi.encode(tc.symbol)), "INVALID_SYMBOL_HASH");
      require(tokenConfigs[tc.token].token == address(0), "ALREADY_EXISTS");
      require(tc.baseUnit > 0, "BASE_UNIT_IS_NULL");
      require(tc.pairs.length ==  pairs_.length, "PAIR_LENGTHS_MISMATCH");
//      address uniswapMarket = tc.pairs;
//      if (tc.priceSource == PriceSource.REPORTER) {
//        require(uniswapMarket != address(0), "MARKET_IS_NULL");
//      } else {
//        require(uniswapMarket == address(0), "MARKET_IS_NOT_NULL");
//      }

      // TODO: assign each field
      tokenConfigs[tc.token] = tokenConfigs_[i];

      tokenByCToken[tc.cToken] = tc.token;
      tokenBySymbol[tc.symbol] = tc.token;
      tokenBySymbolHash[tc.symbolHash] = tc.token;

      // TOOD: iterate and assign factories/pairs
    }
  }

  function addFactories(address[] calldata factories_) external {
    for (uint256 i = 0; i < factories_.length; i++) {
      validFactories[factories_[i]] = true;
    }
  }

  function getTokenConfigBySymbolHash(bytes32 symbolHash_) public view returns (TokenConfig memory) {
    return tokenConfigs[tokenBySymbolHash[symbolHash_]];
  }

  function getTokenConfigByCToken(address cToken_) public view returns (TokenConfig memory) {
    return tokenConfigs[tokenByCToken[cToken_]];
  }

  function getTokenConfigBySymbol(string memory symbol_) public view returns (TokenConfig memory) {
    return tokenConfigs[tokenBySymbol[symbol_]];
  }
}
