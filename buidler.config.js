const { usePlugin } = require('@nomiclabs/buidler/config');

usePlugin('@nomiclabs/buidler-truffle5');
usePlugin('@nomiclabs/buidler-etherscan');
usePlugin('solidity-coverage');
usePlugin('buidler-contract-sizer');
usePlugin('buidler-gas-reporter');

require('./tasks/fetchPairValues')
require('./tasks/deployTestnet')
require('./tasks/oraclePrices')


const config = {
  analytics: {
    enabled: false,
  },
  contractSizer: {
    alphaSort: false,
    runOnCompile: false,
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY
  },
  defaultNetwork: 'buidlerevm',
  gasReporter: {
    currency: 'USD',
    enabled: !!(process.env.REPORT_GAS)
  },
  mocha: {
    timeout: 20000
  },
  networks: {
    buidlerevm: {
      chainId: 31337,
    },
    mainnet: {
      url: 'https://mainnet-eth.compound.finance',
    },
    local: {
      url: 'http://127.0.0.1:8545',
    },
    kovan: {
      url: 'https://kovan-eth.compound.finance',
      gasPrice: 1000000000,
    },
    coverage: {
      url: 'http://127.0.0.1:8555',
    },
  },
  paths: {
    artifacts: './artifacts',
    cache: './cache',
    coverage: './coverage',
    coverageJson: './coverage.json',
    root: './',
    sources: './contracts',
    tests: './test',
  },
  solc: {
    /* https://buidler.dev/buidler-evm/#solidity-optimizer-support */
    optimizer: {
      enabled: true,
      runs: 200,
    },
    version: '0.6.12',
  },
  typechain: {
    outDir: 'typechain',
    target: 'ethers-v5',
  },
};

module.exports = config;
