# @otsblockchain/lib Documentation

The library is divided into several key modules, each responsible for specific functionality within the OTS Blockchain ecosystem.

---

## 1. CryptoUtils (`./crypto`)
Module for cryptographic operations, key and address management.

- `hash(data: string | object)`: Returns the SHA256 hash of the data.
- `getPublicKey(privateKey: string | Uint8Array)`: Returns the public key in hex format based on the private key.
- `sign(hash: string | Uint8Array, privateKey: string | Uint8Array)`: Signs the hash with the private key.
- `verify(signature: string | Uint8Array, hash: string | Uint8Array, publicKey: string | Uint8Array)`: Verifies a signature.
- `isValidPublicKey(hexKey: string)`: Checks the validity of a public key.
- `serializeWithBigInt(value: any)`: Serializes objects, supporting the `BigInt` type.
- `deserializeWithBigInt(json: string | object)`: Deserializes JSON, restoring the `BigInt` type.
- `generateKeyPair()`: Generates a new key pair (private and public).
- `generateMnemonic()`: Generates a new BIP39 mnemonic (12 words).
- `mnemonicToPrivateKey(mnemonic: string, index: number = 0)`: Derives a private key from a mnemonic using the derivation path `m/44'/111111'/0'/0/index`.
- `publicKeyToBase58(publicKeyHex: string)`: Converts a public key to a Base58 address.
- `base58ToPublicKey(base58Address: string)`: Converts a Base58 address back to a public key.

---

## 2. WalletWrapper (`./wallet`)
Module for user wallet management and transaction creation.

- `static generate(name: string)`: Creates a new wallet.
- `static fromMnemonic(name: string, mnemonic: string)`: Restores a wallet from a mnemonic.
- `static fromData(data: object)`: Restores a wallet from stored data.
- `toData()`: Exports wallet data (name, mnemonic, private key).
- `createTransfer(toAddressBase58: string, amountOts: string|number, comment: string, nonce: number)`: Creates a funds transfer transaction.
- `createStake(amountOts: string|number, nonce: number)`: Creates a staking transaction.
- `createDeploy(contractCode: string, costOts: string|number, nonce: number)`: Creates a smart contract deployment transaction.
- `createCall(contractAddressHex: string, amountOts: string|number, args: string, nonce: number)`: Creates a smart contract call transaction.

---

## 3. P2PNetwork (`./userNetwork`)
Class for connecting to network nodes and sending requests (WebSocket).

- `constructor(privateKey: string, callback?: Function)`: Initializes the connection.
- `connectToPeer(url: string)`: Connects to the specified node via WebSocket.
- `closeConnection(connect: Function, reconnect: boolean = true)`: Closes the connection and attempts to reconnect.
- `sendTransaction(tx: Transaction)`: Sends a transaction to the network and waits for a response.
- `getNonce(address: string)`: Gets the current nonce of an address.
- `getBlock(height: number)`: Gets a block by its height.
- `getInfo()`: Returns information about the current network state.
- `getAccount(address: string)`: Gets account data (balance, stake, etc.).
- `getStorage(address: string, key: string)`: Reads data from smart contract storage.
- `send(data: object)`: Sends raw data through the socket with a signature.

---

## 4. Models (`./models`)
Blockchain data models.

### Transaction
- `constructor(params)`: Creates a transaction. Supported types: `'transfer'`, `'deploy'`, `'call'`, `'stake'`.
- `getHash()`: Gets the transaction hash.
- `sign(privateKey: string)`: Signs the transaction.
- `serialize()`: Serializes the transaction for sending.
- `static deserialize(data: object|string)`: Restores a transaction.
- `isValid()`: Checks signature validity.

### Block
- `constructor(...)`: Creates a block.
- `serialize()` / `static deserialize(data)`: Block serialization and deserialization.
- `getSigningHash()`: Returns the block hash for signing.
- `getHash()`: Returns the block hash.
- `sign(privateKey: string)`: Adds a validator signature to the block.
- `isValid(prevBlock, activeValidatorsMap)`: Checks block validity (previous hash, validator consensus).

---

## 5. Compiler (`./compiler`)
Module for compiling JavaScript code into the OTS smart contract AST format and back.

- `compile(jsCode: string)`: Converts JS source code into an internal AST representation understood by the OTS blockchain virtual machine.
- `decompile(astInput: string | object)`: Converts AST back into readable JS code.

---

## 6. Format (`./format`)
Utilities for handling amounts and conversions.

- `toOts(nanoOtsVal: bigint | number)`: Converts from smallest units (NanoOTS) to OTS (string).
- `toNanoOts(otsValStr: string | number)`: Converts from OTS to smallest units (NanoOTS, `bigint`).

---

## 7. Network (`./network`)
Utilities for low-level network operations and binary packets.

- `static compress(data: Uint8Array)`: Compresses data using gzip.
- `static decompress(data: Uint8Array)`: Decompresses gzip data.
- `static serialize(packet: object)`: Binary serialization and packet compression (includes signature, sender, message_id).
- `static deserialize(cbuffer: Uint8Array)`: Deserialization of a binary packet.
- `static verifyPacket(data: object)`: Verifies packet signature.
- `static send(privateKey: string, socket: WebSocket, dataObj: object)`: Signs, serializes, and sends a packet via WebSocket.

---

## 8. Config (`./config`)
Network constants and operation costs.

### consts
Global network parameters such as timeouts, minimal stake (`MINIMAL_STAKE`), intervals, genesis block addresses, and limits.

### costs
Execution cost of virtual machine operations (in NanoOTS):
- `BASE_FEE`: Base fee.
- `DEFAULT`, `INSTRUCTION`, `FUNC_CALL`, `WRITE_VAR`, `COMPLEX_MATH`, `CREATE_OBJECT`, `MEMORY_BYTE`: Cost of various opcodes and memory operations.
