'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const DataStream = require('../lib/data-stream-reader-lite.js').default;

describe('DataStreamReaderLite', () => {
    it('reads views with a nonzero byteOffset correctly (pooled-Buffer case)', () => {
        const backing = new Uint8Array([9, 1, 2, 3, 4, 9]);
        const view = new Uint8Array(backing.buffer, 1, 4); // [1,2,3,4]
        const ds = new DataStream(view);
        assert.equal(ds.byteLength, 4);
        assert.deepEqual(Array.from(ds.readUint8Array(4)), [1, 2, 3, 4]);

        const ds2 = new DataStream(view);
        ds2.seek(0);
        assert.equal(ds2.readUint32(true), 0x04030201);
    });

    it('accepts ArrayBuffer, DataView and Buffer-shaped inputs', () => {
        const bytes = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
        assert.equal(new DataStream(bytes.buffer).byteLength, 8);
        assert.equal(new DataStream(new DataView(bytes.buffer)).byteLength, 8);
        assert.equal(new DataStream(Buffer.from(bytes)).byteLength, 8);
        assert.equal(new DataStream({ buffer: bytes.buffer, byteOffset: 0, byteLength: 8 }).byteLength, 8);
    });

    it('throws RangeError on out-of-bounds reads', () => {
        const ds = new DataStream(new Uint8Array([1, 2, 3]));
        ds.seek(2);
        assert.throws(() => ds.readInt32(), RangeError);
        ds.seek(0);
        assert.throws(() => ds.readUint8Array(4), RangeError);
        ds.seek(100); // seek clamps (historical behavior)
        assert.throws(() => ds.readUint8(), RangeError);
    });

    it('reads little-endian int arrays and strings', () => {
        const ds = new DataStream(new Uint8Array([0x01, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]));
        assert.deepEqual(Array.from(ds.readInt32Array(2)), [1, 2]);

        const ds2 = new DataStream(Buffer.from('ABCDEFGH', 'ascii'));
        assert.equal(ds2.readString(4), 'ABCD');
        assert.equal(ds2.isEof(), false);
        ds2.readUint8Array(4);
        assert.equal(ds2.isEof(), true);
    });

    it('reads UCS-2 strings', () => {
        const ds = new DataStream(new Uint8Array([0x41, 0x00, 0x42, 0x00])); // "AB"
        assert.equal(ds.readUCS2String(2), 'AB');
        const ds2 = new DataStream(new Uint8Array([0x41, 0x00, 0x42, 0x00]));
        assert.equal(ds2.readStringAt(0, 2), 'AB');
    });
});
