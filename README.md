# msgreader

Outlook Item File (.msg) reader in JavaScript. Parses Outlook `.msg` files to
message metadata, recipients, the RTF/plain-text body and attachments — in
Node.js and in browsers.

Original project: https://github.com/ykarpovich/msg.reader

## Install

```sh
npm install @npeersab/msgreader
```

Requires Node.js >= 16. The package ships dual builds — CommonJS (`lib/`)
and true ESM (`lib-esm/`) — with TypeScript declarations; it works from both
`require()` and `import`.

## How to use

```javascript
import fs from 'fs';
import MsgReader from '@npeersab/msgreader';
// ESM named import also works:
// import { MsgReader } from '@npeersab/msgreader';

const msgFileBuffer = fs.readFileSync('./data/test.msg');
const testMsg = new MsgReader(msgFileBuffer);
const testMsgInfo = testMsg.getFileData();
/**
  testMsgInfo contains:
  {
    attachments: [
      {
        dataId: 62,
        contentLength: 122784,
        fileName: '5AAoPFgV-nJ965R7o-98C38840-4454-4750-9AEF-F53DB3E37548.jpg',
        fileNameShort: '5AAOPF~1.JPG',
        mimeType: 'image/jpeg'
      }
    ],
    recipients: [
      {
        name: 'christoph@freiraum.xyz',
        email: 'christoph@freiraum.xyz'
      }
    ],
    senderName: 'christoph@freiraum.xyz',
    senderEmail: 'christoph@freiraum.xyz',
    messageClass: 'IPM.Note',
    subject: 'asdf',
    body: ' \r\n\r\n',
    headers: 'Return-Path: <christoph@freiraum.xyz>\r\n...',
    ...
  }
**/
const testMsgAttachment0 = testMsg.getAttachment(testMsgInfo.attachments[0]);
/**
  testMsgAttachment0 contains:
  {
    fileName: '5AAoPFgV-nJ965R7o-98C38840-4454-4750-9AEF-F53DB3E37548.jpg',
    content: <Uint8Array>
  }
**/
```

TypeScript usage:

```typescript
import MsgReader, { MessageData, AttachmentContent } from '@npeersab/msgreader';

const reader = new MsgReader(buffer); // Buffer | Uint8Array | ArrayBuffer | DataView
const info: MessageData = reader.getFileData();
const attachment: AttachmentContent = reader.getAttachmentByIndex(0);
```

## API

### `new MsgReader(input)`

`input` may be a Node.js `Buffer`, `Uint8Array` (views with a nonzero
`byteOffset` are handled correctly), `ArrayBuffer`, `DataView`, or any
`{ buffer, byteOffset, byteLength }` view. Throws `InvalidMsgFileError` for
empty input.

Invalid (non-MSG) files throw `InvalidMsgFileError` when parsed. Use the
non-throwing `MsgReader.isMsgFile(input): boolean` guard when the input type
is unknown.

### `getFileData(): MessageData`

Parses the file (once — results are cached) and returns message metadata:

| Field | Tag | Notes |
|---|---|---|
| `subject` | `0037` | |
| `normalizedSubject` | `0E1D` | |
| `subjectPrefix` | `003D` | |
| `messageClass` | `001A` | e.g. `IPM.Note` |
| `senderName` / `senderEmail` / `senderSmtpAddress` | `0C1A`/`0C1F`/`0C1E` | |
| `displayTo` / `displayCc` / `displayBcc` | `0E04`/`0E03`/`0E02` | |
| `body` | `1000` | plain text |
| `bodyHtml` | `1013` | raw HTML (`Uint8Array` or `string`); use `getHtmlBody()` |
| `bodyHtml` | `1013` | raw HTML bytes, when present |
| `headers` | `007D` | transport headers |
| `compressedRtf` | `1009` | raw LZFu bytes; use `getRtfBody()` |
| `internetMessageId` | `1035` | |
| `messageCodepage` | `3FFD` | Windows codepage used to decode `001E` strings |
| `attachments` | | descriptors (no content loaded) |
| `recipients` | | `{ name, email, addressType, smtpAddress, ... }` |
| `extraProperties` | | decoded scalar values for tags without a friendly name, keyed by 4-hex-digit class (e.g. `extraProperties['0040']`) |

Attachment descriptors carry `dataId`, `contentLength`, `fileName`,
`fileNameShort`, `extension`, `mimeType`, `pidContentId`,
`attachContentLocation`, `attachMethod`, plus `hasInnerMsg` and the
recursively parsed `embeddedMessage` when the attachment is itself a message.

The returned object is a shallow copy; binary payloads are shared read-only
views.

### `getAttachment(index | descriptor): AttachmentContent`

Reads an attachment's content (`{ fileName, fileNameShort, extension,
mimeType, pidContentId, contentLength, content }`). Accepts an index into
`getFileData().attachments` or a descriptor object. Aliases:
`getAttachmentByIndex(i)`, `getAttachmentData(descriptor)`. Throws
`RangeError` for unknown indexes and `TypeError` for invalid descriptors.
Embedded-message attachments have no byte content — `getAttachment()` throws
a descriptive error for them; read `descriptor.embeddedMessage` instead.
Parsing happens automatically — no need to call `getFileData()` first.

### `getRtfBody(): string | null`

Decompresses the `PidTagRtfCompressed` body (MS-OXRTFCP LZFu) and returns the
RTF markup string, or `null` when absent. The low-level helpers
`decompressRtf(bytes)` / `decompressRtfToString(bytes)` are also exported.

### `getHtmlBody(): string | null`

Returns the `PidTagBodyHtml` body as a string, or `null` when absent.
Binary payloads decode via BOM → `<meta charset>` → strict-UTF-8 probing,
falling back to the message codepage (windows-1252 default).

### `getProperties()`

Returns a copy of the parsed OLE directory entries (advanced use).

## Error handling

```javascript
import MsgReader, { InvalidMsgFileError } from '@npeersab/msgreader';

if (!MsgReader.isMsgFile(maybeMsg)) {
    throw new Error('not a .msg file');
}
try {
    const info = new MsgReader(maybeMsg).getFileData();
} catch (err) {
    if (err instanceof InvalidMsgFileError) { /* ... */ }
    if (err instanceof RangeError) { /* corrupt stream offsets */ }
}
```

## Limitations

- Embedded messages recurse up to 10 levels deep; deeper nesting keeps the
  `hasInnerMsg` flag without further parsing.
- Single-byte (`001E`) strings decode with `PidTagMessageCodepage`, read from
  the `3FFD` stream or the scope's `__properties_version1.0` fixed properties
  (embedded messages resolve their own scope), otherwise windows-1252.
  Files with no codepage signal anywhere (e.g. Big5 text without a tag) fall
  back to windows-1252 and will show mojibake.
- HTML bodies are exposed as raw bytes (`bodyHtml`) when Outlook stored them;
  there is no RTF→HTML conversion — use `getRtfBody()` for the RTF markup.
- `getFileData()` decodes corrupt *streams* as missing fields (lenient), but
  a corrupt OLE *structure* (FAT, property chain) throws.

## Migrating from 4.x

Version 5.0 is a major release:

- Invalid files now **throw** `InvalidMsgFileError` instead of returning
  `{ error: 'Unsupported file type!' }`. Guard with `MsgReader.isMsgFile()`.
- `getAttachment()` returns attachment metadata in addition to `fileName` /
  `content`, and `contentLength` is the actual byte length. Out-of-range
  indexes throw `RangeError` (previously an obscure `TypeError`).
- New fields are exposed (`messageClass`, `bodyHtml`, `displayTo/Cc/Bcc`,
  `senderSmtpAddress`, `mimeType`, `internetMessageId`, `extraProperties`,
  ...). Empty text streams decode as `''` (previously `null`).
- New APIs: `getAttachmentByIndex`, `getAttachmentData`, `getRtfBody`,
  `getProperties`, `MsgReader.isMsgFile`, `decompressRtf`.
- License corrected to **Apache-2.0** (matching the source headers).

See [CHANGELOG.md](./CHANGELOG.md) for details.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
