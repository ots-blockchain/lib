import CryptoUtils from './crypto.js';
import { Transaction } from './models.js';
import { toNanoOts, toOts } from './format.js';

class WalletWrapper {
    /**
     * @param {string} name 
     * @param {string} mnemonic 
     * @param {string} privateKeyHex 
     */
    constructor(name, mnemonic, privateKeyHex) {
        this.name = name;
        this.mnemonic = mnemonic;
        this.privateKey = privateKeyHex;
        this.publicKey = CryptoUtils.getPublicKey(this.privateKey);
        this.address = CryptoUtils.publicKeyToBase58(this.publicKey);
    }

    /**
     * Generate a new wallet.
     * @param {string} name 
     * @returns {WalletWrapper}
     */
    static generate(name) {
        const mnemonic = CryptoUtils.generateMnemonic();
        const privateKey = CryptoUtils.mnemonicToPrivateKey(mnemonic);
        return new WalletWrapper(name, mnemonic, privateKey);
    }

    /**
     * Import a wallet from a mnemonic phrase.
     * @param {string} name 
     * @param {string} mnemonic 
     * @returns {WalletWrapper}
     */
    static fromMnemonic(name, mnemonic) {
        const privateKey = CryptoUtils.mnemonicToPrivateKey(mnemonic);
        return new WalletWrapper(name, mnemonic, privateKey);
    }

    /**
     * Reconstruct from existing stored data.
     * @param {Object} data 
     * @returns {WalletWrapper}
     */
    static fromData(data) {
        if (data.priv && !data.mnemonic) {
            return new WalletWrapper(data.name, '', data.priv);
        }
        return new WalletWrapper(data.name, data.mnemonic, data.priv);
    }

    /**
     * Export wallet data for storage
     */
    toData() {
        return {
            name: this.name,
            mnemonic: this.mnemonic,
            priv: this.privateKey
        };
    }

    /**
     * Create a transfer transaction using standard OTS amounts and Base58 address
     * @param {string} toAddressBase58 
     * @param {string|number} amountOts 
     * @param {string} comment 
     * @param {number} nonce 
     * @returns {Transaction}
     */
    createTransfer(toAddressBase58, amountOts, comment, nonce) {
        const toPublicKey = CryptoUtils.base58ToPublicKey(toAddressBase58);
        const amountNano = toNanoOts(amountOts);

        const tx = new Transaction({
            type: 'transfer',
            from: this.publicKey,
            to: toPublicKey,
            amount: amountNano,
            data: comment || '',
            nonce: nonce
        });

        tx.sign(this.privateKey);
        return tx;
    }

    /**
     * Create a stake transaction
     * @param {string|number} amountOts 
     * @param {number} nonce 
     * @returns {Transaction}
     */
    createStake(amountOts, nonce) {
        const amountNano = toNanoOts(amountOts);

        const tx = new Transaction({
            type: 'stake',
            from: this.publicKey,
            to: this.publicKey,
            amount: amountNano,
            data: '',
            nonce: nonce
        });

        tx.sign(this.privateKey);
        return tx;
    }

    /**
     * Create a deploy transaction
     * @param {string} contractCode 
     * @param {string|number} costOts 
     * @param {number} nonce 
     * @returns {Transaction}
     */
    createDeploy(contractCode, costOts, nonce) {
        const amountNano = typeof costOts === 'bigint' ? costOts : toNanoOts(costOts);

        const tx = new Transaction({
            type: 'deploy',
            from: this.publicKey,
            amount: amountNano,
            data: CryptoUtils.serializeWithBigInt(contractCode),
            nonce: nonce
        });

        tx.sign(this.privateKey);
        return tx;
    }

    /**
     * Create a call transaction
     * @param {string} contractAddressHex 
     * @param {string|number} amountOts 
     * @param {string} args 
     * @param {number} nonce 
     * @returns {Transaction}
     */
    createCall(contractAddressHex, amountOts, args, nonce) {
        const amountNano = toNanoOts(amountOts);
        // contract address is already hex

        const tx = new Transaction({
            type: 'call',
            from: this.publicKey,
            to: contractAddressHex,
            amount: amountNano,
            data: args,
            nonce: nonce
        });

        tx.sign(this.privateKey);
        return tx;
    }
}

export default WalletWrapper;
