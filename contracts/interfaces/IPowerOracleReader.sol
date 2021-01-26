// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

interface IPowerOracleReader {
  function getPriceByAsset(address token) external view returns (uint256);

  function getPriceBySymbol(string calldata symbol) external view returns (uint256);

  function getPriceBySymbolHash(bytes32 symbolHash) external view returns (uint256);

  function getUnderlyingPrice(address cToken) external view returns (uint256);

  function getPriceByAsset(address factory, address token) external view returns (uint256);

  function getPriceBySymbol(address factory, string calldata symbol) external view returns (uint256);

  function getPriceBySymbolHash(address factory, bytes32 symbolHash) external view returns (uint256);

  function getUnderlyingPrice(address factory, address cToken) external view returns (uint256);
}
