# Changelog

## 5.0.0

Major release — correctness, API, packaging and feature overhaul.

### Breaking changes

- Invalid files now throw `InvalidMsgFileError` instead of returning
  `{ error: 'Unsupported file type!' }`. Use the new non-throwing
  `MsgReader.isMsgFile(input)` guard when the input type is unknown.
- `getAttachment()` returns a richer object (`fileName`, `fileNameShort`,
  `extension`, `mimeType`, `pidContentId`, `contentLength`, `content`);
  `contentLength` is the actual decoded byte length. Out-of-range indexes
  throw `RangeError`, invalid descriptors throw `TypeError`.
- Empty text streams decode as `''` instead of `null`.
- Corrupt OLE structure (bad FAT / property chain) throws instead of
  hanging or returning garbage.
- License corrected to Apache-2.0 (matching the source file headers).
- TypeScript build target raised to ES2020 with `strict` mode; the public
  type surface is exported from the package entry point.

### Fixes

- SBAT chain walk no longer treats block id `0` as end-of-chain.
- Property-hierarchy builder is cycle-safe (visited sets, bounded queues).
- Null property entries are guarded everywhere (no more `TypeError` on
  sparse/unknown entry types).
- Large (BAT) streams spanning multiple big blocks are now reassembled by
  following the FAT chain (previously only the first block's file offset was
  read, which only worked when blocks happened to be contiguous).
- Mini-stream reads are memoized (root chain resolved once) and chunked
  instead of re-walking the chain per small block (O(n²) → O(n)).
- `DataStream` rewritten read-only: no reallocation on reads, correct
  handling of views with nonzero `byteOffset` (e.g. pooled Node Buffers),
  `RangeError` on overruns, fixed `readInt32Array`/`readUint16Array` default
  length computation, removed write paths and dead code.
- Property names and string values are stripped of trailing NUL terminators.
- Unchecked allocations (`new Array(batCount)`, `new Int8Array(size)`) are
  validated and capped (`MAX_DOCUMENT_SIZE`).

### Features

- New field mappings: `messageClass`, `subjectPrefix`, `normalizedSubject`,
  `senderSmtpAddress`, `displayTo/Cc/Bcc`, `bodyHtml` (1013), `internetMessageId`,
  `addressType`, `smtpAddress`, `searchKey`, `extension`, `attachMethod`,
  `mimeType` (370E), `attachContentLocation`; scalar `0003` (int), `000B`
  (bool) and `0040` (FILETIME → `Date`) types decode.
- Unmapped scalar tags are preserved in `extraProperties` (keyed by tag).
- `decompressRtf()` / `decompressRtfToString()` (MS-OXRTFCP LZFu, CRC-checked)
  plus `MsgReader.getRtfBody()`.
- New APIs: `getAttachmentByIndex`, `getAttachmentData`, `getProperties`,
  `MsgReader.isMsgFile`, `codepageToEncoding`.
- `001E` strings decode with `PidTagMessageCodepage` when present
  (windows-1252 fallback); embedded-message attachments throw a descriptive
  error from `getAttachment()`.
- Constructor accepts `Buffer`, `Uint8Array`, `ArrayBuffer`, `DataView` and
  generic buffer views; `getAttachment()` auto-parses (no need to call
  `getFileData()` first); `getFileData()` returns a defensive copy.
- Named ESM exports work (`import { MsgReader } from ...`); `exports` map,
  `files` list, keywords, description and `engines` added to package.json.

### Tooling

- `npm test` now builds and runs 30+ assertions with the Node test runner
  against `data/test.msg` (metadata, recipients, attachment md5, RTF
  round-trip, error paths, input-type matrix, ESM interop).
- TypeScript 5.x, `strict` + `noUncheckedIndexedAccess`, sourcemaps and
  declaration maps; `.prettierrc` moved to the repo root.
