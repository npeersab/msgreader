'use strict';

// Additional fixtures courtesy of the Apache POI project
// (https://github.com/apache/poi/tree/trunk/test-data/hsmf,
// Apache License 2.0): a spread of message classes, encodings and
// attachment shapes beyond data/test.msg.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { default: MsgReader } = require('../lib/index.js');

function load(name) {
    return fs.readFileSync(path.join(__dirname, '..', 'data', name));
}

function md5(bytes) {
    return crypto.createHash('md5').update(bytes).digest('hex');
}

describe('samples — blank.msg (empty edge case)', () => {
    it('parses without throwing', () => {
        const data = new MsgReader(load('blank.msg')).getFileData();
        assert.equal(data.subject, '');
        assert.equal(data.messageClass, 'IPM.Note');
        assert.equal(data.attachments.length, 0);
        assert.equal(data.recipients.length, 0);
        assert.equal(new MsgReader(load('blank.msg')).getRtfBody(), null);
    });
});

describe('samples — quick.msg (basic note)', () => {
    it('parses metadata and recipients', () => {
        const data = new MsgReader(load('quick.msg')).getFileData();
        assert.equal(data.subject, 'Test the content transformer');
        assert.equal(data.senderName, 'Kevin Roast');
        assert.equal(data.body.length, 45);
        assert.equal(data.recipients.length, 1);
        assert.equal(data.recipients[0].name, 'Kevin Roast');
        assert.equal(data.recipients[0].smtpAddress, 'kevin.roast@alfresco.org');
        assert.equal(data.compressedRtf.length, 185);
        const rtf = new MsgReader(load('quick.msg')).getRtfBody();
        assert.ok(rtf.startsWith('{\\rtf'));
    });
});

describe('samples — ASCII_UTF-8_CP1252_LCID1031_HTML.msg (HTML body as string)', () => {
    it('exposes the HTML body with decoded unicode subject', () => {
        const reader = new MsgReader(load('ASCII_UTF-8_CP1252_LCID1031_HTML.msg'));
        const data = reader.getFileData();
        assert.equal(data.subject, 'Subject öäü Subject');
        assert.equal(data.body.length, 13);
        assert.equal(typeof data.bodyHtml, 'string');
        assert.ok(data.bodyHtml.includes('<html>'));
        assert.equal(reader.getRtfBody(), null);
        assert.ok(reader.getHtmlBody().includes('<html>'));
    });
});

describe('samples — HTMLBodyBinary_UTF-8.msg (HTML body as binary)', () => {
    it('decodes the binary HTML body via meta charset', () => {
        const reader = new MsgReader(load('HTMLBodyBinary_UTF-8.msg'));
        const data = reader.getFileData();
        assert.equal(data.subject, 'Subject öäü Subject');
        assert.ok(data.bodyHtml instanceof Uint8Array);
        assert.equal(data.bodyHtml.length, 76);
        const html = reader.getHtmlBody();
        assert.ok(html.includes('<html>'));
        assert.ok(html.includes('utf-8'));
    });
});

describe('samples — attachment_test_msg.msg (unicode names, small parts)', () => {
    it('reads both attachments byte-correct', () => {
        const reader = new MsgReader(load('attachment_test_msg.msg'));
        const data = reader.getFileData();
        assert.equal(data.subject, 'test pièce jointe 1');
        assert.equal(data.senderName, 'Nicolas1 23456');
        assert.equal(data.attachments.length, 2);
        assert.equal(data.attachments[0].fileName, 'test-unicode.doc');
        assert.equal(data.attachments[1].fileName, 'pj1.txt');

        const doc = reader.getAttachmentByIndex(0);
        assert.equal(doc.content.length, 24064);
        assert.equal(md5(doc.content), 'ed4f01af3583c49afc0e96c768917993');

        const txt = reader.getAttachmentByIndex(1);
        assert.equal(txt.content.length, 89);
        assert.equal(md5(txt.content), '33cead8e0aa4a09977c164be824b4d83');
    });
});

describe('samples — cyrillic_message.msg (codepage from __properties)', () => {
    it('decodes 001E strings with the fixed-property codepage (1251)', () => {
        const reader = new MsgReader(load('cyrillic_message.msg'));
        const data = reader.getFileData();
        assert.equal(data.subject, 'Автоматический ответ подсистемы обмена данными ФГУП "Почта России".');
        assert.equal(data.senderEmail, 'no-reply@niips.ru');
        assert.equal(data.recipients.length, 2);
        assert.equal(data.body.length, 331);
        assert.ok(data.body.includes('FW: RTM'));
    });
});

describe('samples — fuzz-poihsmf-4848576776503296.msg (fuzzer crasher)', () => {
    // Minimized crash reproducer from POI's OSS-Fuzz corpus (Apache-2.0).
    // Must terminate quickly and either parse or throw — never hang.
    it('terminates and parses without hanging', () => {
        const t0 = Date.now();
        const data = new MsgReader(load('fuzz-poihsmf-4848576776503296.msg')).getFileData();
        assert.ok(Date.now() - t0 < 10000);
        assert.equal(data.subject, 'QuickBrownFox');
        assert.equal(data.messageClass, 'IPM.Post');
        assert.equal(data.attachments.length, 0);
        assert.equal(data.recipients.length, 0);
    });
});
describe('samples — 58214_with_attachment.msg (embedded message)', () => {
    it('parses the embedded message recursively', () => {
        const reader = new MsgReader(load('58214_with_attachment.msg'));
        const data = reader.getFileData();
        assert.equal(data.subject, 'Master mail');
        assert.equal(data.attachments.length, 1);
        const [att] = data.attachments;
        assert.equal(att.hasInnerMsg, true);

        const embedded = att.embeddedMessage;
        assert.ok(embedded);
        assert.equal(embedded.subject, 'Test mail attachment');
        assert.equal(embedded.senderName, 'Bertrand Beyssac');
        assert.equal(embedded.senderEmail, 'bertrand.beyssac@c6.eu');
        assert.equal(embedded.recipients.length, 1);
        assert.equal(embedded.recipients[0].email, 'bertrand.beyssac@c6.eu');
        assert.equal(embedded.body.length, 897);
    });

    it('getAttachment() on embedded messages throws a descriptive error', () => {
        const reader = new MsgReader(load('58214_with_attachment.msg'));
        assert.throws(() => reader.getAttachmentByIndex(0), /embedded message/);
    });
});
describe('samples — msgClassAppointment.msg (non-note class)', () => {
    it('parses appointment metadata', () => {
        const data = new MsgReader(load('msgClassAppointment.msg')).getFileData();
        assert.equal(data.messageClass, 'IPM.Appointment');
        assert.equal(data.subject, 'Quick brown fox');
        assert.equal(data.senderName, 'Allison, Timothy B.');
        assert.equal(data.body.length, 38);
        assert.equal(data.compressedRtf.length, 8222);
    });
});
