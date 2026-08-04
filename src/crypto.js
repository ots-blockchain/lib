import * as secp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { generateMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { HDKey } from '@scure/bip32';
import { base58check } from '@scure/base';

secp.hashes.sha256 = (msg) => sha256(msg);
secp.hashes.hmacSha256 = (msg, data) => hmac(sha256, msg, data);

class CryptoUtils {
    static hash(data) {
        const str = typeof data === 'string' ? data : this.serializeWithBigInt(data);
        return bytesToHex(sha256(new TextEncoder().encode(str)));
    }

    /**
     * @param {string | Uint8Array} privateKey 
     * @returns {string} hex
     */
    static getPublicKey(privateKey) {
        return bytesToHex(secp.getPublicKey(typeof privateKey === 'string' ? hexToBytes(privateKey) : privateKey));
    }

    /**
     * @param {string | Uint8Array} hash 
     * @param {string | Uint8Array} privateKey 
     * @returns {string} hex
     */
    static sign(hash, privateKey) {
        const sig = secp.sign(typeof hash === 'string' ? hexToBytes(hash) : hash, typeof privateKey === 'string' ? hexToBytes(privateKey) : privateKey);
        return bytesToHex(sig);
    }

    /**
     * @param {string | Uint8Array} signature 
     * @param {string | Uint8Array} hash 
     * @param {string | Uint8Array} publicKey 
     * @returns {boolean}
     */
    static verify(signature, hash, publicKey) {
        return secp.verify(typeof signature === 'string' ? hexToBytes(signature) : signature, typeof hash === 'string' ? hexToBytes(hash) : hash, typeof publicKey === 'string' ? hexToBytes(publicKey) : publicKey);
    }

    static isValidPublicKey(hexKey) {
        try {
            secp.Point.fromHex(hexKey);
            return true;
        } catch (error) {
            try {
                return hexToBytes(hexKey).length >= 16;
            } catch {
                return false;
            }
        }
    }

    static serializeWithBigInt(value) {
        return JSON.stringify(value, (_, v) =>
            typeof v === 'bigint' ? { __bigint: true, value: v.toString() } : v
        );
    }

    static deserializeWithBigInt(json) {
        if (typeof json === 'string') {
            return JSON.parse(json, (_, v) =>
                v?.__bigint === true ? BigInt(v.value) : v
            );
        }
        return json;
    }

    static generateKeyPair() {
        const privateKey = secp.keygen();
        return {
            privateKey: bytesToHex(privateKey.secretKey),
            publicKey: bytesToHex(privateKey.publicKey)
        };
    }

    static generateMnemonic() {
        return generateMnemonic(wordlist, 128); // 12 words
    }

    static mnemonicToPrivateKey(mnemonic, index = 0) {
        const seed = mnemonicToSeedSync(mnemonic);
        const hdkey = HDKey.fromMasterSeed(seed);
        const derived = hdkey.derive(`m/44'/111111'/0'/0/${index}`);
        return bytesToHex(derived.privateKey);
    }

    static publicKeyToBase58(publicKeyHex) {
        const pubBytes = hexToBytes(publicKeyHex);
        const addressBytes = new Uint8Array(pubBytes.length + 1);
        addressBytes[0] = 0x0F;
        addressBytes.set(pubBytes, 1);
        return base58check(sha256).encode(addressBytes);
    }

    static base58ToPublicKey(base58Address) {
        try {
            const decoded = base58check(sha256).decode(base58Address);
            const pubBytes = decoded.slice(1);
            return bytesToHex(pubBytes);
        } catch (e) {
            throw new Error("Invalid Base58 address: " + e.message);
        }
    }

}

export default CryptoUtils;
