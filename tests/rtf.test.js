'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { default: MsgReader, decompressRtf, decompressRtfToString } = require('../lib/index.js');
const { crc32 } = require('../lib/utils.js');

const FIXTURE = fs.readFileSync(path.join(__dirname, '..', 'data', 'test.msg'));

describe('crc32', () => {
    it('matches the IEEE check vector', () => {
        assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
    });

    it('supports the MS-OXRTFCP variant (init 0, no xor-out)', () => {
        const data = new MsgReader(FIXTURE).getFileData().compressedRtf;
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const headerCrc = view.getUint32(12, true);
        const contents = data.slice(16, 16 + (view.getUint32(0, true) - 12));
        assert.equal(crc32(contents, { init: 0, xorOut: 0 }), headerCrc);
    });
});

describe('decompressRtf', () => {
    it('decompresses the fixture RTF body', () => {
        const data = new MsgReader(FIXTURE).getFileData().compressedRtf;
        const out = decompressRtf(data);
        assert.equal(out.length, 2638); // header raw_size
        assert.ok(Buffer.from(out.subarray(0, 5)).toString() === '{\\rtf');
        assert.ok(decompressRtfToString(data).startsWith('{\\rtf1\\ansi\\ansicpg1252'));
    });

    it('passes through MELA (uncompressed) payloads', () => {
        const payload = Buffer.from('{\\rtf1\\ansi hello}');
        const header = Buffer.alloc(16);
        header.writeUInt32LE(payload.length + 12, 0);
        header.writeUInt32LE(payload.length, 4);
        header.write('MELA', 8, 'ascii');
        header.writeUInt32LE(0, 12);
        const out = decompressRtf(Buffer.concat([header, payload]));
        assert.equal(Buffer.from(out).toString(), '{\\rtf1\\ansi hello}');
    });

    it('rejects short input and unknown magic', () => {
        assert.throws(() => decompressRtf(new Uint8Array(10)), /at least 16 bytes/);
        const bad = new Uint8Array(20);
        bad.set([1, 0, 0, 0, 2, 0, 0, 0]);
        bad.set(Buffer.from('XXXX'), 8);
        assert.throws(() => decompressRtf(bad), /Unknown RTF compression magic/);
    });

    it('rejects CRC mismatches unless verification is disabled', () => {
        const data = Buffer.from(new MsgReader(FIXTURE).getFileData().compressedRtf);
        data[20] ^= 0xff; // corrupt one payload byte
        assert.throws(() => decompressRtf(data), /CRC mismatch/);
        const salvaged = decompressRtf(data, { verifyCrc: false });
        assert.ok(salvaged.length > 0);
        assert.ok(Buffer.from(salvaged.subarray(0, 5)).toString() === '{\\rtf');
    });
});
