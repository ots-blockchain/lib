import CryptoUtils from './crypto.js';
import { consts } from './config.js';

export class Transaction {
    /**
     * @param {object} params
     * @param {('transfer' | 'deploy' | 'call' | 'stake' | 'unstake')} params.type
     * @param {string} params.from
     * @param {string} params.to
     * @param {bigint} params.amount
     * @param {string} params.data
     * @param {number} params.nonce
     * @param {string} params.signature
     * @param {number} [params.timestamp]
     * @param {bigint} [params.gasLimit]
     * @param {boolean} [params.valid]
     */
    constructor({ type, from, to = null, amount = 0n, data = "", nonce = 0, signature = null, timestamp = Date.now(), gasLimit = 0n, valid = undefined }) {
        this.type = type;
        this.from = from;
        this.to = to;
        this.amount = typeof amount === 'string' || typeof amount === 'number' ? BigInt(amount) : amount;
        this.data = data;
        this.nonce = nonce;
        this.signature = signature;
        this.timestamp = timestamp;
        this.gasLimit = typeof gasLimit === 'string' || typeof gasLimit === 'number' ? BigInt(gasLimit) : gasLimit;
        if (valid !== undefined) {
            this.valid = valid;
        }
    }

    getHash() {
        const payload = {
            chainId: consts.CHAIN_ID,
            type: this.type, from: this.from, to: this.to,
            amount: this.amount, data: this.data, nonce: this.nonce,
            timestamp: this.timestamp, gasLimit: this.gasLimit
        };
        return CryptoUtils.hash(payload);
    }

    sign(privateKey) {
        this.signature = CryptoUtils.sign(this.getHash(), privateKey);
    }

    serialize() {
        return CryptoUtils.serializeWithBigInt(this);
    }

    static deserialize(data) {
        if (!data) return null;
        if (data instanceof Transaction) return data;
        const obj = (typeof data === 'string' || (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)))
            ? CryptoUtils.deserializeWithBigInt(data)
            : data;
        return new Transaction(obj);
    }

    isValid() {
        if (!['transfer', 'deploy', 'call', 'stake', 'unstake'].includes(this.type)) return false;
        if (!this.signature) return false;
        if (typeof this.amount !== 'bigint' || typeof this.gasLimit !== 'bigint') return false;
        if (this.amount < 0n) return false;
        if (this.gasLimit < 0n || this.gasLimit > consts.MAX_TX_GAS) return false;
        if (!Number.isSafeInteger(this.nonce) || this.nonce < 0) return false;
        if (!Number.isSafeInteger(this.timestamp) || this.timestamp < 0) return false;
        if (typeof this.data !== 'string' || this.data.length > consts.MAX_DATA_LENGTH) return false;
        if (!CryptoUtils.isValidPublicKey(this.from)) return false;
        try {
            return CryptoUtils.verify(this.signature, this.getHash(), this.from);
        } catch {
            return false;
        }
    }
}

export class Block {
    constructor(index, prevHash, transactions, validator, stateRoot, signatures = [], timestamp = Date.now(), round = 0) {
        this.header = {
            index,
            prevHash,
            timestamp,
            validator,
            stateRoot,
            signatures: signatures || [],
            round: round
        };
        this.body = (transactions && transactions.length > 0)
            ? transactions.map(tx => Transaction.deserialize(tx))
            : [];
    }

    serialize() {
        return CryptoUtils.serializeWithBigInt(this);
    }

    static deserialize(data) {
        if (!data) return null;
        if (data instanceof Block) return data;
        const b = (typeof data === 'string' || (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)))
            ? CryptoUtils.deserializeWithBigInt(data)
            : data;

        return new Block(
            b.header.index,
            b.header.prevHash,
            b.body,
            b.header.validator,
            b.header.stateRoot,
            b.header.signatures || [],
            b.header.timestamp,
            b.header.round || 0
        );
    }

    getSigningHash() {
        const txHashes = this.body.map(tx => tx.getHash()).join('');
        const { signatures, ...unsignedHeader } = this.header;
        return CryptoUtils.hash(
            consts.CHAIN_ID + ':' + CryptoUtils.serializeWithBigInt(unsignedHeader) + txHashes
        );
    }

    getHash() {
        return this.getSigningHash();
    }

    sign(privateKey) {
        const validatorAddress = CryptoUtils.getPublicKey(privateKey);
        const signature = CryptoUtils.sign(this.getSigningHash(), privateKey);
        if (!this.header.signatures.find(s => s.validator === validatorAddress)) {
            this.header.signatures.push({ validator: validatorAddress, signature });
        }
        this.header.signatures.sort((a, b) => a.validator.localeCompare(b.validator));
    }

    isValid(prevBlock, activeValidatorsMap = null) {
        if (!Number.isSafeInteger(this.header.index) || this.header.index < 1) return false;
        if (!Number.isSafeInteger(this.header.timestamp) || this.header.timestamp <= prevBlock.header.timestamp) return false;
        if (!Number.isSafeInteger(this.header.round) || this.header.round < 0 || this.header.round > consts.MAX_CONSENSUS_ROUND) return false;
        if (!CryptoUtils.isValidPublicKey(this.header.validator)) return false;
        if (typeof this.header.stateRoot !== 'string' || !/^[0-9a-f]{64}$/.test(this.header.stateRoot)) return false;
        if (!Array.isArray(this.body) || this.body.length > consts.MAX_TXS_PER_BLOCK) return false;
        let declaredGas = 0n;
        for (const tx of this.body) {
            declaredGas += tx.type === 'call' ? (tx.gasLimit > 0n ? tx.gasLimit : tx.amount) : 0n;
            if (declaredGas > consts.MAX_BLOCK_GAS) return false;
        }
        if (this.header.index !== prevBlock.header.index + 1) return false;
        if (this.header.prevHash !== prevBlock.getHash()) return false;

        if (activeValidatorsMap) {
            let totalStake = 0n;
            let votedStake = 0n;
            for (const stake of Object.values(activeValidatorsMap)) {
                totalStake += BigInt(stake);
            }

            const signingHash = this.getSigningHash();
            const validVoters = new Set();

            if (!Array.isArray(this.header.signatures) || this.header.signatures.length > Object.keys(activeValidatorsMap).length) return false;
            for (const sigObj of this.header.signatures) {
                if (!activeValidatorsMap[sigObj.validator]) continue;
                if (validVoters.has(sigObj.validator)) continue;

                if (CryptoUtils.verify(sigObj.signature, signingHash, sigObj.validator)) {
                    validVoters.add(sigObj.validator);
                    votedStake += BigInt(activeValidatorsMap[sigObj.validator]);
                }
            }

            if (votedStake * 3n <= totalStake * 2n) return false;
        }

        return true;
    }
}
