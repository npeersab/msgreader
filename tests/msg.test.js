'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { default: MsgReader, InvalidMsgFileError, codepageToEncoding } = require('../lib/index.js');

const FIXTURE = fs.readFileSync(path.join(__dirname, '..', 'data', 'test.msg'));
// md5 of the attached JPEG, verified against the pre-rewrite (4.x) parser.
const EXPECTED_ATTACHMENT_MD5 = '340105f67998088c54b060473c9bf6db';

describe('MsgReader — test.msg fixture', () => {
    it('parses message metadata', () => {
        const data = new MsgReader(FIXTURE).getFileData();
        assert.equal(data.subject, 'asdf');
        assert.equal(data.normalizedSubject, 'asdf');
        assert.equal(data.messageClass, 'IPM.Note');
        assert.equal(data.senderName, 'christoph@freiraum.xyz');
        assert.equal(data.senderEmail, 'christoph@freiraum.xyz');
        assert.equal(data.displayTo, 'christoph@freiraum.xyz');
        assert.equal(data.body, ' \r\n\r\n');
        assert.ok(data.headers.includes('Subject: asdf'));
        assert.ok(data.headers.includes('X-Mailer: Microsoft Outlook 16.0'));
        assert.equal(data.internetMessageId, '<000001d3c2c0$e7ca4aa0$b75edfe0$@freiraum.xyz>');
        assert.ok(data.compressedRtf instanceof Uint8Array);
        assert.equal(data.compressedRtf.length, 1281);
    });

    it('parses recipients', () => {
        const data = new MsgReader(FIXTURE).getFileData();
        assert.equal(data.recipients.length, 1);
        assert.equal(data.recipients[0].name, 'christoph@freiraum.xyz');
        assert.equal(data.recipients[0].email, 'christoph@freiraum.xyz');
    });

    it('describes attachments without loading content', () => {
        const data = new MsgReader(FIXTURE).getFileData();
        assert.equal(data.attachments.length, 1);
        const [att] = data.attachments;
        assert.equal(att.fileName, '5AAoPFgV-nJ965R7o-98C38840-4454-4750-9AEF-F53DB3E37548.jpg');
        assert.equal(att.fileNameShort, '5AAOPF~1.JPG');
        assert.equal(att.mimeType, 'image/jpeg');
        assert.equal(att.contentLength, 122784);
        assert.equal(typeof att.dataId, 'number');
    });

    it('reads attachment content by index (multi-block BAT chain)', () => {
        const reader = new MsgReader(FIXTURE);
        const att = reader.getAttachment(0);
        assert.equal(att.fileName, '5AAoPFgV-nJ965R7o-98C38840-4454-4750-9AEF-F53DB3E37548.jpg');
        assert.equal(att.mimeType, 'image/jpeg');
        assert.equal(att.contentLength, 122784);
        assert.ok(att.content instanceof Uint8Array);
        // JPEG magic
        assert.equal(att.content[0], 0xff);
        assert.equal(att.content[1], 0xd8);
        assert.equal(crypto.createHash('md5').update(att.content).digest('hex'), EXPECTED_ATTACHMENT_MD5);
    });

    it('reads attachment content from a descriptor object', () => {
        const reader = new MsgReader(FIXTURE);
        const data = reader.getFileData();
        const att = reader.getAttachment(data.attachments[0]);
        assert.equal(crypto.createHash('md5').update(att.content).digest('hex'), EXPECTED_ATTACHMENT_MD5);
    });

    it('parses lazily: getAttachment() works without getFileData() first', () => {
        const att = new MsgReader(FIXTURE).getAttachmentByIndex(0);
        assert.equal(att.contentLength, 122784);
    });

    it('getFileData() is idempotent and returns copies', () => {
        const reader = new MsgReader(FIXTURE);
        const a = reader.getFileData();
        a.subject = 'mutated';
        a.attachments.push({ dataId: -1, contentLength: 0 });
        const b = reader.getFileData();
        assert.equal(b.subject, 'asdf');
        assert.equal(b.attachments.length, 1);
    });

    it('exposes the property table and decompressed RTF', () => {
        const reader = new MsgReader(FIXTURE);
        const props = reader.getProperties();
        assert.ok(props.length > 50);
        assert.equal(props[0].type, 5); // root entry
        const rtf = reader.getRtfBody();
        assert.equal(typeof rtf, 'string');
        assert.ok(rtf.startsWith('{\\rtf'));
    });
});

describe('MsgReader — input types', () => {
    for (const [label, convert] of [
        ['Buffer', (b) => Buffer.from(b)],
        ['Uint8Array', (b) => new Uint8Array(b)],
        ['Uint8Array view with byteOffset', (b) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength)],
        ['ArrayBuffer (sliced copy)', (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)],
        ['DataView', (b) => new DataView(b.buffer, b.byteOffset, b.byteLength)],
    ]) {
        it(`accepts ${label}`, () => {
            const data = new MsgReader(convert(FIXTURE)).getFileData();
            assert.equal(data.subject, 'asdf');
            assert.equal(data.attachments.length, 1);
        });
    }

    it('attachment bytes are identical across input types', () => {
        const expected = crypto.createHash('md5').update(FIXTURE).digest('hex');
        assert.equal(expected, crypto.createHash('md5').update(fs.readFileSync('data/test.msg')).digest('hex'));
        const fromView = new MsgReader(
            new Uint8Array(FIXTURE.buffer, FIXTURE.byteOffset, FIXTURE.byteLength)
        ).getAttachmentByIndex(0);
        assert.equal(crypto.createHash('md5').update(fromView.content).digest('hex'), EXPECTED_ATTACHMENT_MD5);
    });
});

describe('MsgReader — error handling', () => {
    it('throws InvalidMsgFileError on non-MSG input', () => {
        assert.throws(() => new MsgReader(Buffer.from('hello world')).getFileData(), InvalidMsgFileError);
        assert.throws(() => new MsgReader(Buffer.alloc(0)), InvalidMsgFileError);
    });

    it('isMsgFile() detects MSG files without throwing', () => {
        assert.equal(MsgReader.isMsgFile(FIXTURE), true);
        assert.equal(MsgReader.isMsgFile(Buffer.from('hello world')), false);
        assert.equal(MsgReader.isMsgFile(Buffer.alloc(0)), false);
    });

    it('throws RangeError for out-of-range attachment index', () => {
        const reader = new MsgReader(FIXTURE);
        assert.throws(() => reader.getAttachmentByIndex(7), RangeError);
        assert.throws(() => reader.getAttachmentByIndex(-1), RangeError);
    });

    it('throws TypeError for invalid attachment descriptors', () => {
        const reader = new MsgReader(FIXTURE);
        assert.throws(() => reader.getAttachmentData(null), TypeError);
        assert.throws(() => reader.getAttachmentData({}), TypeError);
    });

    it('throws (instead of hanging) on truncated input', () => {
        const truncated = FIXTURE.subarray(0, 4096);
        assert.throws(() => new MsgReader(truncated).getFileData(), Error);
    });

    it('does not mistake random OLE files for fatal hangs (garbage FAT)', () => {
        const garbage = Buffer.alloc(8192, 0);
        // valid OLE magic but zeroed header
        Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(garbage, 0);
        assert.throws(() => new MsgReader(garbage).getFileData(), Error);
    });
});

describe('codepageToEncoding', () => {
    it('maps Windows codepages to TextDecoder labels', () => {
        assert.equal(codepageToEncoding(1252), 'windows-1252');
        assert.equal(codepageToEncoding(1251), 'windows-1251');
        assert.equal(codepageToEncoding(950), 'big5');
        assert.equal(codepageToEncoding(936), 'gbk');
        assert.equal(codepageToEncoding(932), 'shift_jis');
        assert.equal(codepageToEncoding(949), 'euc-kr');
        assert.equal(codepageToEncoding(65001), 'utf-8');
    });

    it('falls back to windows-1252 for unknown codepages', () => {
        assert.equal(codepageToEncoding(0), 'windows-1252');
        assert.equal(codepageToEncoding(999999), 'windows-1252');
    });
});

describe('MsgReader — ESM interop', () => {
    it('exposes named ESM exports (incl. MsgReader)', async () => {
        const mod = await import('../lib/index.js');
        assert.equal(typeof mod.MsgReader, 'function');
        assert.equal(typeof mod.InvalidMsgFileError, 'function');
        assert.equal(typeof mod.decompressRtf, 'function');
        const data = new mod.MsgReader(FIXTURE).getFileData();
        assert.equal(data.subject, 'asdf');
    });
});
