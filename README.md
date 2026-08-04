# @otsblockchain/lib

![NPM Version](https://img.shields.io/npm/v/@otsblockchain/lib)
![License](https://img.shields.io/npm/l/@otsblockchain/lib)

Official library for interacting with the OTS Blockchain. It provides tools for cryptography, wallet management, networking (P2P), serialization, and smart contract compilation

## Installation

You can install the library using npm, yarn, or pnpm:

```bash
npm install @otsblockchain/lib
# or
yarn add @otsblockchain/lib
# or
pnpm add @otsblockchain/lib
```

## Usage Examples

### Creating a Wallet and Transferring Funds

```javascript
import { WalletWrapper } from '@otsblockchain/lib/wallet';
import { P2PNetwork } from '@otsblockchain/lib/userNetwork';

// Generate a new wallet
const myWallet = WalletWrapper.generate('MyWallet');
console.log('Mnemonic:', myWallet.mnemonic);
console.log('Address:', myWallet.address);

// Connect to the network
const network = new P2PNetwork(myWallet.privateKey);
network.connectToPeer('ws://127.0.0.1:8080');

// Create a transfer transaction
const nonce = await network.getNonce(myWallet.address);
const tx = myWallet.createTransfer('TargetAddressBase58', '10.5', 'Payment', nonce + 1);

// Send the transaction
const result = await network.sendTransaction(tx);
console.log('Transaction result:', result);
```

### Working with Smart Contracts

```javascript
import { compile, decompile } from '@otsblockchain/lib/compiler';

const jsCode = `
function hello() {
    let a = 5;
    return a + 10;
}
`;

// Compile JS smart contract code into OTS AST format
const compiled = compile(jsCode);
console.log(compiled);

// Decompile back into JS code
const decompiled = decompile(compiled);
console.log(decompiled);
```

## Documentation

Full documentation for all modules and functions is available in [DOCUMENTATION.md](./DOCUMENTATION.md)
