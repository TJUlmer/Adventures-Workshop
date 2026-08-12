/**
 * A minimal ZIP writer.
 *
 * A browser cannot write a folder tree, so a bundle of images with any
 * structure has to be an archive. Everything going in is already-compressed
 * PNG, so entries are *stored* rather than deflated: it costs nothing in size
 * and saves pulling in a compression library for no gain.
 *
 * Paths carry the folders — `Set/Characters/card.png` — which is all a ZIP
 * needs to unpack into a tree.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array<ArrayBuffer>): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Path inside the archive. Forward slashes make the folders. */
  path: string;
  /**
   * Pinned to `ArrayBuffer` rather than left as the default `ArrayBufferLike`:
   * a `Blob` will not take a view that might be backed by shared memory.
   */
  bytes: Uint8Array<ArrayBuffer>;
}

/** MS-DOS date and time, which is what the format stores. */
function dosStamp(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

export function createZip(entries: readonly ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const stamp = dosStamp(new Date());

  const parts: Uint8Array<ArrayBuffer>[] = [];
  const directory: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const crc = crc32(entry.bytes);
    const size = entry.bytes.length;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // local file header
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, stamp.time, true);
    local.setUint16(12, stamp.date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true); // no extra field

    parts.push(new Uint8Array(local.buffer), name, entry.bytes);

    const central = new Uint8Array(46 + name.length);
    const view = new DataView(central.buffer);
    view.setUint32(0, 0x02014b50, true); // central directory header
    view.setUint16(4, 20, true); // version made by
    view.setUint16(6, 20, true); // version needed
    view.setUint16(8, 0x0800, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, stamp.time, true);
    view.setUint16(14, stamp.date, true);
    view.setUint32(16, crc, true);
    view.setUint32(20, size, true);
    view.setUint32(24, size, true);
    view.setUint16(28, name.length, true);
    view.setUint32(42, offset, true);
    central.set(name, 46);
    directory.push(central);

    offset += 30 + name.length + size;
  }

  const directorySize = directory.reduce((total, record) => total + record.length, 0);

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // end of central directory
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);

  return new Blob([...parts, ...directory, new Uint8Array(end.buffer)], {
    type: 'application/zip'
  });
}
