import MsgReader, { InvalidMsgFileError, codepageToEncoding, decompressRtf } from '../lib-esm/index.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = fs.readFileSync(path.join(here, '..', 'data', 'test.msg'));

describe('lib-esm — true ESM build (static imports)', () => {
    it('exposes a working default export', () => {
        assert.equal(typeof MsgReader, 'function');
        const data = new MsgReader(FIXTURE).getFileData();
        assert.equal(data.subject, 'asdf');
        assert.equal(data.attachments.length, 1);
    });

    it('exposes working named exports', () => {
        assert.equal(typeof InvalidMsgFileError, 'function');
        assert.equal(codepageToEncoding(1252), 'windows-1252');
        const data = new MsgReader(FIXTURE).getFileData();
        assert.equal(decompressRtf(data.compressedRtf).length, 2638);
    });

    it('reads attachments identically to the CJS build', async () => {
        const { MsgReader: CjsReader } = await import('../lib/index.js');
        const a = new MsgReader(FIXTURE).getAttachmentByIndex(0);
        const b = new CjsReader(FIXTURE).getAttachmentByIndex(0);
        assert.equal(
            crypto.createHash('md5').update(a.content).digest('hex'),
            crypto.createHash('md5').update(b.content).digest('hex')
        );
    });
});
