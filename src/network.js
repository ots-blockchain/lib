import CryptoUtils from './crypto.js';

const hexToUint8 = (hex) => new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
const uint8ToHex = (bytes) => bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');

export default class Network {
    static async compress(data) {
        const ds = new CompressionStream('gzip');
        const writer = ds.writable.getWriter();
        writer.write(data);
        writer.close();
        const response = new Response(ds.readable);
        const arrayBuffer = await response.arrayBuffer();
        return new Uint8Array(arrayBuffer);
    }

    static async decompress(data) {
        const ds = new DecompressionStream('gzip');
        const writer = ds.writable.getWriter();
        writer.write(data);
        writer.close();
        const response = new Response(ds.readable);
        const arrayBuffer = await response.arrayBuffer();
        return new Uint8Array(arrayBuffer);
    }

    static async serialize(packet) {
        if (!packet.data.type) throw new Error(`Please provide 'type' parameter in packet`);

        const encoder = new TextEncoder();

        const typeBuf = encoder.encode(packet.data.type);
        const payloadBuf = encoder.encode(CryptoUtils.serializeWithBigInt(packet.data.payload || {}));
        const fromBuf = hexToUint8(packet.data.from);
        const msgIdBuf = hexToUint8(packet.data.message_id);
        const signBuf = hexToUint8(packet.sign);

        // [Sign:64][From:33][MsgId:32][TypeLen:1][Type:X][Payload:Y]
        const totalLength = signBuf.length + fromBuf.length + msgIdBuf.length + 1 + typeBuf.length + payloadBuf.length;
        const buffer = new Uint8Array(totalLength);

        let offset = 0;
        buffer.set(signBuf, offset); offset += 64;
        buffer.set(fromBuf, offset); offset += 33;
        buffer.set(msgIdBuf, offset); offset += 32;
        buffer[offset++] = typeBuf.length;
        buffer.set(typeBuf, offset); offset += typeBuf.length;
        buffer.set(payloadBuf, offset);

        return await this.compress(buffer);
    }

    static async deserialize(cbuffer) {
        try {
            const buffer = await this.decompress(cbuffer);
            const decoder = new TextDecoder();
            let offset = 0;

            const sign = uint8ToHex(buffer.slice(offset, offset += 64));
            const from = uint8ToHex(buffer.slice(offset, offset += 33));
            const message_id = uint8ToHex(buffer.slice(offset, offset += 32));

            const typeLen = buffer[offset++];
            const type = decoder.decode(buffer.slice(offset, offset += typeLen));
            const payload = CryptoUtils.deserializeWithBigInt(decoder.decode(buffer.slice(offset)));

            return { sign, data: { type, from, message_id, payload } };
        } catch (e) {
            console.error("Deserialization failed:", e);
            return null;
        }
    }

    /**
     * @param {string} data json
     * @returns {object | null}
     */
    static verifyPacket(data) {
        try {
            const message = data;
            return CryptoUtils.verify(message.sign, CryptoUtils.hash(CryptoUtils.serializeWithBigInt(message.data)), message.data.from) ? message : null;
        } catch (e) {
            return null;
        }
    }

    /**
     * @param {WebSocket} socket 
     * @param {object} dataObj 
     */
    static async send(privateKey, socket, dataObj) {
        if (!privateKey || !socket || !dataObj) return;
        const { type, ...payload } = dataObj;

        const data = {
            type,
            from: CryptoUtils.getPublicKey(privateKey),
            message_id: CryptoUtils.hash(Date.now() + Math.random().toString()),
            payload: payload
        };

        const sign = CryptoUtils.sign(CryptoUtils.hash(CryptoUtils.serializeWithBigInt(data)), privateKey);
        const binaryPacket = await this.serialize({ sign, data });

        if (socket.readyState === 1 || socket.readyState === WebSocket.OPEN) {
            socket.send(binaryPacket);
        }
    }
}
