# Power Oracle Contracts

[![Actions Status](https://github.com/powerpool-finance/power-oracle-contracts/workflows/CI/badge.svg)](https://github.com/powerpool-finance/power-oracle-contracts/actions)

Power Oracle is a decentralized cross-chain price oracle working on Ethereum Main Network and sidechains. Power Oracle uses Uniswap V2 as its primary source of time-weighted average prices (TWAPs) and introduces economic incentives for independent price reporters.

🚨 **Security review status: unaudited**

## Contracts on Ethereum Main Network
### Active
- `PowerOracle`(ProxyAdmin - [0x7696f9208f9e195ba31e6f4B2D07B6462C8C42bb](https://etherscan.io/address/0x7696f9208f9e195ba31e6f4B2D07B6462C8C42bb#code), Proxy - [0x019e14DA4538ae1BF0BCd8608ab8595c6c6181FB](https://etherscan.io/address/0x019e14DA4538ae1BF0BCd8608ab8595c6c6181FB#code), Implementation - [0x4b6E556841a88B0682c0bc9AbB6bdAF4572184b4](https://etherscan.io/address/0x4b6E556841a88B0682c0bc9AbB6bdAF4572184b4)).

### Deprecated
- `PowerOracle`(Implementation - [0xA394922A1A45786583e5383cf4485a6F325d8807](https://etherscan.io/address/0xA394922A1A45786583e5383cf4485a6F325d8807)). Previous implementation.

## Contracts on Kovan Test Network

## Testing and Development

Use `yarn` or `npm` to run the following npm tasks:

- `yarn compile` - compile contracts
- `yarn test` - run tests
- `yarn coverage` - generate test coverage report
