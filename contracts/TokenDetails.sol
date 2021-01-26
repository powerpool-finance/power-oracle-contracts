// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "./Uniswap/UniswapConfig.sol";
import "./Uniswap/UniswapLib.sol";
import "./PowerOracleStorageV1.sol";


contract TokenDetails is PowerOracleStorageV1 {
  using FixedPoint for *;
  using SafeMath for uint256;

  /// @notice The number of wei in 1 ETH
  uint public constant ETH_BASE_UNIT = 1e18;

  bytes32 internal constant cvpHash = keccak256(abi.encodePacked("CVP"));
  bytes32 internal constant ethHash = keccak256(abi.encodePacked("ETH"));

  address public immutable UNISWAP_FACTORY;

  constructor(address uniswapFactory_) public {
    UNISWAP_FACTORY = uniswapFactory_;
  }

  function addTokens(TokenConfig[] memory tokenConfigs_, ExchangePair[][] memory tokenExchangesList_) external {
    uint256 len = tokenConfigs_.length;
    require(len == tokenExchangesList_.length, "ARGUMENT_LENGTHS_MISMATCH");

    for (uint256 i = 0; i < len; i++) {
      TokenConfig memory tc = tokenConfigs_[i];
      require(tc.symbolHash == keccak256(abi.encodePacked(tc.symbol)), "INVALID_SYMBOL_HASH");
      require(tokenConfigs[tc.token].token == address(0), "ALREADY_EXISTS");
      require(tc.baseUnit > 0, "BASE_UNIT_IS_NULL");
      require(tc.exchanges.length ==  tokenExchangesList_[i].length, "EXCHANGE_LENGTHS_MISMATCH");

      tokenConfigs[tc.token] = tokenConfigs_[i];

      tokenByCToken[tc.cToken] = tc.token;
      tokenBySymbol[tc.symbol] = tc.token;
      tokenBySymbolHash[tc.symbolHash] = tc.token;

      ExchangePair[] memory tExchanges = tokenExchangesList_[i];

      // iterate over token exchanges
      uint256 tExchangesLen = tExchanges.length;
      for (uint256 j = 0; j < tExchangesLen; j++) {
        ExchangePair memory ex = tExchanges[j];
        require(validFactories[tc.exchanges[j]] == true, "INVALID_FACTORY");
        if (tc.priceSource == PriceSource.REPORTER) {
          require(ex.pair != address(0), "PAIR_IS_NULL");
        } else {
          require(ex.pair == address(0), "PAIR_IS_NOT_NULL");
        }
        tokenExchangeDetails[tc.token][tc.exchanges[j]] = ex;
      }

      tokens.push(tc.token);
    }
    // TODO: add event
  }

  function addValidFactories(address[] calldata factories_) external {
    for (uint256 i = 0; i < factories_.length; i++) {
      validFactories[factories_[i]] = true;
    }
    // TODO: add event
  }

  function getTokenExchanges(address token_) public view returns (ExchangePair[] memory) {
    address[] memory exchanges = tokenConfigs[token_].exchanges;
    uint256 len = exchanges.length;
    ExchangePair[] memory results = new ExchangePair[](len);
    for (uint256 i = 0; i < len; i++) {
      results[i] = tokenExchangeDetails[token_][exchanges[i]];
    }

    return results;
  }

  function getTokenConfig(address token_) public view returns (TokenConfig memory) {
    TokenConfig memory cfg = tokenConfigs[token_];
    require(cfg.token == token_, "TOKEN_NOT_FOUND_1");
    require(token_ != address(0), "TOKEN_NOT_FOUND_2");
    require(cfg.deprecated == false, "TOKEN_DEPRECATED");
    return tokenConfigs[token_];
  }

  function getTokenConfigBySymbolHash(bytes32 symbolHash_) public view returns (TokenConfig memory) {
    return getTokenConfig(tokenBySymbolHash[symbolHash_]);
  }

  function getTokenConfigByCToken(address cToken_) public view returns (TokenConfig memory) {
    return getTokenConfig(tokenByCToken[cToken_]);
  }

  function getTokenConfigBySymbol(string memory symbol_) public view returns (TokenConfig memory) {
    return getTokenConfig(tokenBySymbol[symbol_]);
  }
}
